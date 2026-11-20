// Push notifications for coins you own, even when the app is closed.
// The browser gives us a push "subscription" (an address only that browser's push service can deliver to).
// We store it with the coins you hold and what you paid (never the amounts), check them on a schedule,
// and send a notification when a coin's sell plan changes: stop hit, signal turned SELL, take-profit, trend back.
const crypto = require("crypto");
const storage = require("./storage.js");
const SellPlan = require("./public/sellplan.js");

const PUB = () => process.env.VAPID_PUBLIC_KEY || "";
const configured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && storage.available());
let wp = null;
function webpush() {
  if (!wp) {
    wp = require("web-push");
    wp.setVapidDetails(process.env.VAPID_SUBJECT || "https://signal-tips.vercel.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  return wp;
}

const keyFor = (endpoint) => "push/" + crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40) + ".json";
const okEndpoint = (e) => typeof e === "string" && e.length < 1000 && /^https:\/\/[a-z0-9.-]+(:\d+)?\//i.test(e);

function cleanSub(s) {
  if (!s || !okEndpoint(s.endpoint) || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") throw Object.assign(new Error("Bad subscription"), { status: 400 });
  if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100) throw Object.assign(new Error("Bad subscription"), { status: 400 });
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
function cleanCoins(list) {
  const out = {};
  for (const c of Array.isArray(list) ? list.slice(0, 50) : []) {
    const sym = String(c?.sym || "").toUpperCase();
    if (!/^[A-Z0-9]{1,15}$/.test(sym)) continue;
    const cost = +c.cost > 0 && +c.cost < 1e9 ? +c.cost : 0;
    const state = ["stop", "sell", "target", "hold", "watch"].includes(c.state) ? c.state : null;
    if (!out[sym] || cost) out[sym] = { sym, cost, state };
  }
  return Object.values(out);
}

async function subscribe(body) {
  const sub = cleanSub(body.subscription), coins = cleanCoins(body.coins);
  const key = keyFor(sub.endpoint), old = (await storage.getJSON(key)) || {};
  const states = {};
  for (const c of coins) { const st = old.states?.[c.sym] || c.state; if (st) states[c.sym] = st; delete c.state; }
  await storage.putJSON(key, { sub, coins, states, created: old.created || Date.now(), updated: Date.now() });
  return { ok: true, coins: coins.length };
}
async function unsubscribe(body) {
  if (!okEndpoint(body.endpoint)) return { ok: true };
  await storage.delKey(keyFor(body.endpoint));
  return { ok: true };
}
async function send(sub, payload) {
  try { await webpush().sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" }); return true; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) return "gone"; return false; }
}
async function test(body) {
  if (!okEndpoint(body.endpoint)) throw Object.assign(new Error("Bad request"), { status: 400 });
  const rec = await storage.getJSON(keyFor(body.endpoint));
  if (!rec) throw Object.assign(new Error("Not subscribed"), { status: 404 });
  const r = await send(rec.sub, { title: "Signal Tips notifications are on", body: `We'll tell you when to sell or take profit on ${rec.coins.map((c) => c.sym).join(", ") || "your coins"}.`, url: "/?tab=holdings" });
  return { ok: r === true };
}

async function dailyCandles(sym) {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400`, { headers: { "User-Agent": "signal-tips/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.map(([time, low, high, open, close, volume]) => ({ time, low, high, open, close, volume })).sort((a, b) => a.time - b.time);
}

// Check every subscription. Safe to call often: at most one run every 4 minutes, and a coin only
// notifies when its state changes, so repeated calls never repeat a notification.
async function run({ force = false } = {}) {
  if (!configured()) return { ok: false, reason: "not configured" };
  const meta = (await storage.getJSON("push-meta/run.json")) || {};
  if (!force && meta.at && Date.now() - meta.at < 4 * 60_000) return { ok: true, skipped: "ran recently" };
  await storage.putJSON("push-meta/run.json", { at: Date.now() });
  const keys = await storage.listKeys("push/");
  const recs = (await Promise.all(keys.slice(0, 2000).map(async (k) => [k, await storage.getJSON(k).catch(() => null)]))).filter(([, r]) => r);
  const syms = [...new Set(recs.flatMap(([, r]) => r.coins.map((c) => c.sym)))];
  const candles = {};
  for (let i = 0; i < syms.length; i += 5) {
    await Promise.all(syms.slice(i, i + 5).map(async (s) => { try { candles[s] = await dailyCandles(s); } catch { candles[s] = null; } }));
  }
  let sent = 0, removed = 0;
  for (const [key, rec] of recs) {
    let changed = false;
    rec.states = rec.states || {};
    for (const c of rec.coins) {
      const p = SellPlan.plan(candles[c.sym], { cost: c.cost });
      if (!p) continue;
      const prev = rec.states[c.sym];
      if (prev === p.state) continue;
      const msg = prev ? SellPlan.message(c.sym, p, prev) : null; // the first check only records where things stand
      rec.states[c.sym] = p.state; changed = true;
      if (msg) {
        const r = await send(rec.sub, { ...msg, url: `/?coin=${c.sym}`, tag: "plan-" + c.sym });
        if (r === "gone") { await storage.delKey(key); removed++; changed = false; break; }
        if (r) sent++;
      }
    }
    if (changed) await storage.putJSON(key, rec);
  }
  return { ok: true, subscriptions: recs.length, coins: syms.length, sent, removed };
}

module.exports = { configured, publicKey: PUB, subscribe, unsubscribe, test, run };

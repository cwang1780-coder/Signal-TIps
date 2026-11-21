// Push notifications for coins you own, even when the app is closed.
// Two kinds of devices: a browser gives us a web push "subscription" (an address only that browser's push
// service can deliver to); the iPhone app gives us an Apple push (APNs) device token.
// We store it with the coins you hold and what you paid (never the amounts), check them on a schedule,
// and send a notification when a coin's sell plan changes: stop hit, signal turned SELL, take-profit, trend back.
const crypto = require("crypto");
const storage = require("./storage.js");
const SellPlan = require("./public/sellplan.js");

const PUB = () => process.env.VAPID_PUBLIC_KEY || "";
const webConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
// Apple push for the iPhone app: a .p8 key from the Apple Developer account (Keys > Apple Push Notifications service)
const apnsConfigured = () => Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY_P8);
const configured = () => storage.available() && (webConfigured() || apnsConfigured());
let wp = null;
function webpush() {
  if (!wp) {
    wp = require("web-push");
    wp.setVapidDetails(process.env.VAPID_SUBJECT || "https://signal-tips.vercel.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  return wp;
}

const okToken = (t) => typeof t === "string" && /^[0-9a-f]{32,200}$/i.test(t);
// The storage key for a device: its web push address, or "apns:" + its Apple device token
const idOf = (body) => (okToken(body.apns) ? "apns:" + body.apns.toLowerCase() : body.endpoint);
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
  const coins = cleanCoins(body.coins);
  let sub = null, apns = null;
  if (okToken(body.apns)) { if (!apnsConfigured()) throw Object.assign(new Error("iPhone app notifications aren't set up yet"), { status: 503 }); apns = body.apns.toLowerCase(); }
  else { if (!webConfigured()) throw Object.assign(new Error("Push notifications aren't set up yet"), { status: 503 }); sub = cleanSub(body.subscription); }
  const key = keyFor(apns ? "apns:" + apns : sub.endpoint), old = (await storage.getJSON(key)) || {};
  const states = {};
  for (const c of coins) { const st = old.states?.[c.sym] || c.state; if (st) states[c.sym] = st; delete c.state; }
  await storage.putJSON(key, { ...(apns ? { apns } : { sub }), coins, states, created: old.created || Date.now(), updated: Date.now() });
  return { ok: true, coins: coins.length };
}
async function unsubscribe(body) {
  if (!okToken(body.apns) && !okEndpoint(body.endpoint)) return { ok: true };
  await storage.delKey(keyFor(idOf(body)));
  return { ok: true };
}
// Apple push: a short-lived signed token (ES256) proves the message comes from this app's developer account
let apnsJwt = { at: 0, token: "" };
function apnsAuth() {
  if (Date.now() - apnsJwt.at < 40 * 60_000) return apnsJwt.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = b64({ alg: "ES256", kid: process.env.APNS_KEY_ID }) + "." + b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const key = String(process.env.APNS_KEY_P8).replace(/\\n/g, "\n");
  const sig = crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  apnsJwt = { at: Date.now(), token: data + "." + sig };
  return apnsJwt.token;
}
function sendApns(token, payload) {
  const http2 = require("http2");
  const host = process.env.APNS_HOST || "https://api.push.apple.com";
  return new Promise((resolve) => {
    const client = http2.connect(host);
    const done = (v) => { try { client.close(); } catch {} resolve(v); };
    client.on("error", () => done(false));
    const req = client.request({
      ":method": "POST", ":path": "/3/device/" + token, authorization: "bearer " + apnsAuth(),
      "apns-topic": process.env.APNS_BUNDLE_ID || "app.signaltips.ios", "apns-push-type": "alert", "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 6 * 3600), ...(payload.tag ? { "apns-collapse-id": payload.tag.slice(0, 64) } : {}),
      "content-type": "application/json",
    });
    let status = 0, body = "";
    req.setTimeout(10000, () => { req.close(); done(false); });
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (status === 200) return done(true);
      if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(body)) return done("gone");
      console.error("[apns]", status, body.slice(0, 200));
      done(false);
    });
    req.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: payload.url }));
  });
}
async function send(rec, payload) {
  if (rec.apns) return apnsConfigured() ? sendApns(rec.apns, payload) : false;
  if (!webConfigured()) return false;
  try { await webpush().sendNotification(rec.sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" }); return true; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) return "gone"; return false; }
}
async function test(body) {
  if (!okToken(body.apns) && !okEndpoint(body.endpoint)) throw Object.assign(new Error("Bad request"), { status: 400 });
  const rec = await storage.getJSON(keyFor(idOf(body)));
  if (!rec) throw Object.assign(new Error("Not subscribed"), { status: 404 });
  const r = await send(rec, { title: "Signal Tips notifications are on", body: `We'll tell you when to sell or take profit on ${rec.coins.map((c) => c.sym).join(", ") || "your coins"}.`, url: "/?tab=coins" });
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
        const r = await send(rec, { ...msg, url: `/?coin=${c.sym}`, tag: "plan-" + c.sym });
        if (r === "gone") { await storage.delKey(key); removed++; changed = false; break; }
        if (r) sent++;
      }
    }
    if (changed) await storage.putJSON(key, rec);
  }
  return { ok: true, subscriptions: recs.length, coins: syms.length, sent, removed };
}

// Admin: one message to every device that turned notifications on
async function broadcast({ title, body }) {
  title = String(title || "").trim().slice(0, 80); body = String(body || "").trim().slice(0, 200);
  if (!title) throw Object.assign(new Error("Add a title."), { status: 400 });
  if (!configured()) throw Object.assign(new Error("Push notifications aren't set up."), { status: 503 });
  const keys = await storage.listKeys("push/");
  let sent = 0, failed = 0, removed = 0;
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(keys.slice(i, i + 20).map(async (k) => {
      const rec = await storage.getJSON(k).catch(() => null);
      if (!rec) return;
      const r = await send(rec, { title, body, url: "/", tag: "announce" });
      if (r === true) sent++; else if (r === "gone") { removed++; await storage.delKey(k).catch(() => {}); } else failed++;
    }));
  }
  return { ok: true, devices: keys.length, sent, failed, removed };
}

module.exports = { broadcast, configured, webConfigured, apnsConfigured, publicKey: PUB, subscribe, unsubscribe, test, run };

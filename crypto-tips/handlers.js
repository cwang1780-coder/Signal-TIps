// API handlers shared by the local server (server.js) and Vercel functions (api/).
// Both use plain Node (req, res) objects.
const crypto = require("crypto");
const { loadKey, getHoldings } = require("./coinbase.js");
const ai = require("./ai.js");
const { getSocial } = require("./social.js");
const pro = require("./pro.js");
const { getResearch } = require("./research.js");
const wallet = require("./wallet.js");
const { getTrench, coinCandles } = require("./trench.js");
const { getUpcoming, poolCandles } = require("./upcoming.js");
const accounts = require("./accounts.js");
const push = require("./push.js");
const admin = require("./admin.js");
const cryptopay = require("./cryptopay.js");

const ON_VERCEL = Boolean(process.env.VERCEL);
let cache = { at: 0, data: null };

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

const sameSecret = (a, b) => {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

// Who may use the private endpoints (your balances, your AI key):
// - Online (Vercel): only callers that send the APP_PASSWORD. With no password set, these endpoints stay off.
// - Locally: only pages served from localhost (blocks other websites and DNS rebinding). APP_PASSWORD is optional.
async function authorize(req, res) {
  const password = process.env.APP_PASSWORD;
  if (ON_VERCEL && !password) {
    json(res, 503, { error: "disabled", reason: "Set APP_PASSWORD in the Vercel project settings to turn on Coinbase sync and Ask AI." });
    return false;
  }
  if (!ON_VERCEL) {
    const host = (req.headers.host || "").split(":")[0];
    const origin = req.headers.origin;
    if (!["localhost", "127.0.0.1"].includes(host) || (origin && origin !== `http://${req.headers.host}`)) {
      json(res, 403, { error: "forbidden", reason: "Forbidden" });
      return false;
    }
  }
  if (password && !sameSecret(req.headers["x-app-password"] || "", password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    json(res, 401, { error: "password", reason: "Enter the app password to use Coinbase sync and Ask AI." });
    return false;
  }
  return true;
}

async function holdingsHandler(req, res) {
  if (!(await authorize(req, res))) return;
  const creds = loadKey();
  if (!creds) return json(res, 200, { connected: false, reason: "No Coinbase API key configured. See README → Connect Coinbase." });
  try {
    const force = /[?&]force=/.test(req.url || "");
    if (!cache.data || Date.now() - cache.at > 30000 || force) cache = { at: Date.now(), data: await getHoldings(creds) };
    return json(res, 200, { connected: true, ...cache.data, updated: cache.at });
  } catch (e) {
    console.error("[coinbase]", e.message);
    return json(res, 200, { connected: false, reason: e.message });
  }
}

async function readJson(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body) : req.body; // Vercel pre-parses
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 300_000) throw Object.assign(new Error("Too much data"), { status: 413 });
  }
  return JSON.parse(body);
}

// Who may use Ask AI: the owner (password), or a Pro subscriber with questions left this month.
// Returns { subId } for subscribers, {} for the owner, or null after sending a refusal.
async function askAccess(req, res) {
  const user = await accounts.userFromRequest(req).catch(() => null);
  if (user) {
    const plan = await accounts.planOf(user);
    if (plan.pro) {
      if (accounts.aiUsed(user) >= plan.aiLimit) { json(res, 429, { error: "limit", reason: `You've used all ${plan.aiLimit} AI questions for this month${plan.kind === "trial" ? " on your trial" : ""}.` }); return null; }
      return { user };
    }
  }
  const proKey = req.headers["x-pro-key"];
  if (pro.enabled() && proKey) {
    const c = await pro.check(proKey);
    if (!c.ok) { json(res, 402, { error: "pro", reason: c.reason }); return null; }
    if (c.used >= c.limit) { json(res, 429, { error: "limit", reason: `You've used all ${c.limit} AI questions for this month. They reset on the 1st.` }); return null; }
    return { subId: c.subId };
  }
  const password = process.env.APP_PASSWORD;
  const isOwner = password && sameSecret(req.headers["x-app-password"] || "", password);
  if (ON_VERCEL && !isOwner) { json(res, 402, { error: "pro", reason: "Ask AI is a Pro feature. Start a free trial or go Pro under Me." }); return null; }
  return (await authorize(req, res)) ? {} : null;
}

async function askHandler(req, res) {
  if (req.method === "GET" && new URL(req.url, "http://x").searchParams.get("diag") === "1") return askDiag(req, res);
  if (new URL(req.url, "http://x").searchParams.get("review") === "1") return reviewHandler(req, res);
  if (req.method !== "POST") return json(res, 405, { reason: "POST only" });
  if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 403, { reason: "Forbidden" });
  const access = await askAccess(req, res);
  if (!access) return;
  let input;
  try { input = await readJson(req); } catch (e) { return json(res, e.status || 400, { reason: e.message }); }
  if (!input || typeof input.question !== "string" || !input.question.trim()) return json(res, 400, { reason: "Missing question" });
  if (JSON.stringify(input).length > 300_000) return json(res, 413, { reason: "Too much data" });

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  // Hard deadline for the whole answer, wherever it gets stuck, so the reply is never blank (the server stops at 60 s)
  let finished = false, wrote = false;
  const deadline = new Promise((resolve) => setTimeout(() => resolve("deadline"), +process.env.ASK_DEADLINE_MS || 50_000));
  try {
    const result = await Promise.race([ai.ask(input, (text) => { if (!finished) { wrote = true; res.write(text); } }), deadline]);
    if (result === "deadline") {
      finished = true;
      console.error("[ai] deadline reached; wrote anything:", wrote);
      res.write(wrote ? "\n\n_(Stopped: the AI took too long to finish.)_" : ai.quickAnswer(input)); // never leave them with nothing
      return res.end();
    }
    finished = true;
    if (access.subId) await pro.consume(access.subId).catch((e) => console.error("[pro] usage count failed:", e.message));
    if (access.user) await accounts.countAi(access.user).catch((e) => console.error("[account] usage count failed:", e.message));
  } catch (e) {
    finished = true;
    console.error("[ai]", e.message);
    // Busy or over the free limit: answer from the app's own data. Setup problems (bad key...): say what's wrong.
    if ([429, 500, 502, 503, 504].includes(e?.status) && !wrote) res.write(ai.quickAnswer(input));
    else res.write("\n\n⚠️ " + ai.friendlyError(e));
  }
  res.end();
}

// POST /api/ask?review=1 {coin, snapshot}: the AI's second opinion on one coin's signal (Pro, like Ask AI).
// Kept for 20 minutes per coin and signal, so repeat views don't use up the AI quota.
const reviewCache = new Map();
async function reviewHandler(req, res) {
  if (req.method !== "POST") return json(res, 405, { reason: "POST only" });
  if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 403, { reason: "Forbidden" });
  if (!ai.hasCredentials()) return json(res, 503, { reason: "The AI isn't connected on this site yet." });
  const access = await askAccess(req, res);
  if (!access) return;
  let b;
  try { b = await readJson(req); } catch (e) { return json(res, e.status || 400, { reason: e.message }); }
  const coin = String(b?.coin || "").toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(coin) || !b.snapshot) return json(res, 400, { reason: "Bad request" });
  const key = coin + ":" + (b.snapshot.coins?.[coin]?.action || "") + ":" + (b.snapshot.timeframe || "");
  const hit = reviewCache.get(key);
  if (hit && Date.now() - hit.at < 20 * 60_000) return json(res, 200, { ...hit.data, cached: true, at: hit.at });
  try {
    const data = await ai.review({ coin, snapshot: b.snapshot });
    reviewCache.set(key, { at: Date.now(), data });
    if (reviewCache.size > 300) reviewCache.delete(reviewCache.keys().next().value);
    if (access.user) await accounts.countAi(access.user).catch(() => {});
    if (access.subId) await pro.consume(access.subId).catch(() => {});
    json(res, 200, { ...data, at: Date.now() });
  } catch (e) {
    console.error("[review]", e.message);
    json(res, e.status && e.status < 600 ? e.status : 502, { reason: e.status === 503 || e.status === 502 || e.status === 400 ? e.message : ai.friendlyError(e) });
  }
}

// GET /api/ask?diag=1 (owner accounts only): a tiny test of the AI provider, step by step with timings.
// Never shows keys; only says whether they're set.
async function askDiag(req, res) {
  const user = await accounts.userFromRequest(req).catch(() => null);
  const plan = user ? await accounts.planOf(user) : null;
  if (plan?.kind !== "owner" || !accounts.isAdmin(user)) return json(res, 403, { reason: "Sign in with the admin account first, then open this page again." });
  json(res, 200, await ai.diagnose());
}

// Public: social buzz for up to 15 coins. GET /api/social?coins=BTC,ETH
async function socialHandler(req, res) {
  const q = new URL(req.url, "http://x").searchParams.get("coins") || "";
  const syms = [...new Set(q.toUpperCase().split(",").filter((s) => /^[A-Z0-9]{1,15}$/.test(s)))].slice(0, 15);
  if (!syms.length) return json(res, 400, { reason: "Pass ?coins=BTC,ETH" });
  const wantFull = new URL(req.url, "http://x").searchParams.get("full") === "1";
  const full = wantFull && (await isPro(req));
  try {
    const data = await getSocial(full ? syms.slice(0, 10) : syms, { full });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": wantFull ? "private, no-store" : "public, max-age=120, s-maxage=300" });
    res.end(JSON.stringify(data));
  } catch (e) {
    json(res, 502, { reason: "Social sources unavailable: " + e.message });
  }
}

// Public: market mood, whole-market numbers and news. GET /api/research?coin=BTC&name=Bitcoin
async function researchHandler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const sym = /^[A-Za-z0-9]{1,15}$/.test(q.get("coin") || "") ? q.get("coin").toUpperCase() : null;
  const name = /^[A-Za-z0-9 .-]{1,40}$/.test(q.get("name") || "") ? q.get("name") : null;
  try {
    const data = await getResearch(sym, name);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=600" });
    res.end(JSON.stringify(data));
  } catch (e) {
    json(res, 502, { reason: "Research sources unavailable: " + e.message });
  }
}

// Public, read-only: balances for a PUBLIC wallet address. GET /api/wallet?chain=btc&address=...
// Never takes usernames, passwords or recovery phrases. Addresses aren't stored or logged.
async function walletHandler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const address = String(q.get("address") || "").trim().slice(0, 120);
  let chain = String(q.get("chain") || "auto").toLowerCase();
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  if (!address) return send(400, { reason: "Paste a public wallet address." });
  if (/\s/.test(address) || address.split(/\s+/).length > 1) return send(400, { reason: "That looks like more than one word. Paste only your public address, never your recovery phrase." });
  if (chain === "auto") {
    const found = wallet.detectChains(address);
    if (!found.length) return send(400, { reason: "We couldn't recognise that address. Pick the network and check you copied the whole address." });
    chain = found[0];
  }
  try {
    send(200, await wallet.getWallet(chain, address));
  } catch (e) {
    console.error("[wallet]", chain, e.message); // the address itself is never logged
    send(e.status || 502, { reason: e.status === 400 ? e.message : "Couldn't reach the blockchain lookup right now. Try again shortly." });
  }
}

// Public: Trench, coins making big moves right now. GET /api/trench
// ?mode=upcoming: young coins getting early traction (GeckoTerminal). Default: big movers (CoinGecko).
async function trenchHandler(req, res) {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const wantFull = q.get("full") === "1";
    const full = wantFull && (await isPro(req));
    let out;
    if (q.get("mode") === "chart") {
      // Price history for one Trench coin's page: ?mode=chart&network=solana&pool=ADDR (Upcoming) or ?mode=chart&id=coingecko-id (Big movers)
      try {
        out = q.get("pool") ? await poolCandles(String(q.get("network") || ""), String(q.get("pool")), String(q.get("tf") || "hour:1")) : await coinCandles(String(q.get("id") || ""), q.get("days") || 30);
      } catch (e) { return json(res, e.status || 502, { reason: e.status === 400 ? e.message : "Price history unavailable right now." }); }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=300" });
      return res.end(JSON.stringify(out));
    }
    if (q.get("mode") === "upcoming") {
      const data = await getUpcoming();
      out = full ? { ...data, full: true } : { ...data, full: false, coins: data.coins.slice(0, FREE_TRENCH), locked: Math.max(0, data.coins.length - FREE_TRENCH) };
    } else {
      const data = await getTrench();
      out = full ? { ...data, full: true } : { ...data, full: false, movers: data.movers.slice(0, FREE_TRENCH), locked: Math.max(0, data.movers.length - FREE_TRENCH) };
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": wantFull ? "private, no-store" : "public, max-age=120, s-maxage=300" });
    res.end(JSON.stringify(out));
  } catch (e) {
    json(res, 502, { reason: "Market scanner unavailable right now: " + e.message });
  }
}

// Public: price candles from Coinbase, passed through so every visitor shares one cache (and isn't
// rate-limited or blocked talking to Coinbase directly). GET /api/candles?sym=BTC&gran=86400[&end=unix]
const GRANS = new Set([60, 300, 900, 3600, 21600, 86400]);
// Order book, recent trades and 24h stats for the trading panel: GET /api/candles?sym=BTC&kind=book|trades|stats
async function marketData(res, sym, kind) {
  const path = { book: "/book?level=2", trades: "/trades?limit=40", stats: "/stats" }[kind];
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD${path}`, { headers: { "User-Agent": "signal-tips/1.0" }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404 || r.status === 400) return json(res, 404, { reason: "not on Coinbase" });
    if (!r.ok) return json(res, 502, { reason: "Coinbase returned " + r.status });
    let d = await r.json();
    if (kind === "book") d = { bids: (d.bids || []).slice(0, 40), asks: (d.asks || []).slice(0, 40), time: d.time };
    const ttl = kind === "stats" ? 10 : 2;
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=10` });
    res.end(JSON.stringify(d));
  } catch { json(res, 504, { reason: "Coinbase didn't answer in time" }); }
}
async function candlesHandler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  if (q.get("kind")) {
    const sym = String(q.get("sym") || "").toUpperCase(), kind = q.get("kind");
    if (!/^[A-Z0-9]{1,15}$/.test(sym) || !["book", "trades", "stats"].includes(kind)) return json(res, 400, { reason: "Bad request" });
    return marketData(res, sym, kind);
  }
  const sym = String(q.get("sym") || "").toUpperCase(), gran = +q.get("gran"), end = q.get("end") ? +q.get("end") : null;
  if (!/^[A-Z0-9]{1,15}$/.test(sym) || !GRANS.has(gran) || (end != null && !(end > 1e9 && end < 4e9))) return json(res, 400, { reason: "Bad request" });
  const range = end ? `&start=${new Date((end - 299 * gran) * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}` : "";
  try {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${gran}${range}`, { headers: { "User-Agent": "signal-tips/1.0" }, signal: AbortSignal.timeout(8000) });
      if (r.status !== 429) break;
      await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1)));
    }
    if (r.status === 404 || r.status === 400) return json(res, 404, { reason: "not on Coinbase" });
    if (!r.ok) return json(res, 502, { reason: "Coinbase returned " + r.status });
    const body = await r.text();
    // Older pages never change: cache them for a day. The newest page: 30 seconds at the edge.
    const ttl = end && end < Date.now() / 1000 - 2 * gran ? 86400 : 30;
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.min(ttl, 60)}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}` });
    res.end(body);
  } catch (e) {
    json(res, 504, { reason: "Coinbase didn't answer in time" });
  }
}

// Exchange rates (1 USD = x), so prices can be shown in the visitor's currency. Coinbase's public rates, cached 1 hour.
const FX_CODES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "JPY", "INR", "MXN", "BRL", "PHP", "NGN", "ZAR", "CHF", "SGD", "HKD", "KRW", "TRY", "SEK", "NOK", "PLN", "AED"];
let fxCache = { at: 0, rates: null };
async function getFx() {
  if (fxCache.rates && Date.now() - fxCache.at < 3600_000) return fxCache.rates;
  try {
    const r = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD", { headers: { "User-Agent": "signal-tips/1.0" }, signal: AbortSignal.timeout(6000) });
    const all = (await r.json())?.data?.rates || {};
    const rates = Object.fromEntries(FX_CODES.filter((c) => +all[c] > 0).map((c) => [c, +(+all[c]).toPrecision(8)]));
    if (rates.CAD) fxCache = { at: Date.now(), rates };
  } catch (e) { console.error("[fx]", e.message); }
  return fxCache.rates;
}

// ───────────── Accounts ─────────────
const FREE_TRENCH = 3;
async function isPro(req) {
  try { const u = await accounts.userFromRequest(req); return u ? (await accounts.planOf(u)).pro : false; } catch { return false; }
}
const isHttps = (req) => ON_VERCEL || req.headers["x-forwarded-proto"] === "https";
const originOf = (req) => (isHttps(req) ? "https://" : "http://") + (req.headers.host || "");

// /api/account?action=me|signup|login|logout|trial|checkout|activate|portal|sync|password|delete
async function accountHandler(req, res) {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "me";
  const send = (status, body, cookie) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) });
    res.end(JSON.stringify(body));
  };
  if (!accounts.available()) return send(503, { reason: "Accounts aren't set up on this site yet." });
  const host = req.headers.host || "";
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return send(400, { reason: "Bad host" });
  // Changes must be same-site JSON posts (blocks other websites from acting for a signed-in visitor).
  if (req.method === "POST" || req.method === "PUT") {
    const origin = req.headers.origin;
    if (!(req.headers["content-type"] || "").startsWith("application/json") || (origin && origin !== originOf(req))) return send(403, { reason: "Forbidden" });
  }
  try {
    if (action === "signup" || action === "login") {
      if (req.method !== "POST") return send(405, { reason: "POST only" });
      const b = await readJson(req);
      if (action === "login") await new Promise((r) => setTimeout(r, 300)); // slow down password guessing
      const u = action === "signup" ? await accounts.signup(b.email, b.password) : await accounts.login(b.email, b.password);
      u.lastSeen = 0; await accounts.touch(u, req).catch(() => {}); // record device, country and the visit
      return send(200, { user: accounts.publicUser(u, await accounts.planOf(u)) }, accounts.sessionCookie(accounts.makeToken(u.id), isHttps(req)));
    }
    if (action === "logout") return send(200, { ok: true }, accounts.clearCookie(isHttps(req)));

    const u = await accounts.userFromRequest(req);
    if (action === "me" && u) await accounts.touch(u, req).catch(() => {});
    if (action === "me") return send(200, u ? { user: accounts.publicUser(u, await accounts.planOf(u)), prefsUpdated: u.prefs?.updated || null } : { user: null });
    if (!u) return send(401, { reason: "Sign in first." });

    if (action === "trial") { if (req.method !== "POST") return send(405, { reason: "POST only" }); await accounts.startTrial(u); return send(200, { user: accounts.publicUser(u, await accounts.planOf(u)) }); }
    if (action === "checkout") {
      if (req.method !== "POST") return send(405, { reason: "POST only" });
      if (!pro.enabled()) return send(503, { reason: "Payments aren't switched on yet. Start the free trial meanwhile." });
      return send(200, { url: await pro.createCheckout(originOf(req), u) });
    }
    if (action === "activate") {
      if (!pro.enabled()) return send(503, { reason: "Payments aren't switched on." });
      u.subId = await pro.subscriptionFor(new URL(req.url, "http://x").searchParams.get("session_id"), u);
      await accounts.saveUser(u);
      return send(200, { user: accounts.publicUser(u, await accounts.planOf(u)) });
    }
    if (action === "portal") {
      if (req.method !== "POST") return send(405, { reason: "POST only" });
      if (!u.subId || !pro.enabled()) return send(400, { reason: "There's no subscription on this account." });
      return send(200, { url: await pro.portalUrl(u.subId, originOf(req)) });
    }
    // Pay for Pro with crypto: get an exact amount to send, then check the transaction
    if (action === "cryptoQuote" || action === "cryptoVerify") {
      if (req.method !== "POST") return send(405, { reason: "POST only" });
      if (!cryptopay.enabled()) return send(503, { reason: "Crypto payments aren't switched on yet." });
      const b = await readJson(req);
      if (action === "cryptoQuote") return send(200, await cryptopay.quote(u, String(b.method || "")));
      const r = await cryptopay.verify(u, b.invoice, b.tx, accounts.saveUser);
      return send(200, { ...r, user: accounts.publicUser(u, await accounts.planOf(u)) });
    }
    if (action === "sync") {
      if (req.method === "PUT") { const b = await readJson(req); return send(200, { updated: await accounts.savePrefs(u, b.prefs) }); }
      return send(200, { prefs: u.prefs?.data || null, updated: u.prefs?.updated || null });
    }
    if (action === "password") { const b = await readJson(req); await accounts.changePassword(u, b.current, b.next); return send(200, { ok: true }); }
    if (action === "delete") { const b = await readJson(req); await accounts.deleteAccount(u, b.password); return send(200, { ok: true }, accounts.clearCookie(isHttps(req))); }

    // Admin panel (owner accounts only). Reads are GET; changes are same-site JSON POSTs (checked above).
    if (action === "admin") {
      if (!accounts.isAdmin(u)) return send(403, { reason: "The admin panel is only for the site's admin account." });
      const op = new URL(req.url, "http://x").searchParams.get("op") || "overview";
      if (req.method === "GET") {
        if (op === "overview") return send(200, await admin.overview());
        if (op === "users") return send(200, { users: await admin.users() });
        if (op === "diag") return send(200, await ai.diagnose());
        return send(400, { reason: "Unknown admin view" });
      }
      if (req.method !== "POST") return send(405, { reason: "POST only" });
      const b = await readJson(req);
      if (op === "user") {
        if (b.id === u.id && ["suspend", "delete", "resetPassword"].includes(b.action)) return send(400, { reason: "You can't do that to your own account here." });
        return send(200, await admin.userAction(b.id, b.action, b));
      }
      if (op === "announce") { const out = await admin.setAnnouncement(b); announceCache = { at: 0, a: null }; return send(200, out); }
      if (op === "broadcast") return send(200, await push.broadcast(b));
      if (op === "pushcheck") return send(200, await push.run({ force: true }));
      return send(400, { reason: "Unknown admin action" });
    }
    return send(400, { reason: "Unknown action" });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error("[account]", action, e.message);
    return send(e.status && e.status < 500 ? e.status : 502, { reason: e.status && e.status < 500 ? e.message : "Something went wrong. Try again shortly." });
  }
}

// Public site settings. COINBASE_REFERRAL_URL: your Coinbase affiliate link (must be an https coinbase.com link).
// GET /api/config?announce=1: only the announcement, polled every 10 s by open pages. Shared at the edge for 5 s
// and kept in memory for 5 s, so many visitors cost one storage read.
let announceCache = { at: 0, a: null };
async function announceOnly(res) {
  if (Date.now() - announceCache.at > 5000) announceCache = { at: Date.now(), a: accounts.available() ? await admin.getAnnouncement().catch(() => null) : null };
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=0, s-maxage=5" });
  res.end(JSON.stringify({ announcement: announceCache.a }));
}
async function configHandler(req, res) {
  if (new URL(req.url || "/", "http://x").searchParams.get("announce") === "1") return announceOnly(res);
  let ref = null;
  try {
    const u = new URL(process.env.COINBASE_REFERRAL_URL || "");
    if (u.protocol === "https:" && /(^|\.)coinbase\.com$/.test(u.hostname)) ref = u.href;
  } catch {}
  let proInfo = { enabled: false };
  if (pro.enabled()) {
    try { proInfo = { enabled: true, price: await pro.getPrice(), monthlyLimit: pro.monthlyLimit() }; }
    catch (e) { console.error("[pro] price lookup failed:", e.message); }
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify({ coinbaseRef: ref, pro: proInfo, fx: await getFx(), fxUpdated: fxCache.at || null,
    accounts: accounts.available(), trialDays: accounts.TRIAL_DAYS, aiConfigured: ai.hasCredentials(), freeTrench: FREE_TRENCH,
    announcement: accounts.available() ? await admin.getAnnouncement().catch(() => null) : null,
    cryptoPay: cryptopay.publicConfig(),
    pushKey: accounts.available() && push.webConfigured() ? push.publicKey() : null, apnsPush: accounts.available() && push.apnsConfigured() }));
}

// Push notifications: /api/push?action=subscribe|unsubscribe|test (same-site JSON posts) and action=run (the scheduled check)
async function pushHandler(req, res) {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";
  try {
    if (action === "run") {
      // Called by the schedulers. Harmless to call: throttled, and a coin only notifies when its state changes.
      const force = Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
      return json(res, 200, await push.run({ force }));
    }
    if (!push.configured()) return json(res, 503, { reason: "Push notifications aren't set up on this site yet." });
    if (req.method !== "POST") return json(res, 405, { reason: "POST only" });
    const origin = req.headers.origin;
    if (!(req.headers["content-type"] || "").startsWith("application/json") || (origin && origin !== originOf(req))) return json(res, 403, { reason: "Forbidden" });
    const b = await readJson(req);
    if (action === "subscribe") return json(res, 200, await push.subscribe(b));
    if (action === "unsubscribe") return json(res, 200, await push.unsubscribe(b));
    if (action === "test") return json(res, 200, await push.test(b));
    return json(res, 400, { reason: "Unknown action" });
  } catch (e) {
    json(res, e.status || 500, { reason: e.status ? e.message : "Something went wrong" });
    if (!e.status) console.error("[push]", e.message);
  }
}

// Pro subscription endpoints: /api/pro?action=checkout|activate|status|portal
async function proHandler(req, res) {
  if (!pro.enabled()) return json(res, 503, { reason: "Pro isn't set up on this site." });
  const url = new URL(req.url, "http://x");
  const action = url.searchParams.get("action");
  const host = req.headers.host || "";
  const origin = (ON_VERCEL || req.headers["x-forwarded-proto"] === "https" ? "https://" : "http://") + host;
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return json(res, 400, { reason: "Bad host" });
  try {
    if (action === "checkout" && req.method === "POST") return json(res, 200, { url: await pro.createCheckout(origin) });
    if (action === "activate") return json(res, 200, { key: await pro.activate(url.searchParams.get("session_id")) });
    if (action === "status" || action === "portal") {
      const c = await pro.check(req.headers["x-pro-key"], { fresh: action === "status" });
      if (!c.subId) return json(res, 401, { pro: false, reason: c.reason });
      if (action === "portal") return json(res, 200, { url: await pro.portalUrl(c.subId, origin) });
      return json(res, 200, { pro: c.ok, reason: c.reason, status: c.status, used: c.used, limit: c.limit, cancelAtPeriodEnd: c.cancelAtPeriodEnd, periodEnd: c.periodEnd });
    }
    return json(res, 400, { reason: "Unknown action" });
  } catch (e) {
    console.error("[pro]", e.message);
    return json(res, e.status && e.status < 500 ? e.status : 502, { reason: e.status && e.status < 500 ? e.message : "Payment service unavailable. Try again shortly." });
  }
}

module.exports = { holdingsHandler, askHandler, socialHandler, configHandler, proHandler, researchHandler, walletHandler, trenchHandler, candlesHandler, accountHandler, pushHandler, authorize };

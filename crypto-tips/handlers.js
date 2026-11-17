// API handlers shared by the local server (server.js) and Vercel functions (api/).
// Both use plain Node (req, res) objects.
const crypto = require("crypto");
const { loadKey, getHoldings } = require("./coinbase.js");
const ai = require("./ai.js");
const { getSocial } = require("./social.js");
const pro = require("./pro.js");
const { getResearch } = require("./research.js");
const wallet = require("./wallet.js");

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
  const proKey = req.headers["x-pro-key"];
  if (pro.enabled() && proKey) {
    const c = await pro.check(proKey);
    if (!c.ok) { json(res, 402, { error: "pro", reason: c.reason }); return null; }
    if (c.used >= c.limit) { json(res, 429, { error: "limit", reason: `You've used all ${c.limit} AI questions for this month. They reset on the 1st.` }); return null; }
    return { subId: c.subId };
  }
  const password = process.env.APP_PASSWORD;
  const isOwner = password && sameSecret(req.headers["x-app-password"] || "", password);
  if (pro.enabled() && ON_VERCEL && !isOwner) { json(res, 402, { error: "pro", reason: "Ask AI is a Pro feature." }); return null; }
  return (await authorize(req, res)) ? {} : null;
}

async function askHandler(req, res) {
  if (req.method !== "POST") return json(res, 405, { reason: "POST only" });
  if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 403, { reason: "Forbidden" });
  const access = await askAccess(req, res);
  if (!access) return;
  let input;
  try { input = await readJson(req); } catch (e) { return json(res, e.status || 400, { reason: e.message }); }
  if (!input || typeof input.question !== "string" || !input.question.trim()) return json(res, 400, { reason: "Missing question" });
  if (JSON.stringify(input).length > 300_000) return json(res, 413, { reason: "Too much data" });

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  try {
    await ai.ask(input, (text) => res.write(text));
    if (access.subId) await pro.consume(access.subId).catch((e) => console.error("[pro] usage count failed:", e.message));
  } catch (e) {
    console.error("[ai]", e.message);
    res.write("\n\n⚠️ " + ai.friendlyError(e));
  }
  res.end();
}

// Public: social buzz for up to 15 coins. GET /api/social?coins=BTC,ETH
async function socialHandler(req, res) {
  const q = new URL(req.url, "http://x").searchParams.get("coins") || "";
  const syms = [...new Set(q.toUpperCase().split(",").filter((s) => /^[A-Z0-9]{1,15}$/.test(s)))].slice(0, 15);
  if (!syms.length) return json(res, 400, { reason: "Pass ?coins=BTC,ETH" });
  try {
    const data = await getSocial(syms);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=300" });
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

// Public site settings. COINBASE_REFERRAL_URL: your Coinbase affiliate link (must be an https coinbase.com link).
async function configHandler(req, res) {
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
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" });
  res.end(JSON.stringify({ coinbaseRef: ref, pro: proInfo }));
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

module.exports = { holdingsHandler, askHandler, socialHandler, configHandler, proHandler, researchHandler, walletHandler, authorize };

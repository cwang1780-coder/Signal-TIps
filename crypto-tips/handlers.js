// API handlers shared by the local server (server.js) and Vercel functions (api/).
// Both use plain Node (req, res) objects.
const crypto = require("crypto");
const { loadKey, getHoldings } = require("./coinbase.js");
const ai = require("./ai.js");
const { getSocial } = require("./social.js");

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

async function askHandler(req, res) {
  if (req.method !== "POST") return json(res, 405, { reason: "POST only" });
  if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 403, { reason: "Forbidden" });
  if (!(await authorize(req, res))) return;
  let input;
  try { input = await readJson(req); } catch (e) { return json(res, e.status || 400, { reason: e.message }); }
  if (!input || typeof input.question !== "string" || !input.question.trim()) return json(res, 400, { reason: "Missing question" });
  if (JSON.stringify(input).length > 300_000) return json(res, 413, { reason: "Too much data" });

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  try {
    await ai.ask(input, (text) => res.write(text));
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

module.exports = { holdingsHandler, askHandler, socialHandler, authorize };

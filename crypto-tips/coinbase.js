// Coinbase Advanced Trade API client (read-only use). Node only, no dependencies.
// Auth: CDP API key -> short-lived JWT per request (ES256 or Ed25519 keys both supported).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HOST = "api.coinbase.com";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// Loads { name, privateKey } from env vars or coinbase-key.json (the file CDP lets you download).
function loadKey(dir = __dirname) {
  let name = process.env.COINBASE_API_KEY_NAME;
  let privateKey = process.env.COINBASE_API_PRIVATE_KEY;
  const file = path.join(dir, "coinbase-key.json");
  if ((!name || !privateKey) && fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    name = j.name || j.id;
    privateKey = j.privateKey;
  }
  if (!name || !privateKey) return null;
  return { name, privateKey: privateKey.replace(/\\n/g, "\n").trim() };
}

function parsePrivateKey(pk) {
  if (pk.includes("BEGIN")) return { alg: "ES256", key: crypto.createPrivateKey(pk) };
  // Ed25519: base64 of 64 bytes (32-byte seed + 32-byte public key)
  const raw = Buffer.from(pk, "base64");
  if (raw.length !== 64) throw new Error("Unrecognised private key format");
  const key = crypto.createPrivateKey({
    format: "jwk",
    key: { kty: "OKP", crv: "Ed25519", d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) },
  });
  return { alg: "EdDSA", key };
}

function buildJwt(creds, method, pathname) {
  const { alg, key } = parsePrivateKey(creds.privateKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg, kid: creds.name, nonce: crypto.randomBytes(16).toString("hex"), typ: "JWT" };
  const payload = { sub: creds.name, iss: "cdp", nbf: now, exp: now + 120, uri: `${method} ${HOST}${pathname}` };
  const data = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const sig = alg === "ES256"
    ? crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" })
    : crypto.sign(null, Buffer.from(data), key);
  return data + "." + b64url(sig);
}

async function cbGet(creds, pathname, query = "") {
  const res = await fetch(`https://${HOST}${pathname}${query}`, {
    headers: { Authorization: "Bearer " + buildJwt(creds, "GET", pathname) },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(res.status === 401 ? "Coinbase rejected the API key (401). Check the key name/private key and that it has View permission."
      : `Coinbase API error ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

// Returns [{ sym, amt, cost }] for every non-zero crypto balance. cost = average entry price in USD when Coinbase provides it.
async function getHoldings(creds) {
  const balances = {};
  let cursor = "";
  do {
    const q = "?limit=250" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const page = await cbGet(creds, "/api/v3/brokerage/accounts", q);
    for (const a of page.accounts || []) {
      const amt = parseFloat(a.available_balance?.value || 0) + parseFloat(a.hold?.value || 0);
      if (amt > 0) balances[a.currency] = (balances[a.currency] || 0) + amt;
    }
    cursor = page.has_next ? page.cursor : "";
  } while (cursor);

  // Best effort: average entry prices from the portfolio breakdown.
  const cost = {};
  try {
    const { portfolios = [] } = await cbGet(creds, "/api/v3/brokerage/portfolios");
    for (const p of portfolios) {
      const b = await cbGet(creds, `/api/v3/brokerage/portfolios/${p.uuid}`);
      for (const s of b.breakdown?.spot_positions || []) {
        const v = parseFloat(s.average_entry_price?.value);
        if (v > 0) cost[s.asset] = v;
      }
    }
  } catch { /* cost basis is optional */ }

  const FIAT = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "USDC", "USDT", "DAI", "PYUSD"]);
  const holdings = Object.entries(balances)
    .filter(([sym]) => !FIAT.has(sym))
    .map(([sym, amt]) => ({ sym, amt, cost: cost[sym] || 0, source: "coinbase" }));
  const cash = Object.entries(balances).filter(([sym]) => FIAT.has(sym)).map(([sym, amt]) => ({ sym, amt }));
  return { holdings, cash };
}

module.exports = { loadKey, buildJwt, getHoldings, parsePrivateKey };

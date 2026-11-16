// Run: node test-coinbase.js  (no real key needed; uses generated keys and a mocked API)
const assert = require("assert");
const crypto = require("crypto");
const cb = require("./coinbase.js");

const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
function verify(jwt, pub, alg) {
  const [h, p, sig] = jwt.split(".");
  const data = Buffer.from(h + "." + p), s = Buffer.from(sig, "base64url");
  return alg === "ES256" ? crypto.verify("sha256", data, { key: pub, dsaEncoding: "ieee-p1363" }, s) : crypto.verify(null, data, pub, s);
}

// ECDSA (PEM) key
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecCreds = { name: "organizations/x/apiKeys/y", privateKey: ec.privateKey.export({ type: "sec1", format: "pem" }) };
const j1 = cb.buildJwt(ecCreds, "GET", "/api/v3/brokerage/accounts");
assert.strictEqual(dec(j1.split(".")[0]).alg, "ES256");
assert.strictEqual(dec(j1.split(".")[1]).uri, "GET api.coinbase.com/api/v3/brokerage/accounts");
assert(verify(j1, ec.publicKey, "ES256"), "ES256 signature");

// Ed25519 (base64 seed+pub) key
const ed = crypto.generateKeyPairSync("ed25519");
const jwk = ed.privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64");
const j2 = cb.buildJwt({ name: "key-id", privateKey: raw }, "GET", "/api/v3/brokerage/accounts");
assert.strictEqual(dec(j2.split(".")[0]).alg, "EdDSA");
assert(verify(j2, ed.publicKey, "EdDSA"), "EdDSA signature");

// Mocked API: pagination, hold balances, fiat split, cost basis
const realFetch = global.fetch;
global.fetch = async (url) => {
  const u = new URL(url);
  const body = u.pathname.endsWith("/accounts")
    ? (u.searchParams.get("cursor")
        ? { accounts: [{ currency: "ETH", available_balance: { value: "2" }, hold: { value: "0.5" } }], has_next: false }
        : { accounts: [{ currency: "BTC", available_balance: { value: "0.1" }, hold: { value: "0" } },
                       { currency: "USD", available_balance: { value: "150.25" }, hold: { value: "0" } },
                       { currency: "SOL", available_balance: { value: "0" }, hold: { value: "0" } }], has_next: true, cursor: "c1" })
    : u.pathname.endsWith("/portfolios") ? { portfolios: [{ uuid: "p1" }] }
    : { breakdown: { spot_positions: [{ asset: "BTC", average_entry_price: { value: "50000" } }] } };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
(async () => {
  const r = await cb.getHoldings(ecCreds);
  assert.deepStrictEqual(r.holdings, [
    { sym: "BTC", amt: 0.1, cost: 50000, source: "coinbase" },
    { sym: "ETH", amt: 2.5, cost: 0, source: "coinbase" },
  ]);
  assert.deepStrictEqual(r.cash, [{ sym: "USD", amt: 150.25 }]);

  // Real Coinbase endpoint with a made-up key should be rejected cleanly
  global.fetch = realFetch;
  await assert.rejects(cb.getHoldings(ecCreds), (e) => e.status === 401 || e.status === 403 || /Coinbase/.test(e.message));
  console.log("coinbase tests passed");
})();

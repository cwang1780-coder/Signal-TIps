// Run: node test-upcoming.js — Trench "Upcoming" filters and scoring (offline, sample pools)
const assert = require("assert");
const { candidate } = require("./upcoming.js");
const now = Date.parse("2026-11-19T12:00:00Z");
const pool = (o = {}) => ({
  id: "solana_POOL", relationships: { dex: { data: { id: "raydium" } } },
  attributes: {
    name: "NEWC / SOL", address: "POOL", base_token_price_usd: "0.0123", pool_created_at: new Date(now - (o.ageH ?? 48) * 3.6e6).toISOString(),
    reserve_in_usd: String(o.liq ?? 300000), fdv_usd: String(o.fdv ?? 5e6), volume_usd: { h1: String(o.vol1 ?? 60000), h24: String(o.vol24 ?? 900000) },
    price_change_percentage: { h1: "4", h6: String(o.ch6 ?? 20), h24: String(o.ch24 ?? 60) },
    transactions: { h1: {}, h24: { buyers: o.buyers ?? 1200, sellers: o.sellers ?? 700 } },
  },
});
const token = (sym = "NEWC", address = "NewcTokenMint111111111111111111111111111pump") => ({ attributes: { symbol: sym, name: "New Coin", address, image_url: "https://x/img.png" } });

// A healthy young coin passes, with sensible fields
const c = candidate(pool(), token(), "solana", now);
assert.ok(c, "passes");
assert.strictEqual(c.stage, "Early");
assert.strictEqual(c.chain, "solana");
assert.strictEqual(c.risk, "extreme", "under 3 days old is extreme risk");
assert.ok(c.flags.some((f) => /pump\.fun/.test(f)), "pump.fun launch flagged");
assert.ok(c.accel > 1.5, "last hour busier than average");
assert.ok(c.url.includes("geckoterminal.com/solana/pools/POOL"));

// Filters: too old, thin, quiet, few buyers, too big, dumping, not a new coin
assert.strictEqual(candidate(pool({ ageH: 24 * 30 }), token(), "solana", now), null, "older than 3 weeks");
assert.strictEqual(candidate(pool({ liq: 10000 }), token(), "solana", now), null, "too little liquidity");
assert.strictEqual(candidate(pool({ vol24: 20000 }), token(), "solana", now), null, "too little volume");
assert.strictEqual(candidate(pool({ buyers: 40 }), token(), "solana", now), null, "too few buyers");
assert.strictEqual(candidate(pool({ fdv: 900e6 }), token(), "solana", now), null, "already big");
assert.strictEqual(candidate(pool({ ch24: -60 }), token(), "solana", now), null, "dumping");
assert.strictEqual(candidate(pool(), token("USDC"), "solana", now), null, "stablecoin isn't an upcoming coin");

// Scoring: more buyers than sellers and an active last hour rank higher than the opposite
const good = candidate(pool({ buyers: 3000, sellers: 1000, vol1: 120000 }), token(), "solana", now);
const weak = candidate(pool({ buyers: 900, sellers: 1500, vol1: 5000, ch6: -10 }), token(), "solana", now);
assert.ok(good.score > weak.score, "traction ranks higher");
assert.ok(weak.flags.includes("More sellers than buyers"));
// Thin liquidity is flagged and raises the risk
const thin = candidate(pool({ liq: 60000, ageH: 24 * 10 }), token(), "solana", now);
assert.strictEqual(thin.risk, "extreme");
assert.ok(thin.flags.some((f) => /Thin liquidity/.test(f)));
const older = candidate(pool({ ageH: 24 * 10 }), token(), "solana", now);
assert.strictEqual(older.stage, "Gaining traction");
assert.strictEqual(older.risk, "very high");
console.log("upcoming tests passed");

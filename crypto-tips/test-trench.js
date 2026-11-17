// Run: node test-trench.js — Trench market scanner (offline, mocked market APIs)
const assert = require("assert");
const { chaseRisk } = require("./trench.js");

assert.strictEqual(chaseRisk(120, 5, 0.2), "very high");
assert.strictEqual(chaseRisk(40, 55, 0.2), "very high");
assert.strictEqual(chaseRisk(40, 5, 1.5), "very high");
assert.strictEqual(chaseRisk(40, 5, 0.2), "high");

const coin = (id, symbol, ch7, ch24, vol = 5e6, mc = 5e7) => ({ id, symbol, name: id, current_price: 1, market_cap: mc, market_cap_rank: 100, total_volume: vol,
  price_change_percentage_7d_in_currency: ch7, price_change_percentage_24h_in_currency: ch24 });
global.fetch = async (url) => {
  const u = String(url);
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  if (u.includes("/coins/markets") && u.includes("page=1")) return json([
    coin("rocket", "rkt", 150, 10), coin("steady", "std", 35, 2), coin("flat", "flt", 3, 1), coin("tether", "usdt", 40, 0),
    coin("tiny", "tny", 300, 50, 1e5), coin("daypop", "pop", 5, 25), coin("rocket-dup", "rkt", 90, 1),
  ]);
  if (u.includes("/coins/markets")) return json([]);
  if (u.includes("/search/trending")) return json({ coins: [{ item: { id: "steady" } }] });
  if (u.includes("exchange.coinbase.com/products")) return json([{ base_currency: "STD", quote_currency: "USD", status: "online" }]);
  return { ok: false, status: 404, json: async () => ({}) }; // social lookups fail quietly
};

(async () => {
  const { getTrench } = require("./trench.js");
  const { movers } = await getTrench();
  assert.deepStrictEqual(movers.map((m) => m.sym), ["RKT", "STD", "POP"], "filters flat coins, stablecoins, tiny volume and duplicates; sorted by 7d");
  const std = movers.find((m) => m.sym === "STD");
  assert.strictEqual(std.onCoinbase, true);
  assert.strictEqual(std.trendingRank, 1);
  assert.strictEqual(std.risk, "high");
  assert.strictEqual(movers[0].risk, "very high");
  assert.strictEqual(movers[0].bucket, "surgeOver100");
  assert.strictEqual(std.bucket, "surge30to60");

  const { trenchHandler } = require("./handlers.js");
  let status, body;
  await trenchHandler({ url: "/api/trench", headers: {} }, { writeHead: (s) => (status = s), end: (b) => (body = b) });
  assert.strictEqual(status, 200);
  assert.strictEqual(JSON.parse(body).movers.length, 3);
  console.log("trench tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

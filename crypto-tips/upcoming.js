// Trench "Upcoming": young coins that are starting to get real traction, before they show up as big 7-day winners.
// Source: GeckoTerminal's free public API (new and trending trading pools across blockchains).
// Most brand-new tokens are junk, so a coin only shows up if it already has:
//   enough liquidity to trade, real volume, lots of distinct buyers, and isn't already dumping.
// It describes early traction. It cannot tell which coins will succeed: most new coins fail, and many are scams.
const UA = { "User-Agent": "signal-tips/1.0", Accept: "application/json;version=20230302" };
const TTL = 5 * 60 * 1000;
const GT = "https://api.geckoterminal.com/api/v2";
let cache = { at: 0, data: null };

// GeckoTerminal network id -> chain name used for swap links in the app, and a display name
const NETWORKS = {
  solana: ["solana", "Solana"], eth: ["ethereum", "Ethereum"], base: ["base", "Base"], bsc: ["binance-smart-chain", "BNB Chain"],
  arbitrum: ["arbitrum-one", "Arbitrum"], polygon_pos: ["polygon-pos", "Polygon"], optimism: ["optimistic-ethereum", "Optimism"], ton: ["the-open-network", "TON"],
};
const NOT_NEW = new Set(["usdc", "usdt", "dai", "weth", "wbtc", "sol", "wsol", "eth", "bnb", "wbnb", "cbbtc", "usd1", "usde", "fdusd", "pyusd", "ton", "pol", "matic", "arb", "op"]);

const PATHS = [
  "/networks/trending_pools?include=base_token&duration=1h&page=1",
  "/networks/trending_pools?include=base_token&duration=6h&page=1",
  "/networks/trending_pools?include=base_token&duration=24h&page=1",
  "/networks/trending_pools?include=base_token&duration=6h&page=2",
  "/networks/new_pools?include=base_token&page=1",
  "/networks/new_pools?include=base_token&page=2",
  "/networks/solana/trending_pools?include=base_token&page=1",
  "/networks/base/trending_pools?include=base_token&page=1",
  "/networks/eth/trending_pools?include=base_token&page=1",
  "/networks/bsc/trending_pools?include=base_token&page=1",
];

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

const num = (v) => (v == null || v === "" ? null : +v);
const netOf = (pool, path) => pool.relationships?.network?.data?.id || (path.match(/\/networks\/([a-z0-9_]+)\//) || [])[1] ||
  Object.keys(NETWORKS).find((n) => String(pool.id).startsWith(n + "_")) || String(pool.id).split("_")[0];

// Turn one pool into a candidate, or null if it doesn't pass the traction filters.
function candidate(pool, token, network, now = Date.now()) {
  const a = pool.attributes || {}, t = token?.attributes || {};
  const sym = String(t.symbol || a.name?.split(" / ")[0] || "").trim().slice(0, 20);
  if (!sym || NOT_NEW.has(sym.toLowerCase().replace(/^\$/, ""))) return null;
  const created = Date.parse(a.pool_created_at), ageH = (now - created) / 3.6e6;
  const liq = num(a.reserve_in_usd), fdv = num(a.fdv_usd) ?? num(a.market_cap_usd);
  const vol = a.volume_usd || {}, ch = a.price_change_percentage || {}, tx24 = a.transactions?.h24 || {}, tx1 = a.transactions?.h1 || {};
  const vol24 = num(vol.h24) || 0, vol1 = num(vol.h1) || 0;
  const buyers = tx24.buyers ?? tx24.buys ?? 0, sellers = tx24.sellers ?? tx24.sells ?? 0;
  const ch1 = num(ch.h1), ch6 = num(ch.h6), ch24 = num(ch.h24);
  // Traction filters
  if (!(ageH >= 0 && ageH <= 21 * 24)) return null;          // young: under 3 weeks
  if (!(liq >= 40_000)) return null;                          // enough cash in the pool to buy and sell
  if (!(vol24 >= 75_000)) return null;                        // real trading
  if (buyers < 150) return null;                              // lots of different wallets, not a handful
  if (fdv != null && fdv > 200e6) return null;                // still small
  if (ch24 != null && ch24 < -30) return null;                // not already dumping
  const buyRatio = buyers + sellers ? buyers / (buyers + sellers) : 0.5;
  const accel = vol24 ? (vol1 * 24) / vol24 : 0;               // >1: the last hour is busier than the day's average
  let score = Math.min(3, Math.max(0, Math.log10(vol24 / 1e5) + 1));
  score += buyRatio >= 0.55 ? 1.5 : buyRatio >= 0.5 ? 0.5 : -1;
  score += accel >= 1.5 ? 1.5 : accel >= 1 ? 0.5 : 0;
  score += ch6 != null ? (ch6 > 0 ? 1 : -0.5) : 0;
  score += liq >= 250_000 ? 1 : 0;
  score += Math.min(1.5, Math.log10(Math.max(buyers, 1) / 150));
  if (ch24 != null && ch24 > 500) score -= 1;                 // already exploded: later, riskier entry
  const address = t.address || null;
  const flags = [];
  if (ageH < 24) flags.push("Less than a day old");
  if (liq < 100_000) flags.push("Thin liquidity: big trades move the price a lot, and it can be hard to sell");
  if (buyRatio < 0.45) flags.push("More sellers than buyers");
  if (ch24 != null && ch24 > 300) flags.push(`Already up ${Math.round(ch24)}% today: a late entry`);
  if (address && /pump$/i.test(address)) flags.push("Launched on pump.fun, a meme-coin launchpad");
  if (fdv != null && fdv < 1e6) flags.push("Tiny: valued under $1M");
  const [chain, netName] = NETWORKS[network] || [null, network];
  return {
    sym, name: String(t.name || sym).slice(0, 50), image: t.image_url && !/missing/.test(t.image_url) ? t.image_url : null,
    network, netName, chain, address, pool: a.address, dex: pool.relationships?.dex?.data?.id || null,
    ageH: +ageH.toFixed(1), stage: ageH < 24 ? "Just launched" : ageH < 7 * 24 ? "Early" : "Gaining traction",
    price: num(a.base_token_price_usd), liq, vol24, vol1, fdv, ch1, ch6, ch24, buyers, sellers, buyRatio: +buyRatio.toFixed(2), accel: +accel.toFixed(2),
    score: +score.toFixed(2), risk: ageH < 72 || liq < 100_000 ? "extreme" : "very high", flags,
    url: `https://www.geckoterminal.com/${encodeURIComponent(network)}/pools/${encodeURIComponent(a.address)}`,
  };
}

async function getUpcoming() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  const byToken = new Map();
  let ok = 0;
  for (let i = 0; i < PATHS.length; i += 3) { // small batches: GeckoTerminal's free limit is about 30 calls a minute
    const batch = await Promise.allSettled(PATHS.slice(i, i + 3).map((p) => getJSON(GT + p).then((d) => [p, d])));
    for (const r of batch) {
      if (r.status !== "fulfilled") continue;
      ok++;
      const [path, d] = r.value;
      const tokens = new Map((d.included || []).map((t) => [t.id, t]));
      for (const pool of d.data || []) {
        const network = netOf(pool, path), tokId = pool.relationships?.base_token?.data?.id;
        const c = candidate(pool, tokens.get(tokId), network);
        if (!c) continue;
        const key = tokId || network + ":" + c.sym, prev = byToken.get(key);
        if (!prev || c.liq > prev.liq) byToken.set(key, c); // keep the deepest pool for each coin
      }
    }
  }
  if (!ok) throw new Error("GeckoTerminal unavailable");
  const coins = [...byToken.values()].sort((a, b) => b.score - a.score).slice(0, 20);
  cache = { at: Date.now(), data: { updated: Date.now(), coins, scanned: PATHS.length } };
  return cache.data;
}

// Hourly price candles for one pool (for the coin page). Newest last, in the app's candle format.
const chartCache = new Map();
async function poolCandles(network, pool) {
  if (!/^[a-z0-9_]{2,30}$/.test(network) || !/^[A-Za-z0-9_-]{20,100}$/.test(pool)) throw Object.assign(new Error("Bad coin"), { status: 400 });
  const key = network + ":" + pool, hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const d = await getJSON(`${GT}/networks/${network}/pools/${pool}/ohlcv/hour?aggregate=1&limit=500&currency=usd`);
  const list = d.data?.attributes?.ohlcv_list || [];
  const candles = list.map(([t, o, h, l, c, v]) => ({ time: t, open: +o, high: +h, low: +l, close: +c, volume: +v })).filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
  const data = { candles, interval: "1h", source: "GeckoTerminal" };
  chartCache.set(key, { at: Date.now(), data });
  if (chartCache.size > 300) chartCache.delete(chartCache.keys().next().value);
  return data;
}

module.exports = { getUpcoming, candidate, NETWORKS, poolCandles };

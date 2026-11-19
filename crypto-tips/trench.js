// Trench: a live radar of coins making big moves right now.
// Sources (free, no keys): CoinGecko markets + trending searches, Coinbase product list, StockTwits buzz.
// It shows what is surging and how risky chasing it has been historically (see tools/trench-study.js); it does not pick winners.
const { getSocial } = require("./social.js");

const UA = { "User-Agent": "signal-tips/1.0", Accept: "application/json" };
const TTL = 5 * 60 * 1000;
const cache = new Map();
const cached = async (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
};
const getJSON = async (url) => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};

const SKIP = new Set(["usdt", "usdc", "dai", "fdusd", "tusd", "usde", "usds", "pyusd", "busd", "usdd", "frax", "rlusd", "eurc", "gusd", "wbtc", "weth", "steth", "wsteth", "cbbtc", "cbeth", "weeth", "reth", "jitosol", "msol", "bsc-usd", "susde", "usd1"]);

const coinbaseList = () => cached("cb-products", 60 * 60 * 1000, async () => {
  const d = await getJSON("https://api.exchange.coinbase.com/products");
  return new Set(d.filter((p) => p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled).map((p) => p.base_currency.toUpperCase()));
});
const markets = () => cached("cg-markets", TTL, async () => {
  const pages = await Promise.all([1, 2].map((page) => getJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=${page}&price_change_percentage=24h,7d`).catch(() => [])));
  return pages.flat();
});
const trending = () => cached("cg-trending", TTL, async () => {
  const d = await getJSON("https://api.coingecko.com/api/v3/search/trending");
  return new Map((d.coins || []).map((c, i) => [c.item?.id, i + 1]));
});

// How risky chasing this move has been, from the size of the run-up and how frantic the trading is.
function chaseRisk(ch7, ch24, turnover) {
  if (ch7 >= 100 || ch24 >= 50 || turnover >= 1) return "very high";
  return "high";
}
const bucketOf = (ch7, vol) => (vol > 5e6 * 30 && ch7 < 100 ? null : ch7 >= 100 ? "surgeOver100" : ch7 >= 60 ? "surge60to100" : "surge30to60");

// A coin's home blockchain and token address (CoinGecko). Cached for a day: these don't change.
const contractCache = new Map();
async function contractOf(id) {
  const hit = contractCache.get(id);
  if (hit && Date.now() - hit.at < 864e5) return hit.data;
  const d = await getJSON(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
  const platforms = d.platforms || {};
  const chain = d.asset_platform_id || Object.keys(platforms).find((k) => k && platforms[k]) || null;
  const data = chain && platforms[chain] ? { chain, address: platforms[chain] } : { chain: null, address: null }; // null = the coin has its own blockchain
  contractCache.set(id, { at: Date.now(), data });
  return data;
}

async function getTrench() {
  return cached("trench", TTL, async () => {
    const [m, tr, cb] = await Promise.all([markets(), trending().catch(() => new Map()), coinbaseList().catch(() => new Set())]);
    if (!m.length) throw new Error("market data unavailable");
    const seen = new Set();
    const movers = m.filter((c) => {
      const sym = String(c.symbol || "").toLowerCase();
      if (!sym || SKIP.has(sym) || SKIP.has(c.id) || seen.has(sym)) return false;
      seen.add(sym);
      const ch7 = c.price_change_percentage_7d_in_currency, ch24 = c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h;
      return c.market_cap >= 1e6 && c.total_volume >= 2e5 && ((ch7 ?? 0) >= 30 || (ch24 ?? 0) >= 20);
    }).map((c) => {
      const ch7 = c.price_change_percentage_7d_in_currency ?? 0, ch24 = c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0;
      const turnover = c.market_cap ? c.total_volume / c.market_cap : 0, sym = c.symbol.toUpperCase();
      return {
        sym, name: String(c.name).slice(0, 40), id: c.id, price: c.current_price, ch24: +ch24.toFixed(1), ch7: +ch7.toFixed(1),
        volume: c.total_volume, marketCap: c.market_cap, rank: c.market_cap_rank, turnover: +turnover.toFixed(3),
        trendingRank: tr.get(c.id) || null, onCoinbase: cb.has(sym), risk: chaseRisk(ch7, ch24, turnover), bucket: bucketOf(ch7, c.total_volume),
        url: `https://www.coingecko.com/en/coins/${encodeURIComponent(c.id)}`,
      };
    }).sort((a, b) => b.ch7 - a.ch7).slice(0, 24);

    // Token addresses for the coins people might want to buy (small batches to stay under CoinGecko's free limit)
    const need = movers.filter((x) => !x.onCoinbase).slice(0, 16);
    for (let i = 0; i < need.length; i += 4) {
      await Promise.all(need.slice(i, i + 4).map(async (x) => { try { Object.assign(x, await contractOf(x.id)); } catch {} }));
    }

    // Social buzz for the top movers (StockTwits covers the better-known coins)
    const top = movers.slice(0, 12).map((x) => x.sym).filter((s) => /^[A-Z0-9]{1,15}$/.test(s));
    try {
      const soc = await getSocial(top);
      for (const x of movers) {
        const s = soc.coins[x.sym];
        if (s && !s.error) x.social = { hype: s.hype, bullishPct: s.bullishPct, tagged: s.tagged, postsPerHour: s.postsPerHour, url: s.url };
      }
    } catch {}
    return { updated: Date.now(), movers };
  });
}

// 4-hour price candles for the last 30 days of a coin (CoinGecko), for the coin page.
const chartCache = new Map();
// days: 1 (30-minute candles) or 30 (4-hour candles), as CoinGecko's free OHLC endpoint provides
async function coinCandles(id, days = 30) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw Object.assign(new Error("Bad coin"), { status: 400 });
  days = [1, 7, 14, 30].includes(+days) ? +days : 30;
  const key = id + ":" + days, hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const rows = await getJSON(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`);
  const candles = (Array.isArray(rows) ? rows : []).map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c, volume: 0 })).filter((c) => c.close > 0);
  const data = { candles, interval: days <= 2 ? "30m" : "4h", source: "CoinGecko" };
  chartCache.set(key, { at: Date.now(), data });
  if (chartCache.size > 300) chartCache.delete(chartCache.keys().next().value);
  return data;
}

module.exports = { getTrench, chaseRisk, coinCandles };

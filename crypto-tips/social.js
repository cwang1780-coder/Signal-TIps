// Social "buzz": what people are saying about each coin. Public data only, no keys needed.
// - StockTwits: recent posts per coin, many tagged Bullish/Bearish by their authors.
// - CoinGecko trending: the coins people are searching for most right now.
const UA = { "User-Agent": "crypto-signal-tips/1.0", Accept: "application/json" };
const TTL = 5 * 60 * 1000;
const cache = new Map(); // key -> {at, data}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const clean = (s, n = 280) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Summarise a StockTwits stream: sentiment counts, posting rate, and the latest posts.
function summarizeStream(data, now = Date.now()) {
  const msgs = data.messages || [];
  let bullish = 0, bearish = 0;
  const times = [];
  const posts = msgs.map((m) => {
    const s = m.entities?.sentiment?.basic || null;
    if (s === "Bullish") bullish++;
    if (s === "Bearish") bearish++;
    const t = Date.parse(m.created_at);
    if (!isNaN(t)) times.push(t);
    const user = clean(m.user?.username, 40);
    return {
      text: clean(m.body),
      user,
      followers: m.user?.followers ?? null,
      sentiment: s,
      time: m.created_at,
      likes: m.likes?.total ?? 0,
      url: user && m.id ? `https://stocktwits.com/${encodeURIComponent(user)}/message/${encodeURIComponent(m.id)}` : null,
    };
  });
  // Posts per hour, measured over the window the latest posts cover (min 15 minutes so bursts don't explode the rate).
  let perHour = null;
  if (times.length >= 2) {
    const spanH = Math.max((now - Math.min(...times)) / 3.6e6, 0.25);
    perHour = +(times.length / spanH).toFixed(1);
  }
  const tagged = bullish + bearish;
  return {
    source: "StockTwits",
    watchers: data.symbol?.watchlist_count ?? null,
    bullish, bearish, tagged,
    bullishPct: tagged ? Math.round((bullish / tagged) * 100) : null,
    postsPerHour: perHour,
    posts: posts.slice(0, 8),
    url: `https://stocktwits.com/symbol/${encodeURIComponent(data.symbol?.symbol || "")}`,
  };
}

function getCoinSocial(sym) {
  return cached("st:" + sym, async () => summarizeStream(await getJson(`https://api.stocktwits.com/api/2/streams/symbol/${sym}.X.json`)));
}

function getTrending() {
  return cached("trending", async () => {
    const d = await getJson("https://api.coingecko.com/api/v3/search/trending");
    return (d.coins || []).slice(0, 15).map((c, i) => ({
      rank: i + 1,
      symbol: clean(c.item?.symbol, 15).toUpperCase(),
      name: clean(c.item?.name, 60),
      marketCapRank: c.item?.market_cap_rank ?? null,
      change24hPct: c.item?.data?.price_change_percentage_24h?.usd != null ? +c.item.data.price_change_percentage_24h.usd.toFixed(2) : null,
      url: c.item?.id ? `https://www.coingecko.com/en/coins/${encodeURIComponent(c.item.id)}` : null,
    }));
  });
}

// Hype level from posting rate, crowd lean, and whether it's trending. Purely descriptive.
function hypeLevel(s, trendingRank) {
  let pts = 0;
  if (s?.postsPerHour >= 60) pts += 2; else if (s?.postsPerHour >= 15) pts += 1;
  if (s?.bullishPct != null && s.tagged >= 5 && (s.bullishPct >= 85 || s.bullishPct <= 15)) pts += 1; // one-sided crowd
  if (trendingRank) pts += trendingRank <= 5 ? 2 : 1;
  return pts >= 4 ? "very high" : pts >= 2 ? "high" : pts >= 1 ? "moderate" : "low";
}

async function getSocial(syms) {
  const [trending, ...perCoin] = await Promise.allSettled([getTrending(), ...syms.map(getCoinSocial)]);
  const trend = trending.status === "fulfilled" ? trending.value : [];
  const coins = {};
  syms.forEach((sym, i) => {
    const r = perCoin[i];
    const rank = trend.find((t) => t.symbol === sym)?.rank || null;
    coins[sym] = r.status === "fulfilled"
      ? { ...r.value, trendingRank: rank, hype: hypeLevel(r.value, rank) }
      : { error: "No social data (" + r.reason.message + ")", trendingRank: rank, hype: hypeLevel(null, rank) };
  });
  return { updated: Date.now(), trending: trend, trendingError: trending.status === "rejected" ? trending.reason.message : null, coins };
}

module.exports = { getSocial, summarizeStream, hypeLevel };

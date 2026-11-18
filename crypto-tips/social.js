// Social "buzz": what people are saying about each coin. Public data only, no keys needed.
// - StockTwits: recent posts per coin, many tagged Bullish/Bearish by their authors.
// - CoinGecko trending: the coins people are searching for most right now.
// - Pro adds Bluesky, Mastodon, Hacker News, Lemmy and news headlines (see EXTRA below).
//   Reddit isn't included: it blocks requests from cloud servers unless the site registers an app with Reddit.
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

// ── More sources (Pro) ──
const NAMES = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "xrp", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche", LINK: "chainlink",
  LTC: "litecoin", DOT: "polkadot", SHIB: "shiba inu", PEPE: "pepe", UNI: "uniswap", BCH: "bitcoin cash", XLM: "stellar", ATOM: "cosmos",
  NEAR: "near protocol", APT: "aptos", ARB: "arbitrum", OP: "optimism", SUI: "sui", HBAR: "hedera", AAVE: "aave", ETC: "ethereum classic",
  ALGO: "algorand", FIL: "filecoin", ICP: "internet computer", POL: "polygon", BONK: "bonk", WIF: "dogwifhat", TRUMP: "trump coin" };
const nameOf = (sym) => NAMES[sym] || sym.toLowerCase();
const stripHtml = (h) => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// A rough bullish/bearish lean from words in the posts (labelled as rough in the app).
const BULL = /\b(moon|mooning|pump|pumping|bull(ish)?|breakout|ath|all[- ]time high|rally|long|buy(ing)?|rocket|undervalued|accumulat\w*)\b/i;
const BEAR = /\b(dump(ing)?|bear(ish)?|crash(ing)?|scam|rug|short(ing)?|sell(ing)?|overvalued|dead|collapse|plunge|capitulat\w*)\b/i;
function lean(posts) {
  let b = 0, s = 0;
  for (const p of posts) { const t = p.text || "", bu = BULL.test(t), be = BEAR.test(t); if (bu && !be) b++; else if (be && !bu) s++; }
  return b + s >= 3 ? Math.round((b / (b + s)) * 100) : null;
}

// One source: posts in the last 24 hours, rate, rough lean, and the newest few.
function summarize(source, url, posts, now = Date.now()) {
  posts = posts.filter((p) => p.text && !isNaN(Date.parse(p.time))).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const day = posts.filter((p) => now - Date.parse(p.time) < 864e5);
  let perHour = null;
  if (day.length >= 2) perHour = +(day.length / Math.max((now - Date.parse(day[day.length - 1].time)) / 3.6e6, 0.25)).toFixed(1);
  return { source, url, count24h: day.length, perHour, bullishPct: lean(posts), posts: posts.slice(0, 5).map((p) => ({ ...p, source })) };
}

function bluesky(sym) {
  return cached("bsky:" + sym, async () => {
    const q = NAMES[sym] ? `${NAMES[sym]} OR $${sym}` : "$" + sym;
    const d = await getJson(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=40`);
    const posts = (d.posts || []).map((p) => {
      const handle = clean(p.author?.handle, 60), rkey = String(p.uri || "").split("/").pop();
      return { text: clean(p.record?.text), user: handle, time: p.record?.createdAt || p.indexedAt, likes: p.likeCount ?? 0,
        url: handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : null };
    });
    return summarize("Bluesky", `https://bsky.app/search?q=${encodeURIComponent(q)}`, posts);
  });
}

function mastodon(sym) {
  return cached("masto:" + sym, async () => {
    const tag = nameOf(sym).replace(/[^a-z0-9]/g, "");
    const d = await getJson(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`);
    const posts = (Array.isArray(d) ? d : []).map((m) => ({ text: clean(stripHtml(m.content)), user: clean(m.account?.acct, 60), time: m.created_at, likes: m.favourites_count ?? 0, url: m.url || null }));
    return summarize("Mastodon", `https://mastodon.social/tags/${encodeURIComponent(tag)}`, posts);
  });
}

function hackerNews(sym) {
  return cached("hn:" + sym, async () => {
    const q = nameOf(sym), since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const d = await getJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=40`);
    const posts = (d.hits || []).map((h) => ({ text: clean(h.title || stripHtml(h.comment_text)), user: clean(h.author, 40), time: h.created_at, likes: h.points ?? 0,
      url: `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}` }));
    return summarize("Hacker News", `https://hn.algolia.com/?q=${encodeURIComponent(q)}&sort=byDate`, posts);
  });
}

function lemmy(sym) {
  return cached("lemmy:" + sym, async () => {
    const q = nameOf(sym);
    const d = await getJson(`https://lemmy.world/api/v3/search?q=${encodeURIComponent(q)}&type_=Posts&sort=New&limit=30`);
    const posts = (d.posts || []).map((p) => ({ text: clean(p.post?.name), user: clean(p.creator?.name, 40), time: p.post?.published, likes: p.counts?.score ?? 0, url: p.post?.ap_id || null }));
    return summarize("Lemmy", `https://lemmy.world/search?q=${encodeURIComponent(q)}&type=Posts`, posts);
  });
}

function newsMentions(sym) {
  return cached("news:" + sym, async () => {
    const { getNews, newsFor } = require("./research.js");
    const title = NAMES[sym] ? NAMES[sym].replace(/\b\w/g, (c) => c.toUpperCase()) : null;
    const items = newsFor(await getNews(), sym, title);
    return summarize("News", null, items.map((n) => ({ text: n.title, user: n.source, time: new Date(n.time).toISOString(), likes: 0, url: n.url })));
  });
}

const EXTRA = [bluesky, mastodon, hackerNews, lemmy, newsMentions];

// Hype level from posting rate, total mentions, crowd lean, and whether it's trending. Purely descriptive.
function hypeLevel(s, trendingRank, mentions24h) {
  let pts = 0;
  if (mentions24h >= 200) pts += 2; else if (mentions24h >= 60) pts += 1;
  if (s?.postsPerHour >= 60) pts += 2; else if (s?.postsPerHour >= 15) pts += 1;
  if (s?.bullishPct != null && s.tagged >= 5 && (s.bullishPct >= 85 || s.bullishPct <= 15)) pts += 1; // one-sided crowd
  if (trendingRank) pts += trendingRank <= 5 ? 2 : 1;
  return pts >= 4 ? "very high" : pts >= 2 ? "high" : pts >= 1 ? "moderate" : "low";
}

// full = Pro: adds Bluesky, Mastodon, Hacker News, Lemmy and news mentions to StockTwits and CoinGecko trending.
async function getSocial(syms, { full = false } = {}) {
  const [trending, ...perCoin] = await Promise.allSettled([getTrending(), ...syms.map(getCoinSocial)]);
  const extra = full ? await Promise.all(syms.map((sym) => Promise.allSettled(EXTRA.map((f) => f(sym))))) : null;
  const trend = trending.status === "fulfilled" ? trending.value : [];
  const coins = {};
  syms.forEach((sym, i) => {
    const r = perCoin[i];
    const rank = trend.find((t) => t.symbol === sym)?.rank || null;
    const st = r.status === "fulfilled" ? r.value : null;
    let more = null, mentions = null;
    if (extra) {
      more = extra[i].filter((x) => x.status === "fulfilled").map((x) => x.value);
      const stDay = st ? st.posts.filter((p) => Date.now() - Date.parse(p.time) < 864e5).length : 0;
      mentions = stDay + more.reduce((a, x) => a + x.count24h, 0);
    }
    const base = st ? { ...st } : { error: "No StockTwits data (" + r.reason.message + ")" };
    coins[sym] = {
      ...base, trendingRank: rank, hype: hypeLevel(st, rank, mentions),
      ...(more ? {
        sources: more, mentions24h: mentions,
        sourcesActive: more.filter((x) => x.count24h > 0).length + (st?.posts?.length ? 1 : 0),
        latest: more.flatMap((x) => x.posts).concat((st?.posts || []).map((p) => ({ ...p, source: "StockTwits" })))
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 12),
      } : {}),
    };
  });
  return { updated: Date.now(), full, trending: trend, trendingError: trending.status === "rejected" ? trending.reason.message : null, coins };
}

module.exports = { getSocial, summarizeStream, hypeLevel, summarize, lean, NAMES };

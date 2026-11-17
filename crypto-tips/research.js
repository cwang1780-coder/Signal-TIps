// Market research from free public sources (no keys):
// - Fear & Greed index (alternative.me): a 0-100 gauge of market mood
// - Whole-market numbers (CoinGecko): total value, today's change, Bitcoin's share
// - News headlines (Cointelegraph and Decrypt RSS feeds)
const UA = { "User-Agent": "crypto-signal-tips/1.0", Accept: "*/*" };
const TTL = 10 * 60 * 1000;
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}
const get = (url) => fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r; });

function getFearGreed() {
  return cached("fng", async () => {
    const d = (await (await get("https://api.alternative.me/fng/?limit=31")).json()).data || [];
    const at = (i) => (d[i] ? +d[i].value : null);
    return { value: at(0), label: d[0]?.value_classification || null, yesterday: at(1), weekAgo: at(7), monthAgo: at(30) };
  });
}

function getGlobal() {
  return cached("global", async () => {
    const d = (await (await get("https://api.coingecko.com/api/v3/global")).json()).data || {};
    return {
      marketCapUsd: d.total_market_cap?.usd ?? null,
      change24hPct: d.market_cap_change_percentage_24h_usd != null ? +d.market_cap_change_percentage_24h_usd.toFixed(2) : null,
      btcDominancePct: d.market_cap_percentage?.btc != null ? +d.market_cap_percentage.btc.toFixed(1) : null,
      ethDominancePct: d.market_cap_percentage?.eth != null ? +d.market_cap_percentage.eth.toFixed(1) : null,
    };
  });
}

// ── News ──
const FEEDS = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss", host: "cointelegraph.com" },
  { source: "Decrypt", url: "https://decrypt.co/feed", host: "decrypt.co" },
];
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)
  .replace(/\s+/g, " ").trim();

function parseRss(xml, feed) {
  const items = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const tag = (t) => decode((new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`).exec(m[0]) || [])[1]);
    const title = tag("title").slice(0, 200), link = tag("link"), time = Date.parse(tag("pubDate"));
    let ok = false;
    try { const u = new URL(link); ok = u.protocol === "https:" && (u.hostname === feed.host || u.hostname.endsWith("." + feed.host)); } catch {}
    if (title && ok && !isNaN(time)) items.push({ title, url: link, time, source: feed.source });
  }
  return items;
}

function getNews() {
  return cached("news", async () => {
    const results = await Promise.allSettled(FEEDS.map(async (f) => parseRss(await (await get(f.url)).text(), f)));
    const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (!all.length) throw new Error("no news feeds reachable");
    return all.sort((a, b) => b.time - a.time).slice(0, 80);
  });
}

// Headlines that mention a coin by name or ticker (whole words only, so "SOL" doesn't match "solution").
function newsFor(items, sym, name) {
  const words = [sym, name].filter((w) => w && w.length >= 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [];
  const re = new RegExp(`(^|[^A-Za-z0-9])(${words.join("|")})($|[^A-Za-z0-9])`, "i");
  return items.filter((i) => re.test(i.title));
}

async function getResearch(sym, name) {
  const [fng, global, news] = await Promise.allSettled([getFearGreed(), getGlobal(), getNews()]);
  const items = news.status === "fulfilled" ? news.value : [];
  return {
    updated: Date.now(),
    fearGreed: fng.status === "fulfilled" ? fng.value : null,
    global: global.status === "fulfilled" ? global.value : null,
    news: { top: items.slice(0, 8), coin: sym ? newsFor(items, sym, name).slice(0, 6) : [], error: news.status === "rejected" ? news.reason.message : null },
  };
}

module.exports = { getResearch, parseRss, newsFor, decode };

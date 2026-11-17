// Trench study: how did coins do after a "big come-up"?
// For every coin trading against USD on Coinbase, find days where the price rose 30%+ in 7 days AND trading volume ran
// at 3x+ its normal level (the same kind of move Trench flags), then measure the next 7 and 30 days.
// Run: node tools/trench-study.js   → writes public/trench-stats.json
const fs = require("fs");
const path = require("path");
const DAY = 86400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null; };
const STABLES = new Set(["USDT", "USDC", "DAI", "PYUSD", "EURC", "GUSD", "PAX", "USDS", "RLUSD", "WBTC", "CBETH", "CBBTC", "WETH", "LSETH", "MSOL", "JITOSOL"]);

async function getJSON(url, tries = 4) {
  for (let k = 0; k < tries; k++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(1500 * (k + 1)); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}
const CACHE = process.argv.includes("--cache") ? JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf("--cache") + 1], "utf8")) : null;
async function daily(sym) {
  if (CACHE) return (CACHE[sym] || []).map(([time, close, usdVol]) => ({ time, close, usdVol }));
  const all = new Map(), now = Math.floor(Date.now() / 1000);
  for (let k = 0; k < 2; k++) {
    const end = now - k * 300 * DAY, start = end - 300 * DAY;
    const d = await getJSON(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`);
    if (!d || !d.length) break;
    for (const [time, low, high, open, close, volume] of d) all.set(time, { time, close, usdVol: volume * close });
    await sleep(150);
  }
  return [...all.values()].sort((a, b) => a.time - b.time);
}

(async () => {
  const products = (await getJSON("https://api.exchange.coinbase.com/products")) || [];
  const syms = CACHE ? Object.keys(CACHE) : [...new Set(products.filter((p) => p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled).map((p) => p.base_currency))].filter((s) => !STABLES.has(s));
  const events = [], base7 = [];
  let coinsUsed = 0, first = Infinity, last = 0;
  for (const [i, sym] of syms.entries()) {
    const c = await daily(sym);
    if (c.length < 60) continue;
    coinsUsed++; first = Math.min(first, c[0].time); last = Math.max(last, c[c.length - 1].time);
    let lastEvent = -999;
    for (let t = 37; t < c.length - 30; t++) {
      const r7 = c[t].close / c[t - 7].close - 1;
      const recentVol = (c[t].usdVol + c[t - 1].usdVol + c[t - 2].usdVol) / 3;
      const normalVol = c.slice(t - 37, t - 7).reduce((a, x) => a + x.usdVol, 0) / 30;
      base7.push(c[t + 7].close / c[t].close - 1);
      if (r7 >= 0.30 && normalVol > 0 && recentVol >= 3 * normalVol && t - lastEvent >= 14) {
        const f = c.slice(t + 1, t + 31).map((x) => x.close / c[t].close - 1);
        events.push({ sym, time: c[t].time, r7, normalVol, f7: c[t + 7].close / c[t].close - 1, f30: c[t + 30].close / c[t].close - 1, worst30: Math.min(...f), best30: Math.max(...f) });
        lastEvent = t;
      }
    }
    if (i % 50 === 0) console.log(i, "/", syms.length, sym, events.length, "events so far");
  }
  const pct = (xs, fn) => xs.length ? +(xs.filter(fn).length / xs.length).toFixed(3) : null;
  const out = {
    generated: new Date().toISOString().slice(0, 10), coinsStudied: coinsUsed,
    from: new Date(first * 1000).toISOString().slice(0, 10), to: new Date(last * 1000).toISOString().slice(0, 10),
    rule: "Price up 30% or more over 7 days, with 3-day trading volume at least 3x its normal (previous 30-day) level. One event per coin per 14 days.",
    events: events.length,
    after7: { higher: pct(events, (e) => e.f7 > 0), up20: pct(events, (e) => e.f7 >= 0.2), median: +median(events.map((e) => e.f7)).toFixed(4) },
    after30: { higher: pct(events, (e) => e.f30 > 0), up50: pct(events, (e) => e.f30 >= 0.5), down30: pct(events, (e) => e.f30 <= -0.3), median: +median(events.map((e) => e.f30)).toFixed(4) },
    within30: { fellBy30AtSomePoint: pct(events, (e) => e.worst30 <= -0.3), roseBy50AtSomePoint: pct(events, (e) => e.best30 >= 0.5) },
    ordinaryDay7: { higher: pct(base7, (x) => x > 0), median: +median(base7).toFixed(4) },
    // How each kind of come-up did over the next 7 days (Trench shows the bucket a coin falls into).
    buckets: Object.fromEntries([
      ["surge30to60", (e) => e.r7 < 0.6], ["surge60to100", (e) => e.r7 >= 0.6 && e.r7 < 1], ["surgeOver100", (e) => e.r7 >= 1],
      ["bigCoins", (e) => e.normalVol > 5e6], ["smallCoins", (e) => e.normalVol < 5e5],
    ].map(([k, f]) => { const s = events.filter(f); return [k, { n: s.length, higher7: pct(s, (e) => e.f7 > 0), median7: s.length ? +median(s.map((e) => e.f7)).toFixed(4) : null }]; })),
  };
  fs.writeFileSync(path.join(__dirname, "../public/trench-stats.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();

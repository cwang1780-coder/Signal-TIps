// Pattern study: replays the app's chart-pattern detector over ~4 years of daily candles for 10 coins
// and records how often the price was higher 30 days after each pattern appeared.
// Run: node tools/pattern-study.js   → writes public/pattern-stats.json
const fs = require("fs");
const path = require("path");
const I = require("../public/indicators.js");

const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT"];
const DAY = 86400, HORIZON = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function daily(sym) {
  const all = new Map(), now = Math.floor(Date.now() / 1000);
  for (let k = 0; k < 5; k++) {
    const end = now - k * 300 * DAY, start = end - 300 * DAY;
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`);
    if (!r.ok) break;
    for (const [time, low, high, open, close, volume] of await r.json()) all.set(time, { time, low, high, open, close, volume });
    await sleep(250);
  }
  return [...all.values()].sort((a, b) => a.time - b.time);
}

const stat = (r) => (r.length ? { n: r.length, up: +(r.filter((x) => x > 0).length / r.length).toFixed(3), median: +I.median(r).toFixed(4) } : { n: 0 });

(async () => {
  const byId = {}, halves = {}, base = [], baseH = [[], []];
  let first = Infinity, last = 0;
  for (const sym of COINS) {
    const c = await daily(sym);
    if (c.length < 400) { console.log("skip", sym); continue; }
    first = Math.min(first, c[0].time); last = Math.max(last, c[c.length - 1].time);
    const mid = c[Math.floor(c.length / 2)].time;
    for (const e of I.patternHistory(c, { horizon: HORIZON })) {
      (byId[e.id] = byId[e.id] || []).push(e.ret);
      ((halves[e.id] = halves[e.id] || [[], []])[c[e.t].time < mid ? 0 : 1]).push(e.ret);
    }
    for (let t = 90; t < c.length - HORIZON; t++) { const r = c[t + HORIZON].close / c[t].close - 1; base.push(r); baseH[c[t].time < mid ? 0 : 1].push(r); }
    console.log(sym, c.length, "days");
  }
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    coins: COINS, timeframe: "daily", horizonDays: HORIZON,
    from: new Date(first * 1000).toISOString().slice(0, 10), to: new Date(last * 1000).toISOString().slice(0, 10),
    baseline: { ...stat(base), halves: baseH.map(stat) },
    patterns: Object.fromEntries(Object.entries(byId).map(([id, r]) => [id, { ...stat(r), halves: halves[id].map(stat) }])),
  };
  fs.writeFileSync(path.join(__dirname, "../public/pattern-stats.json"), JSON.stringify(out, null, 1));
  console.log("wrote public/pattern-stats.json", Object.keys(out.patterns).length, "patterns, baseline", out.baseline);
})();

// UI + Coinbase public market data (no API key, read-only).
const API = "https://api.exchange.coinbase.com";
const DEFAULT_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT"];

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

let coins = store.get("coins", DEFAULT_COINS);
let holdings = store.get("holdings", []); // [{sym, amt, cost}]
let results = {}; // sym -> analysis
let cb = { holdings: [], cash: [], status: "" }; // synced from Coinbase via local server
const allSyms = () => [...new Set([...coins, ...cb.holdings.map((h) => h.sym), ...(window.walletHoldings?.() || []).map((h) => h.sym)])];
let selected = null;
let siteConfig = { coinbaseRef: null }; // from /api/config
const btCache = {}; // sym -> {key, result}
function trackRecord(sym, candles) {
  const key = candles.length + ":" + candles[candles.length - 1].time + ":" + $("tf").value;
  if (btCache[sym]?.key !== key) btCache[sym] = { key, result: Indicators.backtest(candles) };
  return btCache[sym].result;
}
function trackRecordHtml(bt) {
  if (!bt) return "";
  if (level() === "beginner") {
    // One plain sentence instead of the full statistics.
    const d = bt.strategyReturn - bt.holdReturn, traded = bt.trades + (bt.openTrade != null ? 1 : 0) > 0;
    const line = !traded ? "The signals haven't said BUY on this chart yet, so there's no track record to judge."
      : Math.abs(d) < 0.02 ? "In the past, following these signals did about the same as simply holding this coin."
      : d > 0 ? `In the past, following these signals did <b>better</b> than simply holding this coin (${(bt.strategyReturn * 100).toFixed(0)}% vs ${(bt.holdReturn * 100).toFixed(0)}%).`
      : `In the past, following these signals did <b>worse</b> than simply holding this coin (${(bt.strategyReturn * 100).toFixed(0)}% vs ${(bt.holdReturn * 100).toFixed(0)}%), so trust them less here.`;
    return `<h2 id="d-track">Has this worked before?</h2><p class="trackline">${line} Past results don't predict the future. ▲ and ▼ on the chart show the past buys and sells.</p>`;
  }
  const p = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  const cls = (n) => (n >= 0 ? "up" : "down");
  const diff = bt.strategyReturn - bt.holdReturn;
  const since = new Date(bt.from * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const verdict = bt.trades + (bt.openTrade != null ? 1 : 0) === 0
    ? "The signals never said BUY in this period, so there is nothing to judge yet."
    : Math.abs(diff) < 0.02 ? "About the same as simply holding."
    : diff > 0 ? `Following the signals did <b>${(diff * 100).toFixed(1)} points better</b> than simply holding.`
    : `Following the signals did <b>${(-diff * 100).toFixed(1)} points worse</b> than simply holding.`;
  return `<h2 id="d-track">Track record on this chart</h2>
    <div class="stats">
      <div><span class="muted">Following the signals</span><b class="${cls(bt.strategyReturn)}">${p(bt.strategyReturn)}</b></div>
      <div><span class="muted">Just holding</span><b class="${cls(bt.holdReturn)}">${p(bt.holdReturn)}</b></div>
      <div><span class="muted">Finished trades won</span><b>${bt.trades ? bt.wins + " of " + bt.trades : "none yet"}</b></div>
      <div><span class="muted">Biggest drop along the way</span><b class="down">−${(bt.maxDrawdown * 100).toFixed(0)}%</b></div>
    </div>
    <p class="muted" style="margin-top:8px">${verdict} Since ${since}: buy when the signal turns BUY, sell when it turns SELL, with a ${(bt.fee * 100).toFixed(1)}% fee each time.
    ▲ and ▼ on the chart mark those moments.${bt.openTrade != null ? ` Currently in a trade (${p(bt.openTrade)}).` : ""} Past results do not predict future results.</p>`;
}

// Private endpoints (Coinbase sync, Ask AI) need the app password when the app is online.
const authHeaders = () => {
  const h = {}, p = store.get("appPassword", ""), k = store.get("proKey", "");
  if (p) h["X-App-Password"] = p;
  if (k) h["X-Pro-Key"] = k; // Pro subscribers (see pro.js)
  return h;
};
function showLock(message) {
  $("lockMsg").textContent = message || "Enter the app password to see your Coinbase holdings and use Ask AI.";
  $("lockBar").hidden = false;
}

const $ = (id) => document.getElementById(id);
const fmt = (n) => n == null ? "—" : "$" + (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4));
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
const actionClass = (a) => "badge b-" + a.replace(" ", ".");

// One page = up to 300 candles. `end` (unix seconds) fetches an older page; without it, the newest.
// Goes through our own server first (shared cache, works on networks that block Coinbase), then straight to Coinbase.
let viaServer = location.protocol !== "file:";
const timed = (url, ms) => fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined });
async function fetchPage(sym, gran, end) {
  let res = null;
  if (viaServer) {
    try {
      res = await timed(`/api/candles?sym=${encodeURIComponent(sym)}&gran=${gran}${end ? "&end=" + end : ""}`, 12000);
      if (res.status === 404 && !(res.headers.get("content-type") || "").includes("json")) { viaServer = false; res = null; } // no server (static hosting)
      else if (res.status >= 500) res = null;
    } catch { res = null; }
  }
  if (!res) {
    const range = end ? `&start=${new Date((end - 299 * gran) * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}` : "";
    const url = `${API}/products/${sym}-USD/candles?granularity=${gran}${range}`;
    try { res = await timed(url, 12000); } catch { throw new Error("couldn't reach Coinbase"); }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1200)); res = await timed(url, 12000); }
  }
  if (!res.ok) throw new Error(res.status === 404 ? "not on Coinbase" : "HTTP " + res.status);
  const raw = await res.json(); // [time, low, high, open, close, volume], newest first
  return raw.reverse().map(([time, low, high, open, close, volume]) => ({ time, low, high, open, close, volume }));
}

// ~900 candles per coin: the signals need a 200-period average, and the track record needs room after that.
// Older pages are fetched once and cached; each refresh only re-fetches the newest page.
const histCache = {}; // "SYM:gran" -> Map(time -> candle)
async function fetchCandles(sym, gran) {
  const key = sym + ":" + gran;
  const latest = await fetchPage(sym, gran);
  if (!histCache[key]) {
    const map = new Map();
    let end = latest[0]?.time;
    for (let k = 0; k < 2 && end; k++) {
      try {
        const older = await fetchPage(sym, gran, end - gran);
        if (!older.length) break;
        older.forEach((c) => map.set(c.time, c));
        end = older[0].time;
      } catch { break; } // older history is a bonus; carry on with what we have
    }
    histCache[key] = map;
  }
  latest.forEach((c) => histCache[key].set(c.time, c));
  return [...histCache[key].values()].sort((a, b) => a.time - b.time);
}

async function analyzeCoin(sym) {
  const gran = +$("tf").value;
  const candles = await fetchCandles(sym, gran);
  if (candles.length < 30) throw new Error("not enough history");
  const a = Indicators.analyze(candles);
  const back = Math.max(1, Math.round(86400 / gran)); // candles in 24h
  const ref = candles[candles.length - 1 - back] || candles[0];
  a.change24 = (a.price - ref.close) / ref.close;
  a.candles = candles;
  return a;
}

let again = false;
async function refresh() {
  if (refreshing) { again = true; return; } // run once more when this one finishes (e.g. the view changed mid-load)
  refreshing = true;
  try { do { again = false; await refreshInner(); } while (again); } finally { refreshing = false; render(); }
}
async function refreshInner() {
  $("status").textContent = "Fetching live data from Coinbase…";
  // small batches to stay under public rate limits
  const syms = allSyms();
  // Show each coin as soon as it's ready instead of waiting for all of them.
  let pending = null;
  const soon = () => { if (!pending) pending = setTimeout(() => { pending = null; render(); }, 250); };
  for (let i = 0; i < syms.length; i += 4) {
    await Promise.all(syms.slice(i, i + 4).map(async (sym) => {
      try { results[sym] = await analyzeCoin(sym); }
      catch (e) { results[sym] = { error: e.message }; }
      soon();
    }));
  }
  clearTimeout(pending);
  $("status").textContent = "Updated " + new Date().toLocaleTimeString();
  render();
  document.dispatchEvent(new Event("prices-updated"));
}

const COIN_NAMES = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche", LINK: "Chainlink",
  LTC: "Litecoin", DOT: "Polkadot", SHIB: "Shiba Inu", PEPE: "Pepe", UNI: "Uniswap", BCH: "Bitcoin Cash", XLM: "Stellar", ATOM: "Cosmos",
  NEAR: "NEAR", APT: "Aptos", ARB: "Arbitrum", OP: "Optimism", SUI: "Sui", HBAR: "Hedera", AAVE: "Aave", ETC: "Ethereum Classic",
  ALGO: "Algorand", FIL: "Filecoin", ICP: "Internet Computer", POL: "Polygon", BONK: "Bonk", WIF: "dogwifhat", TRUMP: "Official Trump",
};
// Coin logo from public/coins (CC0). If there is no logo for a coin, show its initials on a coloured circle instead.
const COIN_COLORS_FB = { BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff", XRP: "#23292f", DOGE: "#c2a633", ADA: "#0033ad", AVAX: "#e84142", LINK: "#2a5ada", LTC: "#345d9d", DOT: "#e6007a", PEPE: "#3d9b41", SHIB: "#e2761b", SUI: "#4da2ff", NEAR: "#00c08b", ARB: "#28a0f0", OP: "#ff0420", APT: "#06b6a4", BONK: "#f7a600", HBAR: "#222222" };
function coinIcon(sym, size = 36) {
  const s = String(sym).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const has = !window.COIN_LOGOS || window.COIN_LOGOS.has(s.toLowerCase());
  return `<span class="coin-ic${has ? "" : " fb"}" style="--s:${size}px;--c:${COIN_COLORS_FB[s] || "#5b616e"}">${has ? `<img src="coins/${s.toLowerCase()}.svg" alt="" loading="lazy" onerror="this.parentNode.classList.add('fb');this.remove()" />` : ""}<b style="font-size:calc(var(--s) * ${s.length > 3 ? 0.26 : s.length > 2 ? 0.32 : 0.4})">${s.slice(0, 4)}</b></span>`;
}
window.coinIcon = coinIcon;
const coinName = (sym) => (COIN_NAMES[sym] && COIN_NAMES[sym] !== sym ? COIN_NAMES[sym] : "");
// What each signal means in everyday words
const PLAIN = {
  "STRONG BUY": "Uptrend with a dip. Conditions look very good.",
  BUY: "In an uptrend. Conditions look good.",
  HOLD: "Mixed signals. Wait and watch.",
  SELL: "In a downtrend. Better to stay out for now.",
  "STRONG SELL": "Strong downtrend. Stay out for now.",
};

// The technical numbers, each with a one-line explanation of how to read it.
function techTableHtml(r) {
  const t = r.tech;
  if (!t) return "";
  const diff = (a, b) => `<span class="${a >= b ? "up" : "down"}">${pct(a / b - 1)}</span>`;
  const num = (n) => (n == null ? "–" : Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));
  const rows = [];
  if (r.sma200 != null) rows.push(["200-period average", `${fmt(r.sma200)} · price is ${diff(r.price, r.sma200)}`,
    r.price >= r.sma200 ? "Price is above its long-term average: an uptrend." : "Price is below its long-term average: a downtrend. This is the most important line."]);
  if (r.sma50 != null) rows.push(["50-period average", `${fmt(r.sma50)} · price is ${diff(r.price, r.sma50)}`,
    r.price >= r.sma50 ? "Short-term strength." : "Short-term weakness."]);
  if (r.sma50 != null && r.sma200 != null) rows.push(["50 vs 200 average", r.sma50 >= r.sma200 ? "50 above 200" : "50 below 200",
    r.sma50 >= r.sma200 ? "Traders call this the \"golden cross\" zone: recent prices are stronger than the long-term trend." : "Traders call this the \"death cross\" zone: recent prices are weaker than the long-term trend."]);
  rows.push(["RSI (14)", `<b>${r.rsi.toFixed(1)}</b>`,
    (r.rsi < 30 ? "Oversold: it has fallen fast." : r.rsi > 70 ? "Overbought: it has risen fast." : "In the normal range.") + " Scale is 0 to 100; under 30 is oversold, over 70 is overbought."]);
  if (t.macd != null && t.macdSignal != null) rows.push(["MACD (12, 26, 9)", `line ${num(t.macd)} · signal ${num(t.macdSignal)} · histogram <span class="${t.macdHist >= 0 ? "up" : "down"}">${num(t.macdHist)}</span>`,
    t.macdHist >= 0 ? "Momentum is positive: the line is above its signal line." : "Momentum is negative: the line is below its signal line."]);
  if (t.bbUpper != null) {
    const pos = (r.price - t.bbLower) / (t.bbUpper - t.bbLower || 1);
    rows.push(["Bollinger bands (20, 2)", `${fmt(t.bbLower)} to ${fmt(t.bbUpper)}`,
      (pos >= 1 ? "Price is above its usual range: stretched upward." : pos <= 0 ? "Price is below its usual range: stretched downward." : `Price is ${Math.round(pos * 100)}% of the way up its usual recent range.`)]);
  }
  if (t.volRatio != null) rows.push(["Volume", `${t.volRatio.toFixed(1)}× the 20-period average`,
    t.volRatio > 1.5 ? "Unusually heavy trading. Big moves on heavy volume mean more." : t.volRatio < 0.6 ? "Quiet trading." : "Normal trading activity."]);
  rows.push(["Signal score", `<b>${r.score > 0 ? "+" : ""}${r.score.toFixed(1)}</b>`, "The total of the points above. +2 or more is BUY, −2 or less is SELL, in between is HOLD. ±4.5 is STRONG."]);
  const open = level() === "pro" || store.get("techOpen", false);
  return `<details class="techDetails" id="techDetails" ${open ? "open" : ""}><summary>Technical details <span class="muted">${level() === "pro" ? "indicator values" : "the numbers behind the signal, and how to read them"}</span></summary>
    <div class="tablewrap"><table class="tech"><tr><th>Indicator</th><th>Now</th><th>What it means</th></tr>
    ${rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="muted">${c}</td></tr>`).join("")}</table></div></details>`;
}

// Every coin came back with an error (none still loading): show a retry instead of "Loading…" forever.
const pricesFailed = () => { const s = allSyms(); return s.length > 0 && s.every((x) => results[x]?.error) && !refreshing; };
let refreshing = false;
document.addEventListener("click", (e) => { if (e.target.closest(".retryPrices")) { $("summary").textContent = "Loading live prices…"; results = {}; render(); refresh(); } });
function renderSummary() {
  const rs = allSyms().map((s) => results[s]).filter((r) => r && !r.error);
  if (!rs.length) {
    if (pricesFailed()) $("summary").innerHTML = `<span class="dot y" aria-hidden="true"></span>Live prices didn't load.<small>Coinbase didn't answer. Check your connection, or open the site in your phone's normal browser (not inside an app). <button class="pill retryPrices">Try again</button></small>`;
    return;
  }
  const good = rs.filter((r) => r.action.includes("BUY")).length, bad = rs.filter((r) => r.action.includes("SELL")).length, mixed = rs.length - good - bad;
  const mood = good > bad && good >= rs.length / 2 ? ["g", "Most coins are in an uptrend right now."]
    : bad > good && bad >= rs.length / 2 ? ["r", "Most coins are in a downtrend right now."]
    : ["y", "The market is mixed right now."];
  $("summary").innerHTML = `<span class="dot ${mood[0]}" aria-hidden="true"></span>${mood[1]}<small>${good} look${good === 1 ? "s" : ""} good · ${mixed} mixed · ${bad} in a downtrend. Tap a coin to see why.</small>`;
}

// Hero card: a live price list, newest signals first in your own coin order.
const COIN_COLORS = { BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff", XRP: "#23292f", DOGE: "#c2a633", ADA: "#0033ad", AVAX: "#e84142", LINK: "#2a5ada", LTC: "#345d9d", DOT: "#e6007a" };
function renderHeroList() {
  const el = $("heroList");
  if (!el) return;
  const rows = allSyms().filter((s) => results[s] && !results[s].error).slice(0, 6);
  el.innerHTML = rows.length ? rows.map((sym) => {
    const r = results[sym];
    return `<button class="hrow" data-hero="${sym}" aria-label="Open ${sym}">
      ${coinIcon(sym, 36)}
      <span class="nm"><b>${coinName(sym) || sym}</b><span>${sym} · <span class="${actionClass(r.action)}" style="padding:1px 8px">${r.action}</span></span></span>
      <span class="px">${fmt(r.price)}<span class="${r.change24 >= 0 ? "up" : "down"}">${r.change24 >= 0 ? "↗" : "↘"} ${pct(r.change24)}</span></span>
    </button>`;
  }).join("") : pricesFailed() ? `<p class="muted" style="padding:12px 6px">Couldn't load live prices. <button class="pill retryPrices">Try again</button></p>` : `<p class="muted" style="padding:12px 6px">Loading live prices…</p>`;
}

function render() {
  renderSummary();
  renderHeroList();
  // Keep your own order (no reshuffling on every refresh), so coins stay where you expect them.
  $("grid").innerHTML = allSyms().map((sym) => {
    const r = results[sym];
    const title = `<span class="sym">${coinIcon(sym, 32)}<span class="nm2"><span>${sym}</span>${coinName(sym) ? `<span class="name">${coinName(sym)}</span>` : ""}</span></span>`;
    if (!r) return `<div class="card">${title}<div class="muted">Loading…</div></div>`;
    if (r.error) return `<div class="card"><div class="row">${title}<button class="x" data-rm="${sym}" title="Remove ${sym}" aria-label="Remove ${sym}">✕</button></div><div class="muted">${r.error === "not on Coinbase" ? "Couldn't find this coin on Coinbase." : "Couldn't load this coin (" + r.error + ")."}</div></div>`;
    const w = Math.min(Math.abs(r.score) / 6, 1) * 50;
    const color = r.score >= 0 ? "var(--buy)" : "var(--sell)";
    const left = r.score >= 0 ? 50 : 50 - w;
    return `<div class="card ${selected === sym ? "sel" : ""}" data-sym="${sym}" role="button" tabindex="0" aria-label="${sym} ${r.action}">
      <div class="row">${title}<span class="${actionClass(r.action)}">${r.action}</span></div>
      <div class="price">${fmt(r.price)}</div>
      <div class="chg ${r.change24 >= 0 ? "up" : "down"}">${r.change24 >= 0 ? "▲" : "▼"} ${pct(r.change24)} in 24h</div>
      <div class="plain">${PLAIN[r.action]}</div>
      <div class="techrow" title="RSI: 0 to 100, under 30 is oversold, over 70 is overbought. Score: total of the signal points. Trend: how far the price is from its 200-period average.">
        <span>RSI <b>${r.rsi != null ? r.rsi.toFixed(0) : "–"}</b></span><span>Score <b>${r.score > 0 ? "+" : ""}${r.score.toFixed(1)}</b></span>${r.sma200 ? `<span>vs 200 avg <b class="${r.price >= r.sma200 ? "up" : "down"}">${pct(r.price / r.sma200 - 1).replace(/\.\d+%/, "%")}</b></span>` : ""}
      </div>
      <div class="meter" title="Signal strength ${r.score.toFixed(1)}"><i style="left:${left}%;width:${w}%;background:${color}"></i><i style="left:50%;width:1px;background:var(--dim)"></i></div>
    </div>`;
  }).join("");
  renderDetail();
  renderHoldings();
}

function renderDetail() {
  const el = $("detail");
  const r = results[selected];
  if (!r || r.error) { el.style.display = "none"; document.body.classList.remove("detailOpen"); return; }
  // The coin view is a panel beside the list (a full sheet on phones), placed just under the pinned header.
  document.documentElement.style.setProperty("--top-h", $("top").getBoundingClientRect().bottom + "px");
  document.body.classList.add("detailOpen");
  if (!history.state?.coin) history.pushState({ coin: selected }, ""); // so the phone's Back button closes the coin
  // Don't rebuild the chart in the middle of a drawing; the next refresh will catch up.
  if (window.Draw?.isBusy() && Draw.currentSym() === selected && el.style.display === "block") return;
  el.style.display = "block";
  const bt = trackRecord(selected, r.candles);
  el.innerHTML = `
    <nav class="dnav" aria-label="${coinName(selected) || selected} sections">
      <div class="dnav-top">
        <button class="dback" data-close aria-label="Back to all coins">← <span>All coins</span></button>
        <span class="dmini" aria-hidden="true">${coinIcon(selected, 24)}<b>${coinName(selected) || selected}</b><span class="dmini-px">${fmt(r.price)}</span><span class="${actionClass(r.action)}">${r.action}</span></span>
      </div>
      <div class="dtabs" role="tablist">${DSECS.map(([id, t, ic]) => `<button role="tab" data-dtab="${id}">${icon(ic)}<span>${t}</span></button>`).join("")}</div>
    </nav>
    <div class="row detailHead"><h2 style="margin:0">${coinIcon(selected, 44)}<span>${coinName(selected) || selected} <span class="muted">${selected}</span> · ${fmt(r.price)}</span></h2>
      <span class="${actionClass(r.action)}">${r.action}</span></div>
    <p style="margin-top:6px">${PLAIN[r.action]}</p>
    <section class="dsec" data-sec="overview">
    <div id="detailMove"></div>
    <div id="d-chart"></div>
    <div id="chartWrap"></div>
    <div class="muted">Price (black) · 50-period avg (blue) · 200-period avg (orange) · Pick a tool above the chart to draw. Drawings are saved for this coin.</div>
    <div class="links">
      ${siteConfig.coinbaseRef
        ? `<a href="${siteConfig.coinbaseRef}" target="_blank" rel="noopener sponsored">Sign up for Coinbase ↗ <small>(referral link: we may earn a commission)</small></a>`
        : `<a href="https://www.coinbase.com/advanced-trade/spot/${selected}-USD" target="_blank" rel="noopener">Trade on Coinbase ↗</a>`}
      <a href="https://www.exodus.com/" target="_blank" rel="noopener">Open Exodus ↗</a>
      <a href="https://www.tradingview.com/symbols/${selected}USD/" target="_blank" rel="noopener">Chart on TradingView ↗</a>
      <button class="primary" onclick="askAI('Should I buy, sell or hold ${selected} right now? Walk me through the signals and what people are saying.')">Ask AI about ${selected}</button>
    </div>
    </section>
    <section class="dsec" data-sec="score">
    <h2 id="d-why">Why ${r.action}? <span class="muted">each line adds or removes points; the total (${r.score.toFixed(1)}) decides the signal</span></h2>
    <ul class="reasons">${r.reasons.map((x) => `<li><span class="pts" style="color:${x.pts > 0 ? "var(--buy)" : x.pts < 0 ? "var(--sell)" : "var(--dim)"}">${x.pts > 0 ? "+" : ""}${x.pts}</span><span>${x.text}</span></li>`).join("")}</ul>
    ${techTableHtml(r)}
    </section>
    <section class="dsec" data-sec="pattern" id="dr-pattern"></section>
    <section class="dsec" data-sec="reasons" id="dr-reasons"></section>
    <section class="dsec" data-sec="history" id="dr-history"></section>
    <section class="dsec" data-sec="track">${trackRecordHtml(bt)}</section>
    <section class="dsec" data-sec="news"><div id="dr-news"></div><div id="detailSocial"></div></section>`;
  Draw.mount($("chartWrap"), selected, r.candles, bt?.markers);
  window.renderDetailSocial?.(selected);
  window.renderResearch?.(selected);
  syncJump();
}
// The coin view's sections, shown one at a time so there's no long scroll.
const DSECS = [["overview", "Overview", "gauge"], ["score", "Score", "bars"], ["pattern", "Pattern", "chart"], ["reasons", "Reasons", "search"], ["history", "History", "clock"], ["track", "Track record", "check"], ["news", "News & buzz", "news"]];
let dTab = "overview", dTabSym = null;
function showDTab(name) {
  dTab = name;
  // Back to the top of the section, keeping the coin's header in view.
  $("detail").scrollTop = 0;
  syncJump();
  // A chart drawn while its tab was hidden has no size: redraw it now that it's visible.
  if (name === "overview" && $("chartWrap")?.querySelector("canvas")?.width === 0) renderDetail();
}

async function syncCoinbase(force) {
  if (location.protocol === "file:") {
    cb.status = "To connect Coinbase, run <code>node server.js</code> and open http://localhost:8000";
    return renderHoldings();
  }
  cb.status = "Syncing Coinbase…"; renderHoldings();
  try {
    const res = await fetch("/api/coinbase/holdings" + (force ? "?force=1" : ""), { headers: authHeaders(), signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    const d = await res.json().catch(() => ({}));
    // Public visitors: Coinbase sync and Ask AI belong to the site owner. Keep the page clean for everyone else.
    if (res.status === 401 || res.status === 503) {
      const tried = store.get("appPassword", "");
      if (res.status === 401 && tried) showLock("Wrong password, try again.");
      $("cbSync").hidden = true;
      cb = { holdings: [], cash: [], status: "Add what you own below to get a tip for each coin." + (res.status === 401 ? ` <button id="ownerBtn" class="linkbtn" type="button">Owner login</button>` : "") };
      return render();
    }
    if (!res.ok) throw new Error(d.reason || "server not reachable (HTTP " + res.status + ")");
    $("lockBar").hidden = true; $("cbSync").hidden = false;
    if (!d.connected) { cb = { holdings: [], cash: [], status: "Coinbase not connected: " + d.reason }; return renderHoldings(); }
    cb = { holdings: d.holdings, cash: d.cash, status: "Coinbase connected · synced " + new Date(d.updated).toLocaleTimeString() };
    const missing = d.holdings.map((h) => h.sym).filter((s) => !results[s]);
    await Promise.all(missing.map(async (s) => { try { results[s] = await analyzeCoin(s); } catch (e) { results[s] = { error: e.message }; } }));
  } catch (e) {
    cb.status = "Coinbase sync unavailable: " + e.message;
  }
  render();
}

function renderHoldings() {
  $("cbStatus").innerHTML = cb.status;
  const cash = cb.cash.filter((c) => c.amt >= 0.01).map((c) => `${c.amt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.sym}`).join(" · ");
  const wcash = Object.entries(window.walletCash?.() || {}).map(([s, a]) => `${a.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${s}`).join(" · ");
  $("cbCash").textContent = [cash && "Cash on Coinbase: " + cash, wcash && "Stablecoins in your wallets: " + wcash].filter(Boolean).join("  ·  ");
  const all = [...cb.holdings.map((h) => ({ ...h, src: "Coinbase" })), ...(window.walletHoldings?.() || []), ...holdings.map((h, i) => ({ ...h, src: "Manual", idx: i }))];
  if (!all.length) { $("holdings").innerHTML = `<tr><td class="muted">Nothing here yet. Add a coin you own below to see what it's worth and the signal for it.</td></tr>`; return; }
  let total = 0, totalCost = 0, costedValue = 0;
  const rows = all.map((h) => {
    const r = results[h.sym];
    const value = r?.price ? r.price * h.amt : null;
    const pl = value != null && h.cost ? value - h.cost * h.amt : null;
    if (value != null) total += value;
    if (h.cost && value != null) { totalCost += h.cost * h.amt; costedValue += value; }
    let tip = r?.action ? `<span class="${actionClass(r.action)}">${r.action}</span>` : `<span class="muted">${r?.error || "loading"}</span>`;
    if (r?.action?.includes("SELL") && pl > 0) tip += ` <span class="muted">— consider taking some profit</span>`;
    if (r?.action?.includes("BUY") && pl < 0) tip += ` <span class="muted">— could average down</span>`;
    return `<tr><td style="white-space:nowrap">${coinIcon(h.sym, 24)} <b>${h.sym}</b> <span class="muted">${h.src}</span></td><td>${+h.amt.toPrecision(8)}</td><td>${fmt(value)}</td>
      <td class="chg ${pl >= 0 ? "up" : "down"}">${pl == null ? "—" : (pl >= 0 ? "+" : "-") + fmt(Math.abs(pl))}</td>
      <td>${tip}</td><td>${h.idx != null ? `<button class="x" data-hrm="${h.idx}" title="Remove">✕</button>` : ""}</td></tr>`;
  }).join("");
  $("holdings").innerHTML = `<tr><th>Coin</th><th>Amount</th><th>Value</th><th>Profit/Loss</th><th>Tip</th><th></th></tr>${rows}
    <tr><td><b>Total</b></td><td></td><td><b>${fmt(total)}</b></td><td class="chg ${costedValue - totalCost >= 0 ? "up" : "down"}">${totalCost ? pct((costedValue - totalCost) / totalCost) + " on coins with a buy price" : ""}</td><td></td><td></td></tr>`;
}

// events
$("grid").addEventListener("click", (e) => {
  const rm = e.target.dataset.rm;
  if (rm) { coins = coins.filter((c) => c !== rm); store.set("coins", coins); delete results[rm]; render(); return; }
  const card = e.target.closest("[data-sym]");
  if (card) { selected = card.dataset.sym; render(); $("detail").scrollTop = 0; }
});
$("grid").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.sym) { e.preventDefault(); e.target.click(); } });
$("detail").addEventListener("click", (e) => {
  if (e.target.id === "detailClose" || e.target.closest("[data-close]")) return closeDetail();
  const t = e.target.closest("[data-dtab]");
  if (t) showDTab(t.dataset.dtab);
});
$("detailScrim").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selected && document.body.classList.contains("detailOpen")) closeDetail(); });

// ── Tabs ──
const TABS = ["signals", "trench", "buzz", "alerts", "ai", "coins", "sim", "learn", "me"];
// Show the chosen section; hide tabs whose section is empty (depends on mode and loaded data).
function syncJump() {
  if (selected !== dTabSym) { dTab = "overview"; dTabSym = selected; } // a new coin starts on Overview
  const secs = [...document.querySelectorAll("#detail .dsec")];
  const empty = (s) => !s.textContent.trim();
  if (secs.some((s) => s.dataset.sec === dTab && empty(s)) && dTab !== "overview") dTab = "overview";
  secs.forEach((s) => (s.hidden = s.dataset.sec !== dTab));
  document.querySelectorAll(".dnav [data-dtab]").forEach((b) => {
    const s = secs.find((x) => x.dataset.sec === b.dataset.dtab);
    b.hidden = !s || empty(s);
    b.classList.toggle("on", b.dataset.dtab === dTab);
    b.setAttribute("aria-selected", b.dataset.dtab === dTab);
    // On narrow screens, slide the chosen tab into view in the scrolling strip.
    const c = b.parentElement;
    if (b.dataset.dtab === dTab && (b.offsetLeft < c.scrollLeft || b.offsetLeft + b.offsetWidth > c.scrollLeft + c.clientWidth)) c.scrollLeft = b.offsetLeft - 24;
  });
}
// Show the mini coin header in the bar once the big header has scrolled away.
$("detail").addEventListener("scroll", () => {
  const h = $("detail").querySelector(".detailHead");
  $("detail").classList.toggle("scrolled", !!h && $("detail").scrollTop > h.offsetTop + h.offsetHeight - 60);
}, { passive: true });
window.syncJump = syncJump;
function closeDetail() {
  if (history.state?.coin) return history.back(); // the popstate handler below closes it
  selected = null; render();
}
window.addEventListener("popstate", () => { if (selected && document.body.classList.contains("detailOpen")) { selected = null; render(); } });
function showTab(name) {
  if (!TABS.includes(name) || (name === "learn" && level() === "pro")) name = "signals";
  document.querySelectorAll("section.tab").forEach((s) => (s.hidden = s.dataset.tab !== name));
  document.querySelectorAll("#tabs button").forEach((b) => { const on = b.dataset.go === name; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  store.set("tab", name);
  document.body.classList.toggle("detailOpen", name === "signals" && $("detail").style.display === "block");
  if (name === "trench") window.loadTrench?.();
  if (name === "signals") renderDetail(); // the chart needs to be visible to size itself
  window.scrollTo(0, 0);
}
window.showTab = showTab;
// Any [data-go] button switches section: header nav, hero buttons, footer links.
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) { e.preventDefault(); document.body.classList.remove("navOpen"); $("menuToggle").setAttribute("aria-expanded", "false"); showTab(go.dataset.go); return; }
  if (e.target.closest("[data-open-help]")) {
    showTab("signals");
    const h = $("help"); h.open = true;
    setTimeout(() => h.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return;
  }
  const hero = e.target.closest("[data-hero]");
  if (hero) { selected = hero.dataset.hero; render(); $("detail").scrollTop = 0; }
});
// Phone/tablet menu: the section list opens full-screen under the header.
$("menuToggle").addEventListener("click", () => {
  document.documentElement.style.setProperty("--top-h", $("top").getBoundingClientRect().bottom + "px");
  const open = document.body.classList.toggle("navOpen");
  $("menuToggle").setAttribute("aria-expanded", open);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.body.classList.remove("navOpen"); });

// ── Experience level: "beginner" (default) or "pro". Changes presentation only, never the signals. ──
function level() { return store.get("level", "beginner") === "pro" ? "pro" : "beginner"; }
window.userLevel = level;
function applyLevel() {
  const lv = level();
  document.body.dataset.level = lv;
  document.querySelectorAll(".levelOpt").forEach((b) => { const on = b.dataset.level === lv && store.get("levelChosen", false); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  document.querySelector(".help").open = lv === "beginner";
  // Beginners use the long-term view only: it's the slowest-moving and easiest to follow.
  if (lv === "beginner" && $("tf").value !== "86400") { $("tf").value = "86400"; $("tf").dispatchEvent(new Event("change")); }
  window.renderAlertTypes?.();
  // Learn is for beginners only: leave it if someone switches to experienced while on it.
  if (lv === "pro" && !document.querySelector('.tab[data-tab="learn"]').hidden) showTab("signals");
  render();
}
// Open one coin's full view (used by the lessons' "Try it" buttons).
window.openCoin = (sym) => {
  showTab("signals"); selected = sym; render();
  $("detail").scrollTop = 0;
};
function chooseLevel(lv, fromWelcome) {
  store.set("level", lv); store.set("levelChosen", true); store.set("welcomed", true);
  $("welcome").hidden = true;
  $("beginnerTips").hidden = !(lv === "beginner" && fromWelcome);
  applyLevel();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".levelOpt");
  if (b) chooseLevel(b.dataset.level, Boolean(b.closest("#welcome")));
});
if (!store.get("welcomed", false)) $("welcome").hidden = false;
$("welcomeClose").onclick = () => chooseLevel("beginner", true);
for (const id of ["tipsOk", "tipsClose"]) $(id).onclick = () => { $("beginnerTips").hidden = true; };
// Remember a beginner opening the technical details
$("detail").addEventListener("toggle", (e) => { if (e.target.id === "techDetails" && level() === "beginner") store.set("techOpen", e.target.open); }, true);
$("holdings").addEventListener("click", (e) => {
  const i = e.target.dataset.hrm;
  if (i != null) { holdings.splice(+i, 1); store.set("holdings", holdings); renderHoldings(); }
});
$("addSym").onclick = async () => {
  const sym = $("newSym").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(sym) || coins.includes(sym)) return;
  coins.push(sym); store.set("coins", coins); $("newSym").value = "";
  try { results[sym] = await analyzeCoin(sym); } catch (e) { results[sym] = { error: e.message }; }
  render();
  document.dispatchEvent(new Event("prices-updated"));
};
$("hAdd").onclick = async () => {
  const sym = $("hSym").value.trim().toUpperCase(), amt = parseFloat($("hAmt").value), cost = parseFloat($("hCost").value) || 0;
  if (!/^[A-Z0-9]{1,15}$/.test(sym) || !(amt > 0)) return;
  holdings.push({ sym, amt, cost }); store.set("holdings", holdings);
  if (!coins.includes(sym)) { coins.push(sym); store.set("coins", coins); }
  $("hSym").value = $("hAmt").value = $("hCost").value = "";
  if (!results[sym]) { try { results[sym] = await analyzeCoin(sym); } catch (e) { results[sym] = { error: e.message }; } }
  render();
};
$("refresh").onclick = () => { refresh(); syncCoinbase(true); };
$("cbSync").onclick = () => syncCoinbase(true);
$("cbStatus").addEventListener("click", (e) => { if (e.target.id === "ownerBtn") { showLock(); $("lockInput").focus(); } });
$("lockBar").addEventListener("submit", (e) => {
  e.preventDefault();
  store.set("appPassword", $("lockInput").value);
  $("lockInput").value = "";
  syncCoinbase(true);
});
$("tf").onchange = () => { results = {}; render(); refresh(); };
window.addEventListener("resize", () => selected && renderDetail());

if (location.protocol !== "file:") {
  fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { siteConfig = c; renderDetail(); window.onSiteConfig?.(c); } }).catch(() => {});
}
showTab(new URLSearchParams(location.search).has("pro_session") ? "ai" : store.get("tab", "signals"));
applyLevel();
refresh(); // prices don't wait for the owner-only Coinbase check
syncCoinbase();
setInterval(refresh, 60000);
setInterval(() => location.protocol !== "file:" && syncCoinbase(), 120000);

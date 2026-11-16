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
const allSyms = () => [...new Set([...coins, ...cb.holdings.map((h) => h.sym)])];
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
  const p = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  const cls = (n) => (n >= 0 ? "up" : "down");
  const diff = bt.strategyReturn - bt.holdReturn;
  const since = new Date(bt.from * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const verdict = bt.trades + (bt.openTrade != null ? 1 : 0) === 0
    ? "The signals never said BUY in this period, so there is nothing to judge yet."
    : Math.abs(diff) < 0.02 ? "About the same as simply holding."
    : diff > 0 ? `Following the signals did <b>${(diff * 100).toFixed(1)} points better</b> than simply holding.`
    : `Following the signals did <b>${(-diff * 100).toFixed(1)} points worse</b> than simply holding.`;
  return `<h2>Track record on this chart</h2>
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
async function fetchPage(sym, gran, end) {
  const range = end ? `&start=${new Date((end - 299 * gran) * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}` : "";
  let res = await fetch(`${API}/products/${sym}-USD/candles?granularity=${gran}${range}`);
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 1200)); res = await fetch(`${API}/products/${sym}-USD/candles?granularity=${gran}${range}`); }
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

async function refresh() {
  $("status").textContent = "Fetching live data from Coinbase…";
  // small batches to stay under public rate limits
  const syms = allSyms();
  for (let i = 0; i < syms.length; i += 4) {
    await Promise.all(syms.slice(i, i + 4).map(async (sym) => {
      try { results[sym] = await analyzeCoin(sym); }
      catch (e) { results[sym] = { error: e.message }; }
    }));
  }
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
const coinName = (sym) => (COIN_NAMES[sym] && COIN_NAMES[sym] !== sym ? COIN_NAMES[sym] : "");
// What each signal means in everyday words
const PLAIN = {
  "STRONG BUY": "Uptrend with a dip. Conditions look very good.",
  BUY: "In an uptrend. Conditions look good.",
  HOLD: "Mixed signals. Wait and watch.",
  SELL: "In a downtrend. Better to stay out for now.",
  "STRONG SELL": "Strong downtrend. Stay out for now.",
};

function renderSummary() {
  const rs = allSyms().map((s) => results[s]).filter((r) => r && !r.error);
  if (!rs.length) return;
  const good = rs.filter((r) => r.action.includes("BUY")).length, bad = rs.filter((r) => r.action.includes("SELL")).length, mixed = rs.length - good - bad;
  const mood = good > bad && good >= rs.length / 2 ? "🟢 Most coins are in an uptrend right now."
    : bad > good && bad >= rs.length / 2 ? "🔴 Most coins are in a downtrend right now."
    : "🟡 The market is mixed right now.";
  $("summary").innerHTML = `${mood}<small>${good} look${good === 1 ? "s" : ""} good · ${mixed} mixed · ${bad} in a downtrend. Tap a coin to see why.</small>`;
}

function render() {
  renderSummary();
  // Keep your own order (no reshuffling on every refresh), so coins stay where you expect them.
  $("grid").innerHTML = allSyms().map((sym) => {
    const r = results[sym];
    const title = `<span class="sym">${sym}<span class="name">${coinName(sym)}</span></span>`;
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
      <div class="meter" title="Signal strength ${r.score.toFixed(1)}"><i style="left:${left}%;width:${w}%;background:${color}"></i><i style="left:50%;width:1px;background:var(--dim)"></i></div>
    </div>`;
  }).join("");
  renderDetail();
  renderHoldings();
}

function renderDetail() {
  const el = $("detail");
  const r = results[selected];
  if (!r || r.error) { el.style.display = "none"; return; }
  // Don't rebuild the chart in the middle of a drawing; the next refresh will catch up.
  if (window.Draw?.isBusy() && Draw.currentSym() === selected && el.style.display === "block") return;
  el.style.display = "block";
  const bt = trackRecord(selected, r.candles);
  el.innerHTML = `
    <div class="row detailHead"><h2 style="margin:0">${coinName(selected) || selected} <span class="muted">${selected}</span> · ${fmt(r.price)}</h2>
      <span><span class="${actionClass(r.action)}">${r.action}</span> <button class="x" id="detailClose" title="Close" aria-label="Close ${selected} details">✕</button></span></div>
    <p style="margin-top:6px">${PLAIN[r.action]}</p>
    <div id="chartWrap"></div>
    <div class="muted">Price (white) · 50-period avg (blue) · 200-period avg (orange) · Pick a tool above the chart to draw. Drawings are saved for this coin.</div>
    <h2>Why? <span class="muted">each line adds or removes points; the total (${r.score.toFixed(1)}) decides the signal</span></h2>
    <ul class="reasons">${r.reasons.map((x) => `<li><span class="pts" style="color:${x.pts > 0 ? "var(--buy)" : x.pts < 0 ? "var(--sell)" : "var(--dim)"}">${x.pts > 0 ? "+" : ""}${x.pts}</span><span>${x.text}</span></li>`).join("")}</ul>
    ${trackRecordHtml(bt)}
    <div class="links">
      ${siteConfig.coinbaseRef
        ? `<a href="${siteConfig.coinbaseRef}" target="_blank" rel="noopener sponsored">Sign up for Coinbase ↗ <small>(referral link: we may earn a commission)</small></a>`
        : `<a href="https://www.coinbase.com/advanced-trade/spot/${selected}-USD" target="_blank" rel="noopener">Trade on Coinbase ↗</a>`}
      <a href="https://www.exodus.com/" target="_blank" rel="noopener">Open Exodus ↗</a>
      <a href="https://www.tradingview.com/symbols/${selected}USD/" target="_blank" rel="noopener">Chart on TradingView ↗</a>
      <button class="primary" onclick="askAI('Should I buy, sell or hold ${selected} right now? Walk me through the signals and what people are saying.')">Ask AI about ${selected}</button>
    </div>
    <div id="detailSocial"></div>`;
  Draw.mount($("chartWrap"), selected, r.candles, bt?.markers);
  window.renderDetailSocial?.(selected);
}

async function syncCoinbase(force) {
  if (location.protocol === "file:") {
    cb.status = "To connect Coinbase, run <code>node server.js</code> and open http://localhost:8000";
    return renderHoldings();
  }
  cb.status = "Syncing Coinbase…"; renderHoldings();
  try {
    const res = await fetch("/api/coinbase/holdings" + (force ? "?force=1" : ""), { headers: authHeaders() });
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
    cb = { holdings: d.holdings, cash: d.cash, status: "✅ Coinbase connected · synced " + new Date(d.updated).toLocaleTimeString() };
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
  $("cbCash").textContent = cash ? "Cash on Coinbase: " + cash : "";
  const all = [...cb.holdings.map((h) => ({ ...h, src: "Coinbase" })), ...holdings.map((h, i) => ({ ...h, src: "Manual", idx: i }))];
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
    return `<tr><td><b>${h.sym}</b> <span class="muted">${h.src}</span></td><td>${+h.amt.toPrecision(8)}</td><td>${fmt(value)}</td>
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
  if (card) { selected = card.dataset.sym; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); }
});
$("grid").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.sym) { e.preventDefault(); e.target.click(); } });
$("detail").addEventListener("click", (e) => { if (e.target.id === "detailClose") { selected = null; render(); } });

// ── Tabs ──
const TABS = ["signals", "buzz", "alerts", "ai", "coins"];
function showTab(name) {
  if (!TABS.includes(name)) name = "signals";
  document.querySelectorAll("section.tab").forEach((s) => (s.hidden = s.dataset.tab !== name));
  document.querySelectorAll("#tabs button").forEach((b) => { const on = b.dataset.go === name; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  store.set("tab", name);
  if (name === "signals") renderDetail(); // the chart needs to be visible to size itself
  window.scrollTo(0, 0);
}
window.showTab = showTab;
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) showTab(b.dataset.go); });

// ── First-visit welcome ──
if (!store.get("welcomed", false)) $("welcome").hidden = false;
for (const id of ["welcomeOk", "welcomeClose"]) $(id).onclick = () => { store.set("welcomed", true); $("welcome").hidden = true; };
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
render();
syncCoinbase().then(refresh);
setInterval(refresh, 60000);
setInterval(() => location.protocol !== "file:" && syncCoinbase(), 120000);

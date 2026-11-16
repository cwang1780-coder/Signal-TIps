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

// Private endpoints (Coinbase sync, Ask AI) need the app password when the app is online.
const authHeaders = () => { const p = store.get("appPassword", ""); return p ? { "X-App-Password": p } : {}; };
function showLock(message) {
  $("lockMsg").textContent = message || "Enter the app password to see your Coinbase holdings and use Ask AI.";
  $("lockBar").hidden = false;
}

const $ = (id) => document.getElementById(id);
const fmt = (n) => n == null ? "—" : "$" + (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(4));
const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
const actionClass = (a) => "badge b-" + a.replace(" ", ".");

async function fetchCandles(sym, gran) {
  const res = await fetch(`${API}/products/${sym}-USD/candles?granularity=${gran}`);
  if (!res.ok) throw new Error(res.status === 404 ? "not on Coinbase" : "HTTP " + res.status);
  const raw = await res.json(); // [time, low, high, open, close, volume], newest first
  return raw.reverse().map(([time, low, high, open, close, volume]) => ({ time, low, high, open, close, volume }));
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

function render() {
  const sorted = allSyms().sort((a, b) => Math.abs(results[b]?.score ?? 0) - Math.abs(results[a]?.score ?? 0));
  $("grid").innerHTML = sorted.map((sym) => {
    const r = results[sym];
    if (!r) return `<div class="card"><div class="sym">${sym}</div><div class="muted">loading…</div></div>`;
    if (r.error) return `<div class="card"><div class="row"><span class="sym">${sym}</span><button class="x" data-rm="${sym}">✕</button></div><div class="muted">${r.error}</div></div>`;
    const w = Math.min(Math.abs(r.score) / 7, 1) * 50;
    const color = r.score >= 0 ? "var(--buy)" : "var(--sell)";
    const left = r.score >= 0 ? 50 : 50 - w;
    return `<div class="card ${selected === sym ? "sel" : ""}" data-sym="${sym}">
      <div class="row"><span class="sym">${sym}</span><span class="${actionClass(r.action)}">${r.action}</span></div>
      <div class="price">${fmt(r.price)}</div>
      <div class="row"><span class="chg ${r.change24 >= 0 ? "up" : "down"}">${pct(r.change24)} 24h</span><span class="muted">RSI ${r.rsi?.toFixed(0) ?? "—"}</span></div>
      <div class="meter" title="Signal score ${r.score.toFixed(1)}"><i style="left:${left}%;width:${w}%;background:${color}"></i><i style="left:50%;width:1px;background:var(--dim)"></i></div>
    </div>`;
  }).join("");
  renderDetail();
  renderHoldings();
}

function renderDetail() {
  const el = $("detail");
  const r = results[selected];
  if (!r || r.error) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = `
    <div class="row"><h2 style="margin:0">${selected}-USD · ${fmt(r.price)}</h2><span class="${actionClass(r.action)}">${r.action} (score ${r.score.toFixed(1)})</span></div>
    <canvas id="chart"></canvas>
    <div class="muted">Price (white) · 50-period avg (blue) · 200-period avg (orange)</div>
    <h2>Why this tip?</h2>
    <ul class="reasons">${r.reasons.map((x) => `<li><span class="pts" style="color:${x.pts > 0 ? "var(--buy)" : x.pts < 0 ? "var(--sell)" : "var(--dim)"}">${x.pts > 0 ? "+" : ""}${x.pts}</span><span>${x.text}</span></li>`).join("")}</ul>
    <div class="links">
      <a href="https://www.coinbase.com/advanced-trade/spot/${selected}-USD" target="_blank" rel="noopener">Trade on Coinbase ↗</a>
      <a href="https://www.exodus.com/" target="_blank" rel="noopener">Open Exodus ↗</a>
      <a href="https://www.tradingview.com/symbols/${selected}USD/" target="_blank" rel="noopener">Chart on TradingView ↗</a>
      <button class="primary" onclick="askAI('Should I buy, sell or hold ${selected} right now? Walk me through the signals and what people are saying.')">Ask AI about ${selected}</button>
    </div>
    <div id="detailSocial"></div>`;
  drawChart($("chart"), r.candles);
  window.renderDetailSocial?.(selected);
}

function drawChart(canvas, candles) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const closes = candles.map((c) => c.close);
  const s50 = Indicators.sma(closes, 50), s200 = Indicators.sma(closes, 200);
  const all = closes.concat(s50, s200).filter((v) => v != null);
  const min = Math.min(...all), max = Math.max(...all);
  const x = (i) => (i / (closes.length - 1)) * (W - 10) + 5;
  const y = (v) => H - 10 - ((v - min) / (max - min || 1)) * (H - 20);
  const line = (arr, color, width) => {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width;
    let started = false;
    arr.forEach((v, i) => { if (v == null) return; started ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); started = true; });
    ctx.stroke();
  };
  line(s200, "#f59e0b", 1.5); line(s50, "#3b82f6", 1.5); line(closes, "#e6ecf5", 2);
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
    if (res.status === 401) { showLock(store.get("appPassword", "") ? "Wrong password, try again." : null); cb = { holdings: [], cash: [], status: "🔒 Locked: enter the app password above." }; return render(); }
    if (!res.ok) throw new Error(d.reason || "server not reachable (HTTP " + res.status + ")");
    $("lockBar").hidden = true;
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
  if (!all.length) { $("holdings").innerHTML = `<tr><td class="muted">No holdings yet. Add what you own to get a tip for each.</td></tr>`; return; }
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
  if (card) { selected = card.dataset.sym; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
});
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
$("lockBar").addEventListener("submit", (e) => {
  e.preventDefault();
  store.set("appPassword", $("lockInput").value);
  $("lockInput").value = "";
  syncCoinbase(true);
});
$("tf").onchange = () => { results = {}; render(); refresh(); };
window.addEventListener("resize", () => selected && renderDetail());

render();
syncCoinbase().then(refresh);
setInterval(refresh, 60000);
setInterval(() => location.protocol !== "file:" && syncCoinbase(), 120000);

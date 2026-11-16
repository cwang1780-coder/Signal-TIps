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
let selected = null;

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
  for (let i = 0; i < coins.length; i += 4) {
    await Promise.all(coins.slice(i, i + 4).map(async (sym) => {
      try { results[sym] = await analyzeCoin(sym); }
      catch (e) { results[sym] = { error: e.message }; }
    }));
  }
  $("status").textContent = "Updated " + new Date().toLocaleTimeString();
  render();
}

function render() {
  const sorted = coins.slice().sort((a, b) => Math.abs(results[b]?.score ?? 0) - Math.abs(results[a]?.score ?? 0));
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
    </div>`;
  drawChart($("chart"), r.candles);
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

function renderHoldings() {
  if (!holdings.length) { $("holdings").innerHTML = `<tr><td class="muted">No holdings yet. Add what you own to get a tip for each.</td></tr>`; return; }
  let total = 0, totalCost = 0;
  const rows = holdings.map((h, i) => {
    const r = results[h.sym];
    const value = r?.price ? r.price * h.amt : null;
    const pl = value != null && h.cost ? value - h.cost * h.amt : null;
    if (value != null) total += value;
    if (h.cost) totalCost += h.cost * h.amt;
    let tip = r?.action ? `<span class="${actionClass(r.action)}">${r.action}</span>` : `<span class="muted">${r?.error || "loading"}</span>`;
    if (r?.action?.includes("SELL") && pl > 0) tip += ` <span class="muted">— consider taking some profit</span>`;
    if (r?.action?.includes("BUY") && pl < 0) tip += ` <span class="muted">— could average down</span>`;
    return `<tr><td><b>${h.sym}</b></td><td>${h.amt}</td><td>${fmt(value)}</td>
      <td class="chg ${pl >= 0 ? "up" : "down"}">${pl == null ? "—" : (pl >= 0 ? "+" : "-") + fmt(Math.abs(pl))}</td>
      <td>${tip}</td><td><button class="x" data-hrm="${i}">✕</button></td></tr>`;
  }).join("");
  $("holdings").innerHTML = `<tr><th>Coin</th><th>Amount</th><th>Value</th><th>Profit/Loss</th><th>Tip</th><th></th></tr>${rows}
    <tr><td><b>Total</b></td><td></td><td><b>${fmt(total)}</b></td><td class="chg ${total - totalCost >= 0 ? "up" : "down"}">${totalCost ? pct((total - totalCost) / totalCost) : ""}</td><td></td><td></td></tr>`;
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
  if (!sym || coins.includes(sym)) return;
  coins.push(sym); store.set("coins", coins); $("newSym").value = "";
  try { results[sym] = await analyzeCoin(sym); } catch (e) { results[sym] = { error: e.message }; }
  render();
};
$("hAdd").onclick = async () => {
  const sym = $("hSym").value.trim().toUpperCase(), amt = parseFloat($("hAmt").value), cost = parseFloat($("hCost").value) || 0;
  if (!sym || !(amt > 0)) return;
  holdings.push({ sym, amt, cost }); store.set("holdings", holdings);
  if (!coins.includes(sym)) { coins.push(sym); store.set("coins", coins); }
  $("hSym").value = $("hAmt").value = $("hCost").value = "";
  if (!results[sym]) { try { results[sym] = await analyzeCoin(sym); } catch (e) { results[sym] = { error: e.message }; } }
  render();
};
$("refresh").onclick = refresh;
$("tf").onchange = () => { results = {}; render(); refresh(); };
window.addEventListener("resize", () => selected && renderDetail());

render();
refresh();
setInterval(refresh, 60000);

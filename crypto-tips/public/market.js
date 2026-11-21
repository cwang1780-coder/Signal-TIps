// Trading panel on a coin's page, in the style of a pro exchange: a 24h stats bar, and a live order book and recent
// trades from Coinbase's public market data (through /api/candles?kind=..., refreshed every few seconds while visible).
// Uses globals from app.js: selected, Currency.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const data = {}; // sym -> { stats, book, trades, at }
  let tab = "book", timer = null, statsTimer = null, current = null;
  const num = (x, d = 2) => (x == null || !isFinite(x) ? "–" : (+x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pd = (p) => (p >= 1000 ? 2 : p >= 1 ? 3 : p >= 0.01 ? 5 : 8); // price decimals
  const big = (x) => (x >= 1e9 ? (x / 1e9).toFixed(2) + "B" : x >= 1e6 ? (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : num(x, 0));
  const get = (sym, kind) => fetch(`/api/candles?sym=${encodeURIComponent(sym)}&kind=${kind}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function barHtml(sym) {
    const s = data[sym]?.stats;
    if (!s) return `<div class="mkt-bar" id="mktBar" data-sym="${esc(sym)}"><span class="mkt-pair">${esc(sym)}-USD</span><span class="muted small">Loading market stats…</span></div>`;
    const last = +s.last, open = +s.open, ch = open ? last / open - 1 : 0, d = pd(last);
    const cell = (k, v, cls = "") => `<div class="mkt-cell"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    return `<div class="mkt-bar" id="mktBar" data-sym="${esc(sym)}">
      <span class="mkt-pair">${esc(sym)}-USD</span>
      ${cell("Last", "$" + num(last, d))}
      ${cell("24h change", (ch >= 0 ? "+" : "") + (ch * 100).toFixed(2) + "%", ch >= 0 ? "up" : "down")}
      ${cell("24h volume", "$" + big(+s.volume * last))}
      ${cell("24h high", "$" + num(+s.high, d))}
      ${cell("24h low", "$" + num(+s.low, d))}
    </div>`;
  }

  function bookBody(sym) {
    const b = data[sym]?.book;
    if (!b) return `<p class="muted small">Loading the order book…</p>`;
    const asks = b.asks.slice(0, 9).map((x) => [+x[0], +x[1]]), bids = b.bids.slice(0, 9).map((x) => [+x[0], +x[1]]);
    if (!asks.length || !bids.length) return `<p class="muted small">No order book for this coin right now.</p>`;
    let ca = 0, cb = 0;
    const askCum = asks.map(([, q]) => (ca += q)), bidCum = bids.map(([, q]) => (cb += q)), max = Math.max(ca, cb), d = pd(asks[0][0]);
    const line = (p, q, cum, side) => `<div class="ob-row ${side}"><i style="width:${((cum / max) * 100).toFixed(1)}%"></i><span>${num(p, d)}</span><span>${q < 0.001 ? q.toPrecision(2) : num(q, 4)}</span><span>${num(cum, 4)}</span></div>`;
    const spread = asks[0][0] - bids[0][0];
    return `<div class="ob-head"><span>Price (USD)</span><span>Size (${esc(sym)})</span><span>Total</span></div>
      <div class="ob-asks">${asks.map(([p, q], i) => line(p, q, askCum[i], "ask")).reverse().join("")}</div>
      <div class="ob-spread"><b>$${num((asks[0][0] + bids[0][0]) / 2, d)}</b><span class="muted small">Spread ${num(spread, d)} (${((spread / asks[0][0]) * 100).toFixed(3)}%)</span></div>
      <div class="ob-bids">${bids.map(([p, q], i) => line(p, q, bidCum[i], "bid")).join("")}</div>`;
  }
  function tradesBody(sym) {
    const t = data[sym]?.trades;
    if (!t) return `<p class="muted small">Loading recent trades…</p>`;
    // Coinbase marks the side of the resting order: "sell" means someone bought from a seller (price went up)
    return `<div class="ob-head"><span>Price (USD)</span><span>Size</span><span>Time</span></div>
      ${t.slice(0, 18).map((x) => `<div class="tr-row ${x.side === "sell" ? "bid" : "ask"}"><span>${num(+x.price, pd(+x.price))}</span><span>${(+x.size).toPrecision(4)}</span><span class="muted">${new Date(x.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>`).join("")}`;
  }
  function panelHtml(sym) {
    return `<div class="side-box ob-box" id="obBox" data-sym="${esc(sym)}">
      <div class="ob-tabs"><button class="${tab === "book" ? "on" : ""}" data-ob="book">Order book</button><button class="${tab === "trades" ? "on" : ""}" data-ob="trades">Trades</button><span class="ob-live"><i></i>Live</span></div>
      <div class="ob-body">${tab === "book" ? bookBody(sym) : tradesBody(sym)}</div>
      <p class="muted small ob-note">Live from Coinbase. Signal Tips doesn't place trades.</p></div>`;
  }
  const paint = () => {
    const b = document.getElementById("obBox"); if (b && b.dataset.sym === current) b.outerHTML = panelHtml(current);
    const m = document.getElementById("mktBar"); if (m && m.dataset.sym === current) m.outerHTML = barHtml(current);
  };

  async function tick() {
    const sym = current;
    if (!sym || document.hidden || !document.getElementById("obBox")) return;
    const [book, trades] = await Promise.all([tab === "book" ? get(sym, "book") : null, tab === "trades" ? get(sym, "trades") : null]);
    if (sym !== current) return;
    data[sym] = { ...data[sym], ...(book ? { book } : {}), ...(trades ? { trades } : {}) };
    paint();
  }
  async function stats() {
    const sym = current;
    if (!sym || document.hidden) return;
    const s = await get(sym, "stats");
    if (s && sym === current) { data[sym] = { ...data[sym], stats: s }; paint(); }
  }
  function follow(sym) {
    if (current === sym && timer) return;
    current = sym;
    clearInterval(timer); clearInterval(statsTimer);
    timer = setInterval(tick, 3000); statsTimer = setInterval(stats, 15000);
    setTimeout(() => { tick(); stats(); }, 0);
  }
  window.marketBarHtml = (sym) => { follow(sym); return barHtml(sym); };
  window.bookHtml = (sym) => { follow(sym); return panelHtml(sym); };
  window.stopMarket = () => { clearInterval(timer); clearInterval(statsTimer); timer = statsTimer = null; current = null; };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-ob]"); if (b) { tab = b.dataset.ob; paint(); tick(); } });
})();

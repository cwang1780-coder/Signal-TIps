// Pro chart: candlesticks (or a smooth line) with timeframes down to 1 second, live updates, crosshair readout,
// volume, zoom and drag. Built on TradingView's open-source Lightweight Charts (vendor/lightweight-charts.js, Apache 2.0).
//
//   ProChart.mount(container, source, { theme, tf, onCandles })
//   source: { kind: "coinbase", sym }               mainstream coins: 1s (live trades) … 1D from Coinbase
//           { kind: "gecko", network, pool, sym }   Trench "Upcoming": 1m … 1D from GeckoTerminal
//           { kind: "coingecko", id, sym }          Trench "Big movers": 30m / 4h from CoinGecko
// Prices arrive in US dollars and are shown in the visitor's currency (currency.js).
(function () {
  const CB = "https://api.exchange.coinbase.com";
  const TFS = {
    coinbase: [["1s", "1s"], ["1m", 60], ["5m", 300], ["15m", 900], ["1H", 3600], ["6H", 21600], ["1D", 86400]],
    gecko: [["1m", "minute:1"], ["5m", "minute:5"], ["15m", "minute:15"], ["1H", "hour:1"], ["4H", "hour:4"], ["1D", "day:1"]],
    coingecko: [["30m", 1], ["4H", 30]],
  };
  const SECS = { "1s": 1, "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "6H": 21600, "1D": 86400, "30m": 1800 };
  const tz = -new Date().getTimezoneOffset() * 60; // the library shows UTC: shift so axes read in local time
  const rate = () => (window.Currency ? Currency.toLocal(1) : 1);
  const fmtP = (p) => {
    if (!isFinite(p) || p < 0) return ""; // the space under the chart (for volume) can dip below zero: no negative prices
    const a = Math.abs(p), cur = window.Currency?.code || "USD";
    const opts = a >= 1000 ? { maximumFractionDigits: 2 } : a >= 1 ? { maximumFractionDigits: 4 } : { maximumSignificantDigits: 4 };
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, ...opts }).format(p); } catch { return p.toPrecision(5); }
  };
  const fmtV = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(v < 10 ? 2 : 0));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const THEMES = {
    light: { bg: "#ffffff", text: "#5b616e", grid: "rgba(10,11,13,.05)", up: "#098551", down: "#cf202f", line: "#0052ff", area: "rgba(0,82,255,.18)", cross: "rgba(10,11,13,.35)" },
    night: { bg: "#141519", text: "#8a919e", grid: "rgba(255,255,255,.05)", up: "#27ad75", down: "#f0616d", line: "#3b78ff", area: "rgba(59,120,255,.2)", cross: "rgba(255,255,255,.35)" },
    dark: { bg: "#101a12", text: "#9fb09c", grid: "rgba(255,255,255,.05)", up: "#8fcf86", down: "#e0786c", line: "#e8c46c", area: "rgba(232,196,108,.22)", cross: "rgba(255,255,255,.35)" },
  };

  async function getJSON(url, opts) {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // ── Data loaders: every loader returns candles oldest first, prices in USD ──
  async function loadCoinbase(sym, gran) {
    const raw = await getJSON(`/api/candles?sym=${encodeURIComponent(sym)}&gran=${gran}`).catch(() => getJSON(`${CB}/products/${encodeURIComponent(sym)}-USD/candles?granularity=${gran}`));
    return raw.map(([t, l, h, o, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v })).sort((a, b) => a.time - b.time);
  }
  async function loadTrades(sym) { // recent trades, newest first: [{time, price, size, id}]
    const raw = await getJSON(`${CB}/products/${encodeURIComponent(sym)}-USD/trades?limit=1000`);
    return raw.map((t) => ({ time: Date.parse(t.time) / 1000, price: +t.price, size: +t.size, id: t.trade_id }));
  }
  function bucket(trades, secs) { // trades -> candles
    const m = new Map();
    for (const t of trades.slice().sort((a, b) => a.time - b.time)) {
      const k = Math.floor(t.time / secs) * secs, c = m.get(k);
      if (!c) m.set(k, { time: k, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.size });
      else { c.high = Math.max(c.high, t.price); c.low = Math.min(c.low, t.price); c.close = t.price; c.volume += t.size; }
    }
    return [...m.values()];
  }
  async function loadGecko(network, pool, tf) {
    const [unit, agg] = tf.split(":"), q = `network=${encodeURIComponent(network)}&pool=${encodeURIComponent(pool)}&tf=${encodeURIComponent(tf)}`;
    let d = await getJSON("/api/trench?mode=chart&" + q).catch(() => null);
    if (!d?.candles?.length) { // our server was rate-limited: ask GeckoTerminal from this device
      const g = await getJSON(`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${unit}?aggregate=${agg}&limit=500&currency=usd`, { headers: { Accept: "application/json" } });
      d = { candles: (g.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, c, v]) => ({ time: t, open: +o, high: +h, low: +l, close: +c, volume: +v })) };
    }
    return d.candles.filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
  }
  async function loadCoinGecko(id, days) {
    const d = await getJSON(`/api/trench?mode=chart&id=${encodeURIComponent(id)}&days=${days}`);
    return d.candles.sort((a, b) => a.time - b.time);
  }

  function mount(container, source, opts = {}) {
    if (!window.LightweightCharts) { container.innerHTML = `<p class="muted">Chart library didn't load.</p>`; return null; }
    const th = THEMES[opts.theme || "light"], tfs = TFS[source.kind];
    const saved = (() => { try { return JSON.parse(localStorage.getItem("pcPrefs") || "{}"); } catch { return {}; } })();
    let tf = opts.tf || saved[source.kind] || (source.kind === "coinbase" ? "1H" : tfs[3]?.[0] || tfs[0][0]);
    if (!tfs.some(([k]) => k === tf)) tf = tfs[0][0];
    let type = saved.type || "candles", candles = [], ws = null, poll = null, refresh = null, dead = false, lastTradeId = 0;

    const root = document.createElement("div");
    root.className = "pc pc-" + (opts.theme || "light");
    root.innerHTML = `
      <div class="pc-bar">
        <div class="pc-tfs" role="group" aria-label="Timeframe">${tfs.map(([k]) => `<button data-tf="${k}" class="${k === tf ? "on" : ""}">${k}</button>`).join("")}</div>
        <div class="pc-types" role="group" aria-label="Chart type"><button data-type="candles" class="${type === "candles" ? "on" : ""}" title="Candlesticks">${candleIcon}</button><button data-type="line" class="${type === "line" ? "on" : ""}" title="Line">${lineIcon}</button></div>
        <span class="pc-live" hidden><i></i>Live</span>
      </div>
      <div class="pc-stage"><div class="pc-legend"></div><div class="pc-chart"></div><div class="pc-msg" hidden></div></div>`;
    container.innerHTML = "";
    container.appendChild(root);
    const el = root.querySelector(".pc-chart"), legend = root.querySelector(".pc-legend"), msg = root.querySelector(".pc-msg"), live = root.querySelector(".pc-live");

    const chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: th.bg }, textColor: th.text, fontFamily: "Inter, -apple-system, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 8 },
      crosshair: { mode: 0, vertLine: { color: th.cross, labelBackgroundColor: th.text }, horzLine: { color: th.cross, labelBackgroundColor: th.text } },
      localization: { priceFormatter: fmtP },
      handleScroll: { vertTouchDrag: false },
    });
    const candleSeries = chart.addCandlestickSeries({ upColor: th.up, downColor: th.down, wickUpColor: th.up, wickDownColor: th.down, borderVisible: false, priceFormat: { type: "price", precision: 10, minMove: 1e-10 } });
    const lineSeries = chart.addAreaSeries({ lineColor: th.line, topColor: th.area, bottomColor: "rgba(0,0,0,0)", lineWidth: 2, priceFormat: { type: "price", precision: 10, minMove: 1e-10 }, visible: false });
    const volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // Drawing tools (pcdraw.js): saved per coin, anchored to time and price
    const draw = window.PCDraw?.attach({
      chart, series: () => (type === "line" ? lineSeries : candleSeries), stage: root.querySelector(".pc-stage"), candles: () => candles, tz, rate,
      key: "pcDraw:" + source.kind + ":" + (source.sym || source.id || source.pool), sym: source.sym, fmtP, onAlert: opts.onAlert,
    });
    const toBar = (c) => { const k = rate(); return { time: c.time + tz, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }; };
    const toVol = (c) => ({ time: c.time + tz, value: c.volume || 0, color: c.close >= c.open ? hexA(th.up, 0.35) : hexA(th.down, 0.35) });
    const toLine = (c) => ({ time: c.time + tz, value: c.close * rate() });
    function setAll(list) {
      candles = list;
      candleSeries.setData(list.map(toBar)); lineSeries.setData(list.map(toLine)); volSeries.setData(list.map(toVol));
      showLegend(list[list.length - 1], list[list.length - 2]);
      opts.onCandles?.(list, tf);
    }
    function upsert(c) {
      const last = candles[candles.length - 1];
      if (last && last.time === c.time) candles[candles.length - 1] = c; else if (!last || c.time > last.time) candles.push(c); else return;
      candleSeries.update(toBar(c)); lineSeries.update(toLine(c)); volSeries.update(toVol(c));
      if (!hovering) showLegend(c, candles[candles.length - 2]);
    }
    let hovering = false;
    function showLegend(c, prev) {
      if (!c) { legend.innerHTML = ""; return; }
      const k = rate(), ch = prev ? c.close / prev.close - 1 : c.close / c.open - 1, cls = ch >= 0 ? "up" : "down";
      legend.innerHTML = `<b>${esc(source.sym || "")}</b><span class="pc-tf">${tf}</span>
        <span>O <em class="${cls}">${fmtP(c.open * k)}</em></span><span>H <em class="${cls}">${fmtP(c.high * k)}</em></span><span>L <em class="${cls}">${fmtP(c.low * k)}</em></span><span>C <em class="${cls}">${fmtP(c.close * k)}</em></span>
        <span class="${cls}">${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(2)}%</span>${c.volume ? `<span>Vol <em>${fmtV(c.volume)}</em></span>` : ""}`;
    }
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) { hovering = false; showLegend(candles[candles.length - 1], candles[candles.length - 2]); return; }
      hovering = true;
      const i = candles.findIndex((c) => c.time + tz === p.time);
      if (i >= 0) showLegend(candles[i], candles[i - 1]);
    });
    function setType(t) {
      type = t; candleSeries.applyOptions({ visible: t === "candles" }); lineSeries.applyOptions({ visible: t === "line" });
      root.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("on", b.dataset.type === t));
      savePrefs();
    }
    function savePrefs() { try { const p = JSON.parse(localStorage.getItem("pcPrefs") || "{}"); p[source.kind] = tf; p.type = type; localStorage.setItem("pcPrefs", JSON.stringify(p)); } catch {} }

    // ── Live updates ──
    function stopLive() { if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; } clearInterval(poll); clearInterval(refresh); poll = refresh = null; live.hidden = true; }
    function onTrade(t) {
      if (t.id && t.id <= lastTradeId) return;
      if (t.id) lastTradeId = t.id;
      const secs = SECS[tf], k = Math.floor(t.time / secs) * secs, last = candles[candles.length - 1];
      if (last && last.time === k) upsert({ ...last, high: Math.max(last.high, t.price), low: Math.min(last.low, t.price), close: t.price, volume: (last.volume || 0) + t.size });
      else if (!last || k > last.time) upsert({ time: k, open: last ? last.close : t.price, high: t.price, low: t.price, close: t.price, volume: t.size });
    }
    function startLive() {
      if (source.kind !== "coinbase") { // DEX coins: refresh the newest candles every 30 seconds
        refresh = setInterval(async () => { try { const list = await fetchTf(); const n = list.slice(-2); n.forEach(upsert); } catch {} }, 30000);
        live.hidden = false; return;
      }
      let gotWs = false;
      try {
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", product_ids: [source.sym + "-USD"], channels: ["matches"] }));
        ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "match" || m.type === "last_match") { gotWs = true; live.hidden = false; onTrade({ time: Date.parse(m.time) / 1000, price: +m.price, size: +m.size, id: m.trade_id }); } };
        ws.onerror = () => {};
        ws.onclose = () => { ws = null; if (!dead) startPolling(); };
      } catch { startPolling(); }
      setTimeout(() => { if (!gotWs && !dead && !poll) startPolling(); }, 6000); // feed blocked (e.g. a strict network): poll recent trades instead
    }
    function startPolling() {
      if (poll || dead) return;
      poll = setInterval(async () => { try { (await loadTrades(source.sym)).reverse().forEach(onTrade); live.hidden = false; } catch {} }, 2000);
    }

    const tfVal = () => tfs.find(([k]) => k === tf)[1];
    async function fetchTf() {
      if (source.kind === "coinbase") {
        if (tf === "1s") { const tr = await loadTrades(source.sym); lastTradeId = tr[0]?.id || 0; return bucket(tr, 1); }
        return loadCoinbase(source.sym, tfVal());
      }
      if (source.kind === "gecko") return loadGecko(source.network, source.pool, tfVal());
      return loadCoinGecko(source.id, tfVal());
    }
    async function load() {
      stopLive();
      msg.hidden = false; msg.textContent = tf === "1s" ? "Loading live trades…" : "Loading candles…";
      chart.applyOptions({ timeScale: { secondsVisible: SECS[tf] < 60 } });
      try {
        const list = await fetchTf();
        if (dead) return;
        if (list.length < 2) { msg.textContent = "Not enough price history for this timeframe yet."; setAll(list); return; }
        msg.hidden = true;
        setAll(list);
        chart.timeScale().fitContent();
        if (list.length > 150) chart.timeScale().setVisibleLogicalRange({ from: list.length - 150, to: list.length + 4 });
        startLive();
      } catch (e) { msg.hidden = false; msg.textContent = "Couldn't load the chart right now. Try another timeframe."; }
    }

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tf]"), ty = e.target.closest("[data-type]");
      if (b && b.dataset.tf !== tf) { tf = b.dataset.tf; root.querySelectorAll("[data-tf]").forEach((x) => x.classList.toggle("on", x === b)); savePrefs(); load(); }
      if (ty) setType(ty.dataset.type);
    });
    setType(type);
    load();
    const onCur = () => setAll(candles);
    document.addEventListener("currency-changed", onCur);

    return {
      root, sourceKey: JSON.stringify(source),
      attach(c) { if (root.parentNode !== c) { c.innerHTML = ""; c.appendChild(root); } },
      destroy() { dead = true; draw?.destroy(); stopLive(); document.removeEventListener("currency-changed", onCur); try { chart.remove(); } catch {} root.remove(); },
      candles: () => candles, tf: () => tf,
    };
  }

  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const candleIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 3v4M7 17v4M17 5v3M17 16v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="4.5" y="7" width="5" height="10" rx="1.2" fill="currentColor"/><rect x="14.5" y="8" width="5" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const lineIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 17l5-5 4 3 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  window.ProChart = { mount };
})();

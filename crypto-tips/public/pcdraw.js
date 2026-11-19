// Drawing tools for the candlestick chart (prochart.js), in the style of pro charting platforms:
// trend line, ray, horizontal / vertical line, parallel channel, Fibonacci retracement, rectangle, price range,
// long / short position, brush and text. Magnet snapping, colours, widths, select / move / resize, undo, hide, lock.
// Drawings are anchored to time and price (USD), so they follow the chart when you zoom, scroll, switch
// timeframe or currency, and they're saved per coin in this browser.
(function () {
  const TOOLS = [
    ["cursor", "Select and move", '<path d="M5 3l14 7-6.2 1.8L11 18z"/>'],
    ["trend", "Trend line", '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.8"/><circle cx="20" cy="5" r="1.8"/>'],
    ["ray", "Ray (extends right)", '<path d="M4 18L21 6"/><circle cx="4" cy="18" r="1.8"/><path d="M17 5l4 1-1 4"/>'],
    ["hline", "Horizontal line (can set an alert)", '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.8"/>'],
    ["vline", "Vertical line", '<path d="M12 3v18"/><circle cx="12" cy="12" r="1.8"/>'],
    ["channel", "Parallel channel", '<path d="M3 16L17 6M7 20L21 10"/>'],
    ["fib", "Fibonacci retracement", '<path d="M3 5h18M3 9h18M3 13h18M3 19h18" opacity=".9"/><path d="M5 19L19 5" stroke-dasharray="2 2"/>'],
    ["rect", "Rectangle", '<rect x="4" y="6" width="16" height="12" rx="1.5"/>'],
    ["range", "Price range (measure)", '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/><path d="M4 4h16M4 20h16" opacity=".6"/>'],
    ["long", "Long position", '<rect x="4" y="4" width="16" height="9" rx="1"/><rect x="4" y="13" width="16" height="7" rx="1" opacity=".5"/><path d="M8 9l2-2 2 2"/>'],
    ["short", "Short position", '<rect x="4" y="4" width="16" height="7" rx="1" opacity=".5"/><rect x="4" y="11" width="16" height="9" rx="1"/><path d="M8 15l2 2 2-2"/>'],
    ["brush", "Brush", '<path d="M4 18c3 0 3-4 6-4s3 3 6 1 2-6 4-8"/>'],
    ["text", "Text note", '<path d="M5 6h14M12 6v13"/>'],
  ];
  const COLORS = ["#2962ff", "#f5a623", "#e91e63", "#089981", "#f23645", "#7e57c2", "#131722"];
  const FIB = [[0, "#787b86"], [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"], [1, "#787b86"]];
  const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const uid = () => Math.random().toString(36).slice(2, 9);

  function attach({ chart, series: seriesArg, stage, candles, tz, rate, key, sym, fmtP, onAlert }) {
    const S = () => (typeof seriesArg === "function" ? seriesArg() : seriesArg);
    const load = () => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
    let shapes = load(), undo = [], tool = "cursor", color = COLORS[0], width = 2, magnet = true, hidden = false, locked = false;
    let sel = null, draft = null, drag = null, hover = null;
    const save = () => { try { localStorage.setItem(key, JSON.stringify(shapes)); } catch {} };
    const snapshot = () => { undo.push(JSON.stringify(shapes)); if (undo.length > 50) undo.shift(); };

    // ── UI: vertical tool strip + options bar ──
    const strip = document.createElement("div");
    strip.className = "pcd-strip";
    strip.innerHTML = TOOLS.map(([id, t, d]) => `<button data-tool="${id}" title="${t}" aria-label="${t}" class="${id === tool ? "on" : ""}">${icon(d)}</button>`).join("") +
      `<span class="pcd-sep"></span>
      <button data-opt="magnet" class="on" title="Magnet: snap to candle open/high/low/close" aria-label="Magnet">${icon('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 4h3v8a3 3 0 0 0 6 0V4h3" opacity=".55"/><path d="M6 7h3M15 7h3"/>')}</button>
      <button data-opt="lock" title="Lock all drawings" aria-label="Lock drawings">${icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>')}</button>
      <button data-opt="hide" title="Hide all drawings" aria-label="Hide drawings">${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button>
      <button data-opt="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')}</button>
      <button data-opt="clear" title="Remove all drawings" aria-label="Remove all drawings">${icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')}</button>`;
    const opts = document.createElement("div");
    opts.className = "pcd-opts";
    stage.appendChild(strip); stage.appendChild(opts);
    const canvas = document.createElement("canvas");
    canvas.className = "pcd-canvas";
    stage.querySelector(".pc-chart").appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function renderOpts() {
      const s = shapes.find((x) => x.id === sel);
      opts.hidden = !s && tool === "cursor";
      if (opts.hidden) return;
      const c = s ? s.color : color, w = s ? s.width : width;
      opts.innerHTML = COLORS.map((k) => `<button class="pcd-sw ${k === c ? "on" : ""}" data-color="${k}" style="background:${k}" aria-label="Colour"></button>`).join("") +
        `<span class="pcd-sep h"></span>${[1, 2, 3].map((k) => `<button class="pcd-w ${k === w ? "on" : ""}" data-width="${k}" aria-label="Line width ${k}"><i style="height:${k + 0.5}px"></i></button>`).join("")}` +
        (s && s.type === "hline" && onAlert ? `<span class="pcd-sep h"></span><button class="pcd-txt" data-act="alert">Set alert at ${fmtP(s.p[0].p * rate())}</button>` : "") +
        (s && s.type === "text" ? `<span class="pcd-sep h"></span><button class="pcd-txt" data-act="edit">Edit text</button>` : "") +
        (s ? `<span class="pcd-sep h"></span><button class="pcd-txt danger" data-act="delete" title="Delete (Del)">Delete</button>` : `<span class="pcd-hint">${hintFor(tool)}</span>`);
    }
    const hintFor = (t) => ({ trend: "Click two points", ray: "Click two points", hline: "Click a price", vline: "Click a time", channel: "Click two points, then the channel width", fib: "Click the swing low and high", rect: "Click two corners", range: "Click start and end to measure", long: "Click your entry price", short: "Click your entry price", brush: "Hold and draw", text: "Click where to write" }[t] || "");

    // ── coordinate conversion: time/price <-> pixels (logical bar index handles the future too) ──
    const ts = () => chart.timeScale();
    const bars = () => candles();
    function timeToLogical(t) {
      const c = bars(), n = c.length;
      if (!n) return null;
      const iv = n > 1 ? c[n - 1].time - c[n - 2].time : 60;
      if (t <= c[0].time) return (t - c[0].time) / (n > 1 ? c[1].time - c[0].time : iv);
      if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / iv;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].time <= t) lo = m; else hi = m; }
      return lo + (t - c[lo].time) / (c[hi].time - c[lo].time || 1);
    }
    function logicalToTime(l) {
      const c = bars(), n = c.length;
      if (!n) return 0;
      const iv = n > 1 ? c[n - 1].time - c[n - 2].time : 60;
      if (l <= 0) return c[0].time + l * (n > 1 ? c[1].time - c[0].time : iv);
      if (l >= n - 1) return c[n - 1].time + (l - (n - 1)) * iv;
      const i = Math.floor(l);
      return c[i].time + (l - i) * (c[i + 1].time - c[i].time);
    }
    const X = (t) => { const l = timeToLogical(t); return l == null ? null : ts().logicalToCoordinate(l); };
    const Y = (p) => S().priceToCoordinate(p * rate());
    const toPt = (x, y) => {
      let l = ts().coordinateToLogical(x), p = S().coordinateToPrice(y);
      if (l == null || p == null) return null;
      p = p / rate();
      if (magnet) { // snap to the nearest bar's open/high/low/close when close by
        const c = bars(), i = Math.round(l);
        if (c[i]) {
          const best = [c[i].open, c[i].high, c[i].low, c[i].close].map((v) => [v, Math.abs(Y(v) - y)]).sort((a, b) => a[1] - b[1])[0];
          if (best[1] < 14) { p = best[0]; l = i; }
        }
      }
      return { t: logicalToTime(l), p };
    };
    const pane = () => ({ w: canvas.clientWidth - (chart.priceScale("right").width() || 0), h: canvas.clientHeight - (ts().height() || 0) });

    // ── drawing ──
    function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    function handle(x, y) { ctx.save(); ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.strokeStyle = ctx.__c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
    function label(text, x, y, bg, fg = "#fff", align = "left") {
      ctx.save(); ctx.font = "600 11px Inter, sans-serif"; const w = ctx.measureText(text).width + 12;
      const lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, y - 10, w, 20, 5) : ctx.rect(lx, y - 10, w, 20); ctx.fill();
      ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, lx + 6, y + 0.5); ctx.restore();
    }
    const pctTxt = (a, b) => ((b / a - 1) * 100).toFixed(2) + "%";
    const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

    function drawShape(s, active) {
      const pts = s.p.map((q) => [X(q.t), Y(q.p)]);
      if (pts.some(([x, y]) => x == null || y == null)) return;
      const { w: PW } = pane();
      ctx.strokeStyle = s.color; ctx.__c = s.color; ctx.lineWidth = s.width; ctx.setLineDash([]); ctx.fillStyle = alpha(s.color, 0.12);
      const [a, b, c3] = pts;
      switch (s.type) {
        case "trend": line(a[0], a[1], b[0], b[1]); break;
        case "ray": { const dx = b[0] - a[0], dy = b[1] - a[1], k = dx ? (PW - a[0]) / dx : 0; line(a[0], a[1], dx > 0 ? PW : b[0], dx > 0 ? a[1] + dy * k : b[1]); break; }
        case "hline": line(0, a[1], PW, a[1]); label(fmtP(s.p[0].p * rate()), PW - 4, a[1], s.color, "#fff", "right"); break;
        case "vline": line(a[0], 0, a[0], pane().h); break;
        case "channel": {
          const off = c3 ? c3[1] - (a[1] + (b[1] - a[1]) * ((c3[0] - a[0]) / ((b[0] - a[0]) || 1))) : 0;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] + off); ctx.lineTo(a[0], a[1] + off); ctx.closePath(); ctx.fill();
          line(a[0], a[1], b[0], b[1]); line(a[0], a[1] + off, b[0], b[1] + off);
          ctx.setLineDash([4, 4]); line(a[0], a[1] + off / 2, b[0], b[1] + off / 2); ctx.setLineDash([]);
          if (active && c3) handle((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + off);
          break;
        }
        case "fib": {
          const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]) + 60, p1 = s.p[0].p, p2 = s.p[1].p;
          FIB.forEach(([lv, col], i) => {
            const price = p2 + (p1 - p2) * lv, y = Y(price);
            if (i < FIB.length - 1) { const yn = Y(p2 + (p1 - p2) * FIB[i + 1][0]); ctx.fillStyle = alpha(col, 0.08); ctx.fillRect(x1, Math.min(y, yn), x2 - x1, Math.abs(yn - y)); }
            ctx.strokeStyle = col; ctx.lineWidth = 1; line(x1, y, x2, y);
            ctx.save(); ctx.font = "600 11px Inter, sans-serif"; ctx.fillStyle = col; ctx.textBaseline = "bottom"; ctx.fillText(`${lv} (${fmtP(price * rate())})`, x1 + 4, y - 2); ctx.restore();
          });
          ctx.strokeStyle = s.color; ctx.setLineDash([4, 4]); line(a[0], a[1], b[0], b[1]); ctx.setLineDash([]);
          break;
        }
        case "rect": ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); break;
        case "range": {
          const up = s.p[1].p >= s.p[0].p, col = up ? "#089981" : "#f23645";
          ctx.fillStyle = alpha(col, 0.14); ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; const mx = (a[0] + b[0]) / 2; line(mx, a[1], mx, b[1]);
          ctx.beginPath(); ctx.moveTo(mx - 5, b[1] + (up ? 7 : -7)); ctx.lineTo(mx, b[1]); ctx.lineTo(mx + 5, b[1] + (up ? 7 : -7)); ctx.stroke();
          const nb = Math.round(timeToLogical(s.p[1].t) - timeToLogical(s.p[0].t)), secs = Math.abs(s.p[1].t - s.p[0].t);
          const dur = secs >= 86400 ? (secs / 86400).toFixed(1) + "d" : secs >= 3600 ? (secs / 3600).toFixed(1) + "h" : Math.round(secs / 60) + "m";
          label(`${up ? "+" : ""}${fmtP((s.p[1].p - s.p[0].p) * rate())} (${up ? "+" : ""}${pctTxt(s.p[0].p, s.p[1].p)}) · ${Math.abs(nb)} bars, ${dur}`, mx, b[1] + (up ? -16 : 16), col, "#fff", "center");
          break;
        }
        case "long": case "short": {
          // p[0] = entry (and left edge), p[1] = right edge (time) + target price, p[2] = stop price
          const ye = Y(s.p[0].p), yt = Y(s.p[1].p), ys = Y(s.p[2].p), xl = a[0], xr = b[0];
          ctx.fillStyle = "rgba(8,153,129,.2)"; ctx.fillRect(xl, Math.min(ye, yt), xr - xl, Math.abs(yt - ye));
          ctx.fillStyle = "rgba(242,54,69,.2)"; ctx.fillRect(xl, Math.min(ye, ys), xr - xl, Math.abs(ys - ye));
          ctx.strokeStyle = "#787b86"; ctx.lineWidth = 1; line(xl, ye, xr, ye);
          const e = s.p[0].p, tgt = s.p[1].p, st = s.p[2].p, rr = Math.abs(tgt - e) / (Math.abs(e - st) || 1);
          label(`Target ${fmtP(tgt * rate())} (${pctTxt(e, tgt)})`, xl + 4, yt + (yt < ye ? 12 : -12), "#089981");
          label(`Stop ${fmtP(st * rate())} (${pctTxt(e, st)})`, xl + 4, ys + (ys > ye ? -12 : 12), "#f23645");
          label(`${s.type === "long" ? "Long" : "Short"} · Risk/reward ${rr.toFixed(2)}`, xl + 4, ye, "#131722");
          if (active) { handle(xr, ye); handle((xl + xr) / 2, yt); handle((xl + xr) / 2, ys); }
          return;
        }
        case "brush": { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); break; }
        case "text": {
          ctx.save(); ctx.font = `600 ${11 + s.width * 2}px Inter, sans-serif`; ctx.fillStyle = s.color; ctx.textBaseline = "middle"; ctx.fillText(s.text || "Note", a[0] + 6, a[1]); ctx.restore();
          ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(a[0], a[1], 3, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      if (active && s.type !== "brush") pts.forEach(([x, y], i) => { if (!(s.type === "channel" && i === 2)) handle(x, y); });
    }

    function paint() {
      const dpr = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (hidden || !bars().length) return;
      const { w, h } = pane();
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      for (const s of shapes) drawShape(s, s.id === sel || s.id === hover);
      if (draft) drawShape(draft, true);
      ctx.restore();
    }
    let raf = 0;
    const loop = () => { paint(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    // ── hit testing ──
    function distSeg(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    function hit(px, py) { // -> {s, handle index or -1}
      if (hidden) return null;
      const { w: PW, h: PH } = pane();
      for (let k = shapes.length - 1; k >= 0; k--) {
        const s = shapes[k], pts = s.p.map((q) => [X(q.t), Y(q.p)]);
        if (pts.some(([x, y]) => x == null || y == null)) continue;
        if (s.type === "long" || s.type === "short") {
          const xl = pts[0][0], xr = pts[1][0], ye = Y(s.p[0].p), yt = Y(s.p[1].p), ys = Y(s.p[2].p), mx = (xl + xr) / 2;
          if (Math.hypot(px - xr, py - ye) < 9) return { s, h: "right" };
          if (Math.hypot(px - mx, py - yt) < 9) return { s, h: "target" };
          if (Math.hypot(px - mx, py - ys) < 9) return { s, h: "stop" };
          if (px > Math.min(xl, xr) && px < Math.max(xl, xr) && py > Math.min(yt, ys) && py < Math.max(yt, ys)) return { s, h: -1 };
          continue;
        }
        for (let i = 0; i < pts.length && s.type !== "brush"; i++) if (Math.hypot(px - pts[i][0], py - pts[i][1]) < 9) return { s, h: i };
        const [a, b] = pts;
        let d = Infinity;
        if (s.type === "hline") d = Math.abs(py - a[1]);
        else if (s.type === "vline") d = Math.abs(px - a[0]);
        else if (s.type === "trend" || s.type === "fib" || s.type === "channel") d = distSeg(px, py, a[0], a[1], b[0], b[1]);
        else if (s.type === "ray") d = distSeg(px, py, a[0], a[1], b[0] > a[0] ? PW : b[0], b[0] > a[0] ? a[1] + (b[1] - a[1]) * ((PW - a[0]) / ((b[0] - a[0]) || 1)) : b[1]);
        else if (s.type === "rect" || s.type === "range" || s.type === "fib") d = px > Math.min(a[0], b[0]) && px < Math.max(a[0], b[0]) && py > Math.min(a[1], b[1]) && py < Math.max(a[1], b[1]) ? 0 : Infinity;
        else if (s.type === "brush") for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
        else if (s.type === "text") d = px > a[0] - 6 && px < a[0] + 8 + (s.text || "Note").length * 8 && Math.abs(py - a[1]) < 12 ? 0 : Infinity;
        if (s.type === "fib" && d > 6) { const p1 = s.p[0].p, p2 = s.p[1].p; FIB.forEach(([lv]) => { d = Math.min(d, Math.abs(py - Y(p2 + (p1 - p2) * lv)) + (px < Math.min(a[0], b[0]) ? 99 : 0)); }); }
        if (d < 7) return { s, h: -1 };
        if (px > PW || py > PH) continue;
      }
      return null;
    }

    // ── pointer handling: capture phase, so drawing doesn't also pan the chart ──
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const inPane = (x, y) => { const { w, h } = pane(); return x >= 0 && y >= 0 && x <= w && y <= h; };
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    let pendingClick = null; // click-click mode for two-point tools

    function finishDraft() {
      if (!draft) return;
      snapshot(); shapes.push(draft); sel = draft.id; draft = null; pendingClick = null;
      save(); setTool("cursor"); renderOpts();
    }
    function newShape(type, pt) {
      const base = { id: uid(), type, color, width, p: [pt, { ...pt }] };
      if (type === "hline" || type === "vline" || type === "text") base.p = [pt];
      if (type === "long" || type === "short") {
        const l = timeToLogical(pt.t), dir = type === "long" ? 1 : -1;
        base.p = [pt, { t: logicalToTime(l + 24), p: pt.p * (1 + 0.04 * dir) }, { t: pt.t, p: pt.p * (1 - 0.02 * dir) }];
      }
      if (type === "brush") base.p = [pt];
      return base;
    }

    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".pcd-strip, .pcd-opts, .pc-bar")) return;
      const [x, y] = pos(e);
      if (!inPane(x, y)) return;
      if (tool !== "cursor") {
        block(e);
        const pt = toPt(x, y); if (!pt) return;
        if (draft && pendingClick) { // second click of a click-click drawing
          if (draft.type === "channel" && draft.p.length === 2) { draft.p[1] = pt; draft.p.push({ ...pt }); pendingClick = "width"; return; }
          if (pendingClick === "width") { finishDraft(); return; }
          draft.p[1] = pt; finishDraft(); return;
        }
        if (["hline", "vline", "text", "long", "short"].includes(tool)) {
          draft = newShape(tool, pt);
          if (tool === "text") { const t = prompt("Note text:", ""); if (!t) { draft = null; return; } draft.text = t.slice(0, 80); }
          finishDraft(); return;
        }
        draft = newShape(tool, pt);
        drag = { mode: "create", x, y };
        stage.setPointerCapture?.(e.pointerId);
        return;
      }
      if (locked) return;
      const h = hit(x, y);
      if (h) {
        block(e);
        sel = h.s.id; renderOpts(); snapshot();
        drag = { mode: "move", s: h.s, h: h.h, start: toPt(x, y) || { t: 0, p: 0 }, orig: JSON.parse(JSON.stringify(h.s.p)), x, y, moved: false };
        stage.setPointerCapture?.(e.pointerId);
      } else if (sel) { sel = null; renderOpts(); }
    }, true);

    stage.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      if (tool !== "cursor" || drag) block(e);
      if (drag?.mode === "create" && draft) {
        const pt = toPt(x, y); if (!pt) return;
        if (draft.type === "brush") { if (Math.hypot(x - drag.x, y - drag.y) > 3) { draft.p.push(pt); drag.x = x; drag.y = y; } }
        else draft.p[1] = pt;
        return;
      }
      if (draft && pendingClick) { // preview the second point / channel width
        const pt = toPt(x, y); if (!pt) return;
        if (pendingClick === "width") draft.p[2] = pt; else draft.p[1] = pt;
        return;
      }
      if (drag?.mode === "move") {
        const pt = toPt(x, y); if (!pt) return;
        drag.moved = true;
        const s = drag.s, dl = timeToLogical(pt.t) - timeToLogical(drag.start.t), dp = pt.p - drag.start.p;
        if (s.type === "long" || s.type === "short") {
          if (drag.h === "right") s.p[1].t = pt.t;
          else if (drag.h === "target") s.p[1].p = pt.p;
          else if (drag.h === "stop") s.p[2].p = pt.p;
          else s.p = drag.orig.map((q, i) => ({ t: i === 2 ? logicalToTime(timeToLogical(q.t) + dl) : logicalToTime(timeToLogical(q.t) + dl), p: q.p + dp }));
        } else if (drag.h >= 0) s.p[drag.h] = pt;
        else s.p = drag.orig.map((q) => ({ t: logicalToTime(timeToLogical(q.t) + dl), p: q.p + dp }));
        return;
      }
      if (tool === "cursor" && !locked) { const h = hit(x, y); hover = h ? h.s.id : null; stage.style.cursor = h ? (h.h === -1 ? "move" : "pointer") : ""; }
    }, true);

    stage.addEventListener("pointerup", (e) => {
      if (!drag) return;
      block(e);
      const [x, y] = pos(e);
      if (drag.mode === "create" && draft) {
        if (draft.type === "brush") { if (draft.p.length > 2) finishDraft(); else draft = null; }
        else if (Math.hypot(x - drag.x, y - drag.y) < 5) pendingClick = "second"; // it was a click: wait for the second click
        else if (draft.type === "channel") { draft.p.push({ ...draft.p[1] }); pendingClick = "width"; }
        else finishDraft();
      } else if (drag.mode === "move") { if (!drag.moved) undo.pop(); save(); }
      drag = null;
    }, true);
    stage.addEventListener("dblclick", (e) => {
      const [x, y] = pos(e), h = tool === "cursor" ? hit(x, y) : null;
      if (h?.s.type === "text") { block(e); const t = prompt("Note text:", h.s.text || ""); if (t != null) { snapshot(); h.s.text = t.slice(0, 80); save(); } }
    }, true);

    function setTool(t) {
      tool = t; draft = null; pendingClick = null; drag = null;
      strip.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
      chart.applyOptions({ handleScroll: t === "cursor" ? { vertTouchDrag: false } : false, handleScale: t === "cursor" });
      stage.classList.toggle("pcd-drawing", t !== "cursor");
      if (t !== "cursor") sel = null;
      renderOpts();
    }
    strip.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.tool) return setTool(b.dataset.tool === tool && tool !== "cursor" ? "cursor" : b.dataset.tool);
      const o = b.dataset.opt;
      if (o === "magnet") { magnet = !magnet; b.classList.toggle("on", magnet); }
      if (o === "lock") { locked = !locked; b.classList.toggle("on", locked); sel = null; renderOpts(); }
      if (o === "hide") { hidden = !hidden; b.classList.toggle("on", hidden); }
      if (o === "undo") doUndo();
      if (o === "clear" && shapes.length && confirm("Remove every drawing on this chart?")) { snapshot(); shapes = []; sel = null; save(); renderOpts(); }
    });
    opts.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const s = shapes.find((x) => x.id === sel);
      if (b.dataset.color) { if (s) { snapshot(); s.color = b.dataset.color; save(); } else color = b.dataset.color; }
      if (b.dataset.width) { if (s) { snapshot(); s.width = +b.dataset.width; save(); } else width = +b.dataset.width; }
      if (b.dataset.act === "delete" && s) { snapshot(); shapes = shapes.filter((x) => x !== s); sel = null; save(); }
      if (b.dataset.act === "alert" && s) onAlert?.(s.p[0].p);
      if (b.dataset.act === "edit" && s) { const t = prompt("Note text:", s.text || ""); if (t != null) { snapshot(); s.text = t.slice(0, 80); save(); } }
      renderOpts();
    });
    function doUndo() { const last = undo.pop(); if (last != null) { shapes = JSON.parse(last); sel = null; save(); renderOpts(); } }
    const onKey = (e) => {
      if (!stage.isConnected || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); snapshot(); shapes = shapes.filter((x) => x.id !== sel); sel = null; save(); renderOpts(); }
      if (e.key === "Escape" && (tool !== "cursor" || draft)) { e.stopImmediatePropagation(); setTool("cursor"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); doUndo(); }
    };
    document.addEventListener("keydown", onKey, true);
    renderOpts();
    return { destroy() { cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey, true); strip.remove(); opts.remove(); canvas.remove(); }, count: () => shapes.length };
  }

  window.PCDraw = { attach };
})();

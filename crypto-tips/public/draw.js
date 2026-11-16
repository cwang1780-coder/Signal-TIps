// Price chart with drawing tools: pen, trend line, price level, arrow, note, eraser, undo.
// Drawings are anchored to (time, price), so they stay put when prices update or the timeframe changes.
// Saved per coin in this browser.
(function () {
  const COLORS = ["#facc15", "#22d3ee", "#f472b6", "#16c784", "#ea3943", "#ffffff"];
  const TOOLS = [
    ["view", "👆", "Look (no drawing)"],
    ["pen", "✏️", "Pen: draw freely"],
    ["line", "╱", "Trend line: drag from one point to another"],
    ["level", "―", "Price level: tap to mark support or resistance"],
    ["arrow", "➚", "Arrow: drag to point at something"],
    ["note", "T", "Note: tap where you want to write"],
    ["erase", "🧽", "Eraser: tap a drawing to delete it"],
  ];
  const PAD = { l: 8, r: 72, t: 12, b: 22 };

  let tool = "view", color = COLORS[0];
  let sym = null, candles = [], canvas = null, wrap = null, drawings = [], history = [];
  let active = null;     // drawing in progress
  let noteOpen = false;  // note input showing
  let hover = null;      // {x,y} for crosshair
  let view = null;       // scales for current paint

  const key = (s) => "drawings:" + s;
  const load = (s) => { try { return JSON.parse(localStorage.getItem(key(s))) || []; } catch { return []; } };
  const persist = () => { try { localStorage.setItem(key(sym), JSON.stringify(drawings)); } catch {} };
  const snapshot = () => { history.push(JSON.stringify(drawings)); if (history.length > 50) history.shift(); };
  const fmtP = (p) => "$" + (p >= 1 ? p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.toPrecision(4));

  function scales() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const closes = candles.map((c) => c.close);
    const s50 = Indicators.sma(closes, 50), s200 = Indicators.sma(closes, 200);
    const prices = closes.concat(s50, s200).filter((v) => v != null);
    let min = Math.min(...prices), max = Math.max(...prices);
    const padP = (max - min) * 0.06 || max * 0.01;
    min -= padP; max += padP;
    const t0 = candles[0].time, t1 = candles[candles.length - 1].time;
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    return {
      W, H, closes, s50, s200, min, max, t0, t1,
      x: (t) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * iw,
      y: (p) => PAD.t + (1 - (p - min) / (max - min || 1)) * ih,
      t: (x) => t0 + ((x - PAD.l) / iw) * (t1 - t0),
      p: (y) => min + (1 - (y - PAD.t) / ih) * (max - min),
    };
  }

  function paint() {
    if (!canvas || !candles.length) return;
    const dpr = window.devicePixelRatio || 1;
    const s = (view = scales());
    canvas.width = s.W * dpr; canvas.height = s.H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.W, s.H);

    // grid + price axis
    ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const p = s.min + ((s.max - s.min) * i) / 4, y = s.y(p);
      ctx.strokeStyle = "#24304a"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(s.W - PAD.r, y); ctx.stroke();
      ctx.fillStyle = "#8a98b3"; ctx.fillText(fmtP(p), s.W - PAD.r + 6, y);
    }
    // date labels
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i <= 3; i++) {
      const t = s.t0 + ((s.t1 - s.t0) * i) / 3;
      const label = new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      ctx.fillStyle = "#8a98b3";
      ctx.textAlign = i === 0 ? "left" : i === 3 ? "right" : "center";
      ctx.fillText(label, s.x(t), s.H - 6);
    }
    ctx.textAlign = "left";

    const series = (arr, col, w) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = w;
      let started = false;
      arr.forEach((v, i) => { if (v == null) return; const X = s.x(candles[i].time), Y = s.y(v); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; });
      ctx.stroke();
    };
    series(s.s200, "#f59e0b", 1.5); series(s.s50, "#3b82f6", 1.5); series(s.closes, "#e6ecf5", 2);

    // last price tag
    const last = s.closes[s.closes.length - 1];
    tag(ctx, s, last, "#3b82f6");

    for (const d of drawings) drawShape(ctx, s, d);
    if (active) drawShape(ctx, s, active);

    // crosshair while a drawing tool is selected
    if (hover && tool !== "view") {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = "#8a98b388"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, hover.y); ctx.lineTo(s.W - PAD.r, hover.y); ctx.moveTo(hover.x, PAD.t); ctx.lineTo(hover.x, s.H - PAD.b); ctx.stroke();
      ctx.setLineDash([]);
      tag(ctx, s, s.p(hover.y), "#4b5563");
    }
  }

  function tag(ctx, s, price, bg) {
    const y = Math.min(Math.max(s.y(price), PAD.t), s.H - PAD.b);
    ctx.fillStyle = bg; ctx.fillRect(s.W - PAD.r + 2, y - 9, PAD.r - 4, 18);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(fmtP(price), s.W - PAD.r + 6, y);
  }

  function drawShape(ctx, s, d) {
    const P = d.pts.map((q) => ({ x: s.x(q.t), y: s.y(q.p) }));
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (d.type === "pen" || d.type === "line" || d.type === "arrow") {
      ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
      if (d.type === "arrow" && P.length === 2) {
        const [a, b] = P, ang = Math.atan2(b.y - a.y, b.x - a.x), L = 12;
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45));
        ctx.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
      }
      if (d.type === "line" && P.length === 2) for (const q of P) { ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 7); ctx.fill(); }
    } else if (d.type === "level") {
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, P[0].y); ctx.lineTo(s.W - PAD.r, P[0].y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillRect(s.W - PAD.r + 2, P[0].y - 9, PAD.r - 4, 18);
      ctx.fillStyle = "#000"; ctx.textBaseline = "middle"; ctx.fillText(fmtP(d.pts[0].p), s.W - PAD.r + 6, P[0].y);
    } else if (d.type === "note") {
      ctx.font = "600 13px system-ui, sans-serif"; ctx.textBaseline = "middle";
      const w = ctx.measureText(d.text).width + 12;
      ctx.globalAlpha = 0.9; ctx.fillStyle = "#0b0f17"; ctx.fillRect(P[0].x - 2, P[0].y - 11, w, 22); ctx.globalAlpha = 1;
      ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.strokeRect(P[0].x - 2, P[0].y - 11, w, 22);
      ctx.fillStyle = d.color; ctx.fillText(d.text, P[0].x + 4, P[0].y);
      ctx.font = "11px system-ui, sans-serif";
    }
  }

  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function hitTest(pt) {
    const s = view;
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i], P = d.pts.map((q) => ({ x: s.x(q.t), y: s.y(q.p) }));
      if (d.type === "level" && Math.abs(pt.y - P[0].y) < 8) return i;
      if (d.type === "note" && pt.x >= P[0].x - 4 && pt.x <= P[0].x + 12 + d.text.length * 8 && Math.abs(pt.y - P[0].y) < 13) return i;
      for (let j = 1; j < P.length; j++) if (distToSeg(pt, P[j - 1], P[j]) < 9) return i;
      if (P.length === 1 && Math.hypot(pt.x - P[0].x, pt.y - P[0].y) < 9) return i;
    }
    return -1;
  }

  const point = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const anchor = (pt) => ({ t: view.t(pt.x), p: view.p(pt.y) });

  function onDown(e) {
    if (tool === "view" || noteOpen) return;
    e.preventDefault();
    const pt = point(e);
    if (tool === "erase") {
      const i = hitTest(pt);
      if (i >= 0) { snapshot(); drawings.splice(i, 1); persist(); paint(); renderList(); }
      return;
    }
    if (tool === "level") { snapshot(); drawings.push({ id: Date.now().toString(36), type: "level", color, pts: [anchor(pt)] }); persist(); paint(); renderList(); return; }
    if (tool === "note") return openNote(pt);
    canvas.setPointerCapture(e.pointerId);
    active = { id: Date.now().toString(36), type: tool, color, pts: [anchor(pt)], _last: pt };
    if (tool !== "pen") active.pts.push(anchor(pt));
  }

  function onMove(e) {
    const pt = point(e);
    hover = e.pointerType === "mouse" ? pt : null;
    if (active) {
      e.preventDefault();
      if (active.type === "pen") {
        if (Math.hypot(pt.x - active._last.x, pt.y - active._last.y) >= 2) { active.pts.push(anchor(pt)); active._last = pt; }
      } else active.pts[1] = anchor(pt);
    }
    if (active || tool !== "view") paint();
  }

  function onUp() {
    if (!active) return;
    const d = active; active = null; delete d._last;
    const a = { x: view.x(d.pts[0].t), y: view.y(d.pts[0].p) }, b = { x: view.x(d.pts[d.pts.length - 1].t), y: view.y(d.pts[d.pts.length - 1].p) };
    if (d.type === "pen" ? d.pts.length > 1 : Math.hypot(a.x - b.x, a.y - b.y) > 5) {
      snapshot(); drawings.push(d); persist(); renderList();
    }
    paint();
  }

  function openNote(pt) {
    noteOpen = true;
    const input = document.createElement("input");
    input.className = "noteInput"; input.maxLength = 60; input.placeholder = "Type a note, then Enter";
    input.style.left = Math.min(pt.x, canvas.clientWidth - 200) + "px"; input.style.top = pt.y - 14 + "px";
    wrap.querySelector(".chartBox").appendChild(input);
    input.focus();
    const at = anchor(pt);
    const close = (save) => {
      if (!noteOpen) return;
      noteOpen = false;
      const text = input.value.trim();
      input.remove();
      if (save && text) { snapshot(); drawings.push({ id: Date.now().toString(36), type: "note", color, pts: [at], text }); persist(); renderList(); }
      paint();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(true); if (e.key === "Escape") close(false); });
    input.addEventListener("blur", () => close(true));
  }

  function renderList() {
    const el = wrap.querySelector(".drawList");
    const levels = drawings.filter((d) => d.type === "level");
    const last = candles[candles.length - 1]?.close;
    el.innerHTML = levels.length
      ? `<span class="muted">Your levels:</span> ` + levels.map((d) => {
          const p = d.pts[0].p, above = p > last;
          return `<span class="lvl"><i style="background:${d.color}"></i>${fmtP(p)} <span class="muted">(${above ? "+" : ""}${(((p - last) / last) * 100).toFixed(1)}%)</span>
            ${window.hasAlert?.(sym, +p.toPrecision(6)) ? `<button disabled>✅ Alert set</button>` : `<button data-alert="${d.id}" title="Get an alert when the price ${above ? "rises to" : "falls to"} this level">🔔 Alert</button>`}</span>`;
        }).join("")
      : drawings.length ? "" : `<span class="muted">Tip: pick ― and tap the chart to mark a price level. You can turn any level into an alert.</span>`;
  }

  function setTool(t) {
    tool = t;
    canvas.style.touchAction = t === "view" ? "auto" : "none"; // let the page scroll in Look mode
    canvas.style.cursor = t === "view" ? "default" : t === "erase" ? "pointer" : "crosshair";
    wrap.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
    hover = null; paint();
  }

  function mount(container, symbol, data) {
    if (symbol !== sym) { drawings = load(symbol); history = []; }
    sym = symbol; candles = data; wrap = container;
    container.innerHTML = `
      <div class="drawBar">
        ${TOOLS.map(([id, icon, title]) => `<button data-tool="${id}" title="${title}" aria-label="${title}">${icon}</button>`).join("")}
        <span class="sep"></span>
        ${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" title="Colour" aria-label="Colour ${c}"></button>`).join("")}
        <span class="sep"></span>
        <button data-act="undo" title="Undo">↶ Undo</button>
        <button data-act="clear" title="Delete all drawings on this coin">Clear</button>
      </div>
      <div class="chartBox"><canvas></canvas></div>
      <div class="drawList"></div>`;
    canvas = container.querySelector("canvas");
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", () => { hover = null; if (!active) paint(); });
    container.querySelector(".drawBar").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.color) { color = b.dataset.color; container.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === b)); if (tool === "view" || tool === "erase") setTool("pen"); }
      if (b.dataset.act === "undo" && history.length) { drawings = JSON.parse(history.pop()); persist(); paint(); renderList(); }
      if (b.dataset.act === "clear" && drawings.length) {
        if (b.dataset.confirm) { snapshot(); drawings = []; persist(); paint(); renderList(); delete b.dataset.confirm; b.textContent = "Clear"; }
        else { b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; setTimeout(() => { delete b.dataset.confirm; b.textContent = "Clear"; }, 3000); }
      }
    });
    container.querySelector(".drawList").addEventListener("click", (e) => {
      const id = e.target.dataset.alert; if (!id) return;
      const d = drawings.find((x) => x.id === id); if (!d) return;
      const p = +d.pts[0].p.toPrecision(6), above = p > candles[candles.length - 1].close;
      if (window.addAlert?.(sym, above ? "above" : "below", p)) { e.target.textContent = "✅ Alert set"; e.target.disabled = true; }
    });
    container.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x.dataset.color === color));
    setTool(tool);
    renderList();
  }

  window.Draw = { mount, isBusy: () => Boolean(active || noteOpen), currentSym: () => sym };
})();

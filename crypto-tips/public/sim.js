// Trading simulator: a mini game in the Learn tab. Practice with pretend money on made-up markets
// shaped like situations that really happen (rallies, crashes, pump-and-dumps, chop...).
// Each play is a fresh random market, so you can't memorise it. Uses globals from app.js: store.
(function () {
  const root = document.getElementById("simGame");
  if (!root) return;
  const DAYS = 60, START = 1000, FEE = 0.005;

  // Each scenario: segments of [days, drift per day, daily swing], and headlines on certain days.
  const SCENARIOS = {
    bull: { name: "The bull run", icon: "🐂", hint: "A coin in a steady uptrend, with a scary dip along the way.",
      segs: [[20, 0.009, 0.022], [8, -0.018, 0.03], [32, 0.011, 0.024]],
      news: { 21: "📉 Price drops sharply. Social posts: \"It's over, sell everything!\"", 35: "📈 New all-time high. Big funds are buying." },
      lesson: "Dips inside an uptrend are normal. Selling in a panic at the first dip often means missing the rest of the climb. A plan (for example \"I sell if it closes below X\") beats reacting to scary posts." },
    crash: { name: "The crash", icon: "💥", hint: "Things look calm… until they don't.",
      segs: [[24, 0.003, 0.018], [5, -0.08, 0.035], [31, -0.004, 0.035]],
      news: { 24: "🚨 Breaking: a major exchange has been hacked. Withdrawals paused.", 32: "🙏 Influencer: \"Buy the dip, it always comes back!\"" },
      lesson: "Crashes happen fast. A stop-loss (an automatic sell if the price falls a set amount) limits the damage. \"Buy the dip\" only works if the dip ends, and after a real crash it often keeps sliding." },
    pump: { name: "The pump and dump", icon: "🎢", hint: "A quiet coin suddenly gets very popular online.",
      segs: [[15, 0.001, 0.02], [7, 0.075, 0.05], [4, -0.02, 0.07], [34, -0.035, 0.05]],
      news: { 15: "🔥 Trending! Influencer: \"This coin is going 100x, don't miss out!\"", 21: "🚀 Everyone you know is talking about it. Up 60% this week!", 26: "👀 Early buyers are quietly selling." },
      lesson: "When everyone is shouting about a coin, the early buyers are usually selling to the late ones. Chasing hype after a big run-up is how most beginners lose money. If you do play it, take profits on the way up." },
    chop: { name: "Sideways chop", icon: "〰️", hint: "A market that can't make up its mind.",
      segs: [[60, 0, 0.032]], revert: 0.15,
      news: { 12: "📈 Up 3 days in a row! Breakout coming?", 30: "📉 Down 3 days in a row. Breakdown coming?", 45: "🤷 Analysts disagree on what's next." },
      lesson: "In a sideways market, buying every rise and selling every dip loses money, and every trade costs a fee. Sometimes the best move is to do nothing until there's a clear trend." },
    vshape: { name: "The fake-out", icon: "🪃", hint: "Fear everywhere. Is this the bottom?",
      segs: [[18, -0.012, 0.028], [7, -0.03, 0.04], [35, 0.014, 0.028]],
      news: { 24: "😱 Market mood: Extreme Fear. Headlines say crypto is dead.", 33: "🤔 Price is up 20% from the low. Too late to get in?" },
      lesson: "Selling at the moment of maximum fear often means selling at the bottom. Nobody can pick the exact bottom, but buying in small pieces over time (instead of all at once) reduces the risk of bad timing." },
    bleed: { name: "The slow bleed", icon: "🩸", hint: "A coin that keeps getting cheaper.",
      segs: [[60, -0.009, 0.024]],
      news: { 15: "💸 It's 20% cheaper than last month. Bargain?", 30: "📈 Bounce! Up 8% today.", 45: "🙃 Holders: \"I'll sell when it gets back to what I paid.\"" },
      lesson: "\"Cheap\" can always get cheaper. Buying more of a falling coin to lower your average (averaging down) can turn a small loss into a big one. A falling trend is a reason to wait, not a discount." },
  };

  // Seeded random numbers so a market stays the same while you play it.
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

  function makeMarket(id, seed) {
    const sc = SCENARIOS[id], r = rng(seed), out = [];
    let p = 20 + r() * 80;
    const anchor = p;
    for (const [n, drift, vol] of sc.segs) for (let i = 0; i < n; i++) {
      let ret = drift + vol * gauss(r) * 0.8;
      if (sc.revert) ret += sc.revert * Math.log(anchor / p) * 0.3;
      const open = p; p = Math.max(0.01, p * (1 + ret));
      out.push({ open, close: p, high: Math.max(open, p) * (1 + r() * vol * 0.6), low: Math.min(open, p) * (1 - r() * vol * 0.6) });
    }
    return out;
  }

  const fmt$ = (n) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  let g = null, timer = null;
  const best = () => { try { return store.get("simBest", {}); } catch { return {}; } };

  function newGame(choice) {
    const ids = Object.keys(SCENARIOS), id = choice === "random" ? ids[Math.floor(Math.random() * ids.length)] : choice;
    g = { id, mystery: choice === "random", seed: (Math.random() * 1e9) | 0, day: 5, cash: START, coins: 0, stop: null, trades: [], fees: 0, news: [], over: false, speed: 900 };
    g.market = makeMarket(id, g.seed);
    render(); play();
  }

  const price = () => g.market[g.day].close;
  const worth = () => g.cash + g.coins * price();

  function trade(kind, frac) {
    if (!g || g.over) return;
    const px = price();
    if (kind === "buy" && g.cash > 0.01) {
      const spend = g.cash * frac, fee = spend * FEE;
      g.coins += (spend - fee) / px; g.cash -= spend; g.fees += fee;
      g.trades.push({ day: g.day, kind, px });
    } else if (kind === "sell" && g.coins > 0) {
      const qty = g.coins * frac, got = qty * px, fee = got * FEE;
      g.coins -= qty; g.cash += got - fee; g.fees += fee;
      g.trades.push({ day: g.day, kind, px });
      if (g.coins < 1e-9) { g.coins = 0; g.stop = null; }
    }
    render();
  }

  function step() {
    if (!g || g.over) return;
    g.day++;
    const c = g.market[g.day], sc = SCENARIOS[g.id];
    if (g.stop && g.coins > 0 && c.low <= g.stop) {
      const px = Math.min(g.stop, c.open), got = g.coins * px, fee = got * FEE;
      g.cash += got - fee; g.fees += fee; g.coins = 0;
      g.trades.push({ day: g.day, kind: "sell", px, stop: true });
      g.news.unshift({ day: g.day, text: `🛑 Your stop-loss sold everything at ${fmt$(px)}.` });
      g.stop = null;
    }
    if (sc.news[g.day]) g.news.unshift({ day: g.day, text: sc.news[g.day], headline: true });
    if (g.day >= DAYS - 1) finish();
    render();
  }

  function play() { clearInterval(timer); if (g && !g.over) { g.paused = false; timer = setInterval(step, g.speed); } }
  function pause() { clearInterval(timer); if (g) g.paused = true; render(); }

  function finish() {
    clearInterval(timer);
    g.over = true;
    const final = worth(), you = final / START - 1, hold = g.market[DAYS - 1].close / g.market[5].close - 1;
    const stars = (you > 0 ? 1 : 0) + (you >= hold - 0.001 ? 1 : 0) + (you > 0 && g.trades.length <= 6 ? 1 : 0);
    g.result = { final, you, hold, stars };
    const b = best();
    if (b[g.id] == null || you > b[g.id]) { b[g.id] = you; store.set("simBest", b); }
  }

  function drawChart() {
    const cv = root.querySelector("canvas");
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const shown = g.market.slice(0, g.day + 1), all = g.over ? g.market : shown;
    const hi = Math.max(...all.map((c) => c.high), g.stop || 0), lo = Math.min(...all.map((c) => c.low), g.stop || Infinity);
    const pad = 14, X = (i) => pad + (i / (DAYS - 1)) * (W - pad * 2 - 56), Y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - pad * 2);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1; ctx.fillStyle = "#8a919e"; ctx.font = "11px Inter, sans-serif";
    for (let k = 0; k <= 3; k++) { const v = lo + ((hi - lo) * k) / 3, y = Y(v); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 56, y); ctx.stroke(); ctx.fillText(fmt$(v), W - 52, y + 4); }
    const cw = Math.max(2, (W - pad * 2 - 56) / DAYS * 0.6);
    shown.forEach((c, i) => {
      const up = c.close >= c.open; ctx.strokeStyle = ctx.fillStyle = up ? "#098551" : "#cf202f";
      ctx.beginPath(); ctx.moveTo(X(i), Y(c.high)); ctx.lineTo(X(i), Y(c.low)); ctx.stroke();
      const y1 = Y(Math.max(c.open, c.close)), y2 = Y(Math.min(c.open, c.close));
      ctx.fillRect(X(i) - cw / 2, y1, cw, Math.max(1, y2 - y1));
    });
    if (g.stop) { ctx.setLineDash([5, 4]); ctx.strokeStyle = "#cf202f"; ctx.beginPath(); ctx.moveTo(pad, Y(g.stop)); ctx.lineTo(W - 56, Y(g.stop)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#cf202f"; ctx.fillText("stop", pad + 2, Y(g.stop) - 4); }
    ctx.font = "bold 13px Inter, sans-serif";
    for (const t of g.trades) { ctx.fillStyle = t.kind === "buy" ? "#0052ff" : "#0a0b0d"; ctx.fillText(t.kind === "buy" ? "▲" : "▼", X(t.day) - 5, t.kind === "buy" ? Y(g.market[t.day].low) + 16 : Y(g.market[t.day].high) - 6); }
  }

  function render() {
    const b = best(), sc = g && SCENARIOS[g.id];
    const picker = `<div class="sim-pick">${[["random", "🎲", "Mystery market"], ...Object.entries(SCENARIOS).map(([k, s]) => [k, s.icon, s.name])]
      .map(([k, ic, n]) => `<button data-sim-new="${k}" class="${g && !g.mystery && g.id === k ? "on" : ""}">${ic} ${n}${b[k] != null ? ` <span class="muted">best ${pct(b[k])}</span>` : ""}</button>`).join("")}</div>`;
    if (!g) {
      root.innerHTML = `<div class="sim-intro"><p>Start with <b>$1,000 of pretend money</b> and trade a made-up coin for 60 days. Every market is new and random, but shaped like something that really happens. Headlines pop up along the way, just like real life. Try to beat simply buying and holding.</p>${picker}</div>`;
      return;
    }
    const total = worth(), chg = total / START - 1, invested = g.coins * price();
    const res = g.result;
    root.innerHTML = `${picker}
      <div class="sim-head"><b>${g.mystery && !g.over ? "🎲 Mystery market" : sc.icon + " " + sc.name}</b><span class="muted">${g.mystery && !g.over ? "What kind of market is this? You'll find out at the end." : sc.hint}</span></div>
      <div class="sim-stats">
        <div><span class="muted">Day</span><b>${g.day - 4} / ${DAYS - 5}</b></div>
        <div><span class="muted">Coin price</span><b>${fmt$(price())}</b></div>
        <div><span class="muted">Cash</span><b>${fmt$(g.cash)}</b></div>
        <div><span class="muted">In the coin</span><b>${fmt$(invested)}</b></div>
        <div><span class="muted">Total</span><b class="${chg >= 0 ? "up" : "down"}">${fmt$(total)} <small>${pct(chg)}</small></b></div>
      </div>
      <div class="sim-chart"><canvas aria-label="Price chart of the simulated coin"></canvas></div>
      ${g.news[0] && g.day - g.news[0].day < 6 ? `<div class="sim-news ${g.news[0].headline ? "" : "stop"}">${g.news[0].text}</div>` : `<div class="sim-news empty"></div>`}
      ${g.over ? `<div class="sim-result">
          <div class="stars" aria-label="${res.stars} of 3 stars">${"★".repeat(res.stars)}${"☆".repeat(3 - res.stars)}</div>
          <h3>${g.mystery ? `It was: ${sc.icon} ${sc.name}. ` : ""}You ended with ${fmt$(res.final)} (<span class="${res.you >= 0 ? "up" : "down"}">${pct(res.you)}</span>)</h3>
          <div class="sim-stats">
            <div><span class="muted">You</span><b class="${res.you >= 0 ? "up" : "down"}">${pct(res.you)}</b></div>
            <div><span class="muted">Buy on day 1 and hold</span><b class="${res.hold >= 0 ? "up" : "down"}">${pct(res.hold)}</b></div>
            <div><span class="muted">Do nothing</span><b>+0.0%</b></div>
            <div><span class="muted">Trades · fees paid</span><b>${g.trades.length} · ${fmt$(g.fees)}</b></div>
          </div>
          <p class="sim-lesson"><b>💡 The lesson:</b> ${sc.lesson}</p>
          <p class="muted small">Stars: one for making money, one for beating buy-and-hold, one for doing it in 6 trades or fewer.</p>
          <div class="sim-ctl"><button class="primary" data-sim-new="${g.mystery ? "random" : g.id}">Play again (new market)</button><button data-sim-new="random">🎲 Try a mystery market</button></div>
        </div>`
      : `<div class="sim-ctl">
          <button class="buy" data-sim="buy" data-f="0.25" ${g.cash < 1 ? "disabled" : ""}>Buy 25%</button>
          <button class="buy" data-sim="buy" data-f="1" ${g.cash < 1 ? "disabled" : ""}>Buy with all cash</button>
          <button class="sell" data-sim="sell" data-f="0.5" ${!g.coins ? "disabled" : ""}>Sell half</button>
          <button class="sell" data-sim="sell" data-f="1" ${!g.coins ? "disabled" : ""}>Sell all</button>
          <button data-sim="stop" ${!g.coins ? "disabled" : ""} title="Automatically sell everything if the price falls 10% below today's">${g.stop ? "🛑 Stop-loss at " + fmt$(g.stop) + " (remove)" : "🛑 Set stop-loss −10%"}</button>
          <span class="sim-speed"><button data-sim="${g.paused ? "play" : "pause"}">${g.paused ? "▶ Play" : "⏸ Pause"}</button><button data-sim="next" title="Next day">⏭</button>
<button data-sim="speed" title="Change speed">Speed: ${{ 1400: "slow", 900: "normal", 400: "fast" }[g.speed]}</button></span>
        </div>
        <p class="muted small">Each trade costs a 0.5% fee, like a real exchange. The game pauses when you leave this tab.</p>`}`;
    drawChart();
  }

  root.addEventListener("click", (e) => {
    const n = e.target.closest("[data-sim-new]");
    if (n) return newGame(n.dataset.simNew);
    const a = e.target.closest("button[data-sim]");
    if (!a || !g) return;
    const k = a.dataset.sim;
    if (k === "buy" || k === "sell") trade(k, +a.dataset.f);
    else if (k === "stop") { g.stop = g.stop ? null : price() * 0.9; render(); }
    else if (k === "pause") pause();
    else if (k === "play") { play(); render(); }
    else if (k === "next") { pause(); step(); }
    else if (k === "speed") { g.speed = { 1400: 900, 900: 400, 400: 1400 }[g.speed]; if (!g.paused) play(); render(); }
  });
  window.addEventListener("resize", () => g && drawChart());
  // Pause when the Learn tab isn't showing.
  new MutationObserver(() => { if (g && !g.over && !g.paused && root.closest(".tab")?.hidden) pause(); }).observe(root.closest(".tab"), { attributes: true, attributeFilter: ["hidden"] });
  window.simScenarios = SCENARIOS; window.simMakeMarket = makeMarket; // for tests
  render();
})();

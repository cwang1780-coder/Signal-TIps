// Trading simulator (Learn tab): practise with pretend money, as close to a real exchange as a game can get.
// - Real market mode: a real coin's real daily prices from a random past stretch (coin and dates hidden until the end).
// - Practice scenarios: made-up markets shaped like things that really happen (crash, pump and dump...), with headlines.
// - Each day's candle builds live; buyers pay the ask, sellers get the bid; market orders slip a little and pay the
//   taker fee, limit orders wait for your price and pay the lower maker fee; stop-loss and take-profit orders.
// Uses globals from app.js: store, fetchPage. Icons from icons.js.
(function () {
  const root = document.getElementById("simGame");
  if (!root) return;
  const PLAY = 60, CONTEXT = 25, START = 1000, T = 10;     // trading days, days of history shown first, $, ticks per day
  const FEE = { taker: 0.012, maker: 0.006 };               // a typical starter tier on a real exchange
  const SPEEDS = { slow: 2400, normal: 1500, fast: 700 };   // ms per day
  const REAL_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT", "SHIB", "UNI", "ATOM", "NEAR", "BCH", "XLM"];

  // ── practice scenarios (news keys are trading days, 1-60) ──
  const SCENARIOS = {
    bull: { name: "The bull run", icon: "up", hint: "A coin in a steady uptrend, with a scary dip along the way.",
      segs: [[20, 0.009, 0.022], [8, -0.018, 0.03], [32, 0.011, 0.024]],
      news: { 17: "Price drops sharply. Social posts: \"It's over, sell everything!\"", 31: "New all-time high. Big funds are buying." },
      lesson: "Dips inside an uptrend are normal. Selling in a panic at the first dip often means missing the rest of the climb. A plan (for example \"I sell if it closes below X\") beats reacting to scary posts." },
    crash: { name: "The crash", icon: "zap", hint: "Things looked calm… until they didn't.",
      segs: [[24, 0.003, 0.018], [5, -0.08, 0.035], [31, -0.004, 0.035]],
      news: { 20: "Breaking: a major exchange has been hacked. Withdrawals paused.", 28: "Influencer: \"Buy the dip, it always comes back!\"" },
      lesson: "Crashes happen fast. A stop-loss limits the damage, though in a fast drop it can fill below your price (slippage). \"Buy the dip\" only works if the dip ends, and after a real crash it often keeps sliding." },
    pump: { name: "The pump and dump", icon: "spike", hint: "A quiet coin suddenly got very popular online.",
      segs: [[15, 0.001, 0.02], [7, 0.075, 0.05], [4, -0.02, 0.07], [34, -0.035, 0.05]],
      news: { 11: "Trending! Influencer: \"This coin is going 100x, don't miss out!\"", 17: "Everyone you know is talking about it. Up 60% this week!", 22: "Early buyers are quietly selling." },
      lesson: "When everyone is shouting about a coin, the early buyers are usually selling to the late ones. Chasing hype after a big run-up is how most beginners lose money. If you do play it, a take-profit order locks in gains on the way up." },
    chop: { name: "Sideways chop", icon: "waves", hint: "A market that couldn't make up its mind.",
      segs: [[60, 0, 0.032]], revert: 0.15,
      news: { 8: "Up 3 days in a row! Breakout coming?", 26: "Down 3 days in a row. Breakdown coming?", 41: "Analysts disagree on what's next." },
      lesson: "In a sideways market, buying every rise and selling every dip loses money, and every trade pays a fee and the spread. Limit orders near the bottom and top of the range work better than chasing with market orders, and sometimes the best move is to wait." },
    vshape: { name: "The fake-out", icon: "vshape", hint: "Fear everywhere, right at the bottom.",
      segs: [[18, -0.012, 0.028], [7, -0.03, 0.04], [35, 0.014, 0.028]],
      news: { 20: "Market mood: Extreme Fear. Headlines say crypto is dead.", 29: "Price is up 20% from the low. Too late to get in?" },
      lesson: "Selling at the moment of maximum fear often means selling at the bottom. Nobody can pick the exact bottom, but buying in small pieces over time (instead of all at once) reduces the risk of bad timing." },
    bleed: { name: "The slow bleed", icon: "drop", hint: "A coin that kept getting cheaper.",
      segs: [[60, -0.009, 0.024]],
      news: { 11: "It's 20% cheaper than last month. Bargain?", 26: "Bounce! Up 8% today.", 41: "Holders: \"I'll sell when it gets back to what I paid.\"" },
      lesson: "\"Cheap\" can always get cheaper. Buying more of a falling coin to lower your average (averaging down) can turn a small loss into a big one. A falling trend is a reason to wait, not a discount." },
  };

  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

  // Made-up market: CONTEXT quiet days, then the scenario's 60 days. Volume rises on big moves.
  function makeMarket(id, seed) {
    const sc = SCENARIOS[id], r = rng(seed), out = [];
    let p = 20 + r() * 80;
    const anchor = p, baseVol = 2e5 + r() * 8e5;
    const segs = [[CONTEXT, 0.0005, 0.02], ...sc.segs];
    segs.forEach(([n, drift, vol], si) => { for (let i = 0; i < n; i++) {
      let ret = drift + vol * gauss(r) * 0.8;
      if (sc.revert && si > 0) ret += sc.revert * Math.log(anchor / p) * 0.3;
      const open = p; p = Math.max(0.01, p * (1 + ret));
      out.push({ open, close: p, high: Math.max(open, p) * (1 + r() * vol * 0.6), low: Math.min(open, p) * (1 - r() * vol * 0.6), volume: baseVol * (0.6 + r() * 0.8) * (1 + Math.abs(ret) * 25) / p });
    } });
    return out;
  }

  // Price path inside one day: open → first extreme → second extreme → close, with a little noise.
  function dayPath(c, r) {
    const hiFirst = r() < 0.5, e1 = hiFirst ? c.high : c.low, e2 = hiFirst ? c.low : c.high;
    const t1 = 2 + Math.floor(r() * 3), t2 = 5 + Math.floor(r() * 3), pts = [];
    for (let k = 0; k < T; k++) {
      let v = k <= t1 ? c.open + (e1 - c.open) * (k / t1) : k <= t2 ? e1 + (e2 - e1) * ((k - t1) / (t2 - t1)) : e2 + (c.close - e2) * ((k - t2) / (T - 1 - t2));
      if (k > 0 && k < T - 1 && k !== t1 && k !== t2) v *= 1 + (r() - 0.5) * 0.004;
      pts.push(Math.min(c.high, Math.max(c.low, v)));
    }
    pts[0] = c.open; pts[T - 1] = c.close;
    return pts;
  }

  // Real market: a random coin and a random stretch of its daily history, plus the 30 days after (shown at the end).
  async function loadReal(avoid) {
    const coins = REAL_COINS.filter((c) => c !== avoid);
    for (let attempt = 0; attempt < 4; attempt++) {
      const sym = coins[Math.floor(Math.random() * coins.length)];
      const daysAgo = 150 + Math.floor(Math.random() * 1700);
      const end = Math.floor(Date.now() / 1000 / 86400 - daysAgo) * 86400;
      try {
        const c = await fetchPage(sym, 86400, end);
        const need = CONTEXT + PLAY + 30;
        if (c.length < need) continue;
        const win = c.slice(c.length - need);
        return { sym, candles: win.slice(0, CONTEXT + PLAY), after: win.slice(CONTEXT + PLAY) };
      } catch {}
    }
    throw new Error("Couldn't load real price history right now.");
  }

  const pxf = (n) => n == null ? "–" : "$" + (n >= 1 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toPrecision(4));
  const usd = (n) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  const qtyf = (q) => q >= 1000 ? q.toLocaleString(undefined, { maximumFractionDigits: 0 }) : q >= 1 ? q.toFixed(3) : q.toPrecision(4);
  const best = () => { try { return store.get("simBest", {}); } catch { return {}; } };
  let g = null, timer = null, side = "buy", otype = "market", lastId = null;

  // ── game state ──
  function begin(mode, data) {
    const seed = (Math.random() * 1e9) | 0, r = rng(seed);
    g = { mode, seed, day: CONTEXT, tick: 0, cash: START, coins: 0, cost: 0, realized: 0, fees: 0, orders: [], sl: null, tp: null,
      trades: [], log: [], news: null, over: false, paused: false, speed: "normal", nextId: 1 };
    if (mode === "real") { Object.assign(g, { id: "real", sym: data.sym, market: data.candles, after: data.after, spread: 0.001 }); }
    else { const ids = Object.keys(SCENARIOS).filter((k) => k !== lastId); g.id = ids[Math.floor(Math.random() * ids.length)]; g.market = makeMarket(g.id, seed); g.spread = 0.004; }
    lastId = g.id;
    g.paths = g.market.map((c) => dayPath(c, r));
    layout(); play();
  }
  async function newGame(mode) {
    clearInterval(timer);
    if (mode === "real") {
      root.innerHTML = `<p class="muted" style="padding:20px 0">Loading a real market…</p>`;
      try { begin("real", await loadReal(g?.sym)); }
      catch (e) { root.innerHTML = `<p class="down" style="padding:12px 0">${e.message}</p>${pickerHtml()}`; }
    } else begin("scenario");
  }

  const price = () => g.paths[g.day][g.tick];
  const bid = () => price() * (1 - g.spread / 2), ask = () => price() * (1 + g.spread / 2);
  const reservedCash = () => g.orders.filter((o) => o.side === "buy").reduce((a, o) => a + o.usd, 0);
  const reservedCoins = () => g.orders.filter((o) => o.side === "sell").reduce((a, o) => a + o.qty, 0);
  const freeCash = () => g.cash - reservedCash(), freeCoins = () => g.coins - reservedCoins();
  const worth = () => g.cash + g.coins * bid();
  const tradeDay = () => g.day - CONTEXT + 1;
  const vol = () => { const c = g.market[g.day]; return (c.high - c.low) / c.open; };

  function fill(sideX, qty, px, kind, why) {
    const feeRate = kind === "limit" ? FEE.maker : FEE.taker;
    if (sideX === "buy") {
      const gross = qty * px, fee = gross * feeRate;
      if (gross + fee > g.cash + 1e-9) { qty = g.cash / (px * (1 + feeRate)); }
      const g2 = qty * px, f2 = g2 * feeRate;
      g.cash -= g2 + f2; g.coins += qty; g.cost += g2 + f2; g.fees += f2;
      g.log.unshift({ day: tradeDay(), side: "Buy", kind, qty, px, fee: f2, why });
    } else {
      qty = Math.min(qty, g.coins);
      if (qty <= 0) return;
      const gross = qty * px, fee = gross * feeRate, costPart = g.cost * (qty / g.coins);
      g.cash += gross - fee; g.realized += gross - fee - costPart; g.cost -= costPart; g.coins -= qty; g.fees += fee;
      if (g.coins < 1e-12) { g.coins = 0; g.cost = 0; g.sl = g.tp = null; g.orders = g.orders.filter((o) => o.side !== "sell"); }
      g.log.unshift({ day: tradeDay(), side: "Sell", kind, qty, px, fee, why });
    }
    g.trades.push({ day: g.day, side: sideX });
  }
  const slip = () => 1 + Math.random() * Math.min(0.004, 0.0008 + vol() * 0.03); // bigger in wilder markets

  function placeOrder() {
    const amt = parseFloat(root.querySelector("#tkAmt").value.replace(/[$,]/g, ""));
    const msg = (t) => { root.querySelector("#tkMsg").textContent = t; };
    if (!(amt >= 1)) return msg("Enter an amount of at least $1.");
    if (otype === "market") {
      if (side === "buy") {
        if (amt > freeCash() + 0.005) return msg(`You only have ${usd(freeCash())} free cash.`);
        const px = ask() * slip(), qty = Math.min(amt, freeCash()) / (px * (1 + FEE.taker));
        fill("buy", qty, px, "market");
      } else {
        const qty = Math.min(amt / bid(), freeCoins());
        if (qty <= 0) return msg("You don't have any coins to sell.");
        fill("sell", qty, bid() / slip(), "market");
      }
    } else {
      const lim = parseFloat(root.querySelector("#tkLimit").value.replace(/[$,]/g, ""));
      if (!(lim > 0)) return msg("Enter a limit price.");
      if (side === "buy") {
        if (amt > freeCash() + 0.005) return msg(`You only have ${usd(freeCash())} free cash.`);
        if (lim >= ask()) return msg("That's at or above the current price: use a market order to buy now.");
        g.orders.push({ id: g.nextId++, side: "buy", lim, usd: Math.min(amt, freeCash()), qty: Math.min(amt, freeCash()) / (lim * (1 + FEE.maker)) });
      } else {
        const qty = Math.min(amt / lim, freeCoins());
        if (qty <= 0) return msg("You don't have any coins to sell.");
        if (lim <= bid()) return msg("That's at or below the current price: use a market order to sell now.");
        g.orders.push({ id: g.nextId++, side: "sell", lim, qty });
      }
    }
    root.querySelector("#tkAmt").value = "";
    msg(otype === "market" ? "Filled." : "Order placed. It fills if the price gets there.");
    update();
  }

  // Check open orders against the live price.
  function checkOrders() {
    const p = price();
    for (const o of [...g.orders]) {
      if (o.side === "buy" && p * (1 + g.spread / 2) <= o.lim) { g.orders = g.orders.filter((x) => x !== o); fill("buy", o.qty, Math.min(o.lim, ask()), "limit"); }
      else if (o.side === "sell" && p * (1 - g.spread / 2) >= o.lim && g.coins > 0) { g.orders = g.orders.filter((x) => x !== o); fill("sell", o.qty, Math.max(o.lim, bid()), "limit"); }
    }
    if (g.coins > 0 && g.sl && bid() <= g.sl) {
      const at = Math.min(g.sl, bid()) / slip(); // stops become market orders: in a fast drop you get less than your stop price
      g.orders = g.orders.filter((o) => o.side !== "sell");
      fill("sell", g.coins, at, "market", "stop-loss");
      g.news = { day: tradeDay(), text: `Your stop-loss sold everything at ${pxf(at)}.`, alert: true };
    }
    if (g.coins > 0 && g.tp && bid() >= g.tp) {
      g.orders = g.orders.filter((o) => o.side !== "sell");
      fill("sell", g.coins, g.tp, "limit", "take-profit");
      g.news = { day: tradeDay(), text: `Your take-profit sold everything at ${pxf(g.tp)}.`, good: true };
    }
  }

  function tick() {
    if (!g || g.over) return;
    if (g.tick < T - 1) g.tick++;
    else if (g.day >= CONTEXT + PLAY - 1) return finish();
    else {
      g.day++; g.tick = 0;
      const n = g.mode === "scenario" && SCENARIOS[g.id].news[tradeDay()];
      if (n) g.news = { day: tradeDay(), text: n };
    }
    checkOrders();
    update();
  }
  function play() { clearInterval(timer); if (g && !g.over) { g.paused = false; timer = setInterval(tick, SPEEDS[g.speed] / T); } syncControls(); }
  function pause() { clearInterval(timer); if (g) g.paused = true; syncControls(); }
  function nextDay() { pause(); if (!g || g.over) return; const d = g.day; while (g && !g.over && g.day === d) tick(); }

  function finish() {
    clearInterval(timer);
    g.over = true; g.tick = T - 1;
    const final = worth(), you = final / START - 1, hold = g.market[CONTEXT + PLAY - 1].close / g.market[CONTEXT].open - 1;
    const stars = (you > 0 ? 1 : 0) + (you >= hold - 0.001 ? 1 : 0) + (you > 0 && g.trades.length <= 8 ? 1 : 0);
    g.result = { final, you, hold, stars };
    const b = best();
    if (b[g.id] == null || you > b[g.id]) { b[g.id] = you; store.set("simBest", b); }
    showResult();
  }

  // ── chart ──
  function drawChart() {
    const cv = root.querySelector("canvas");
    if (!cv || !g) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const n = CONTEXT + PLAY, shown = g.market.slice(0, g.day + 1).map((c, i) => {
      if (i < g.day || g.over) return c;
      const path = g.paths[i].slice(0, g.tick + 1);
      return { open: c.open, close: path[path.length - 1], high: Math.max(...path), low: Math.min(...path), volume: c.volume * (g.tick + 1) / T };
    });
    const lines = [...g.orders.map((o) => [o.lim, "#0052ff", (o.side === "buy" ? "Buy " : "Sell ") + "limit"]),
      ...(g.sl ? [[g.sl, "#cf202f", "Stop"]] : []), ...(g.tp ? [[g.tp, "#098551", "Take profit"]] : []), ...(g.coins ? [[g.cost / g.coins, "#8a919e", "Your entry"]] : [])];
    const vals = shown.flatMap((c) => [c.high, c.low]).concat(lines.map((l) => l[0]));
    let hi = Math.max(...vals), lo = Math.min(...vals); const padV = (hi - lo) * 0.06; hi += padV; lo -= padV;
    const R = 64, volH = H * 0.16, top = 10, bot = H - 18 - volH;
    const X = (i) => 8 + ((i + 0.5) / n) * (W - 8 - R), Y = (v) => top + (1 - (v - lo) / (hi - lo || 1)) * (bot - top);
    ctx.font = "11px Inter, sans-serif"; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); ctx.strokeStyle = "#eef0f3"; ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillStyle = "#8a919e"; ctx.fillText(pxf(v), W - R + 6, y + 4); }
    // the days before trading starts
    ctx.fillStyle = "rgba(10,11,13,.035)"; ctx.fillRect(8, top, X(CONTEXT) - 4 - 8, H - 18 - top);
    ctx.strokeStyle = "#c9ced6"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(CONTEXT) - 4, top); ctx.lineTo(X(CONTEXT) - 4, H - 18); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#8a919e"; ctx.fillText("Day 1", X(CONTEXT), H - 4);
    // volume
    const vmax = Math.max(...g.market.slice(0, g.day + 1).map((c) => c.volume || 0)) || 1, cw = Math.max(2, ((W - 8 - R) / n) * 0.62);
    shown.forEach((c, i) => { ctx.fillStyle = c.close >= c.open ? "rgba(9,133,81,.28)" : "rgba(207,32,47,.28)"; const h = ((c.volume || 0) / vmax) * volH; ctx.fillRect(X(i) - cw / 2, H - 18 - h, cw, h); });
    // candles
    shown.forEach((c, i) => {
      ctx.strokeStyle = ctx.fillStyle = c.close >= c.open ? "#098551" : "#cf202f";
      ctx.beginPath(); ctx.moveTo(X(i), Y(c.high)); ctx.lineTo(X(i), Y(c.low)); ctx.stroke();
      const y1 = Y(Math.max(c.open, c.close)), y2 = Y(Math.min(c.open, c.close)); ctx.fillRect(X(i) - cw / 2, y1, cw, Math.max(1, y2 - y1));
    });
    // 20-day average
    ctx.strokeStyle = "#f5a623"; ctx.lineWidth = 1.5; ctx.beginPath(); let started = false;
    shown.forEach((c, i) => { if (i < 19) return; const a = shown.slice(i - 19, i + 1).reduce((s, x) => s + x.close, 0) / 20; started ? ctx.lineTo(X(i), Y(a)) : (ctx.moveTo(X(i), Y(a)), (started = true)); });
    ctx.stroke(); ctx.lineWidth = 1;
    // order and position lines
    for (const [v, col, label] of lines) { ctx.strokeStyle = ctx.fillStyle = col; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(8, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.setLineDash([]); ctx.fillText(label, 12, Y(v) - 4); }
    // live price tag
    if (!g.over) { const p = price(), y = Y(p); ctx.fillStyle = "#0a0b0d"; ctx.fillRect(W - R + 2, y - 9, R - 2, 18); ctx.fillStyle = "#fff"; ctx.fillText(pxf(p), W - R + 6, y + 4); }
    // your trades
    ctx.font = "bold 12px Inter, sans-serif";
    for (const t of g.trades) { const c = shown[t.day]; if (!c) continue; ctx.fillStyle = t.side === "buy" ? "#0052ff" : "#0a0b0d"; ctx.fillText(t.side === "buy" ? "▲" : "▼", X(t.day) - 5, t.side === "buy" ? Y(c.low) + 15 : Y(c.high) - 5); }
  }

  // ── UI ──
  function pickerHtml() {
    const b = best(), seen = Object.keys(SCENARIOS).filter((k) => b[k] != null).length;
    return `<div class="sim-pick">
      <button class="primary" data-sim-new="real">${icon("chart")} Real market</button>
      <button data-sim-new="scenario">${icon("dice")} Practice scenario</button>
      <span class="muted">${b.real != null ? `Best real-market result ${pct(b.real)} · ` : ""}${seen ? `Scenarios found ${seen} of 6` : ""}</span></div>`;
  }

  function layout() {
    root.innerHTML = `${pickerHtml()}
      <div class="sim-head"><b>${g.mode === "real" ? icon("chart") + " Real market: hidden coin, hidden dates" : icon("dice") + " Mystery scenario"}</b>
        <span class="muted">${g.mode === "real" ? "These are real daily prices from a random coin and a random stretch of the past. You'll find out which at the end." : "A made-up coin. What kind of market is this? You'll find out at the end."}</span></div>
      <div class="sim-stats" id="ssStats"></div>
      <div class="sim-grid">
        <div class="sg-chart">
          <div class="sim-chart"><canvas aria-label="Price chart"></canvas></div>
          <div class="sim-news empty" id="ssNews"></div>
          <div class="sim-ctl" id="ssCtl">
            <button data-sim="toggle"></button><button data-sim="next" title="Skip to the next day">Next day ⏭</button><button data-sim="speed"></button>
            <span class="muted small" style="margin-left:auto">Shaded: the ${CONTEXT} days before you start.</span>
          </div>
        </div>
        <div class="sg-info">
          <div class="sim-panels">
            <div class="sim-box"><h4>Your position</h4><div id="ssPos"></div></div>
            <div class="sim-box"><h4>Open orders</h4><div id="ssOrders"></div></div>
          </div>
          <div class="sim-box"><h4>Trade history</h4><div id="ssLog"></div></div>
        </div>
        <div class="sg-ticket">
          <div class="ticket">
            <div class="seg" data-g="side"><button data-side="buy" class="on">Buy</button><button data-side="sell">Sell</button></div>
            <div class="seg small" data-g="type"><button data-type="market" class="on">Market</button><button data-type="limit">Limit</button></div>
            <div class="quote" id="ssQuote"></div>
            <label class="tk-limit" hidden>Limit price<input id="tkLimit" inputmode="decimal" autocomplete="off" /></label>
            <label>Amount in USD<input id="tkAmt" inputmode="decimal" placeholder="0.00" autocomplete="off" /></label>
            <div class="chips"><button data-pct="0.25">25%</button><button data-pct="0.5">50%</button><button data-pct="0.75">75%</button><button data-pct="1">Max</button></div>
            <div class="tk-est muted small" id="tkEst"></div>
            <button class="tk-go buy" id="tkGo">Buy</button>
            <div class="tk-msg small" id="tkMsg" role="status"></div>
          </div>
          <div class="ticket protect">
            <b>Protect your position</b>
            <span class="muted small">Sells everything automatically when the price gets there.</span>
            <label>Stop-loss price<span class="tk-row"><input id="tkSL" inputmode="decimal" autocomplete="off" /><button data-sim="sl"></button></span></label>
            <label>Take-profit price<span class="tk-row"><input id="tkTP" inputmode="decimal" autocomplete="off" /><button data-sim="tp"></button></span></label>
          </div>
          <p class="muted small">Fees: ${FEE.taker * 100}% for market orders (they take liquidity) and ${FEE.maker * 100}% for limit orders, like a real exchange's starter tier. Buyers pay the ask, sellers get the bid; the gap is the spread.</p>
        </div>
      </div>`;
    syncTicket(); syncControls(); update();
  }

  function syncControls() {
    if (!g || g.over) return;
    const t = root.querySelector('[data-sim="toggle"]'), s = root.querySelector('[data-sim="speed"]');
    if (t) t.textContent = g.paused ? "▶ Play" : "Pause";
    if (s) s.textContent = "Speed: " + g.speed;
  }
  function syncTicket() {
    root.querySelectorAll("[data-side]").forEach((b) => b.classList.toggle("on", b.dataset.side === side));
    root.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("on", b.dataset.type === otype));
    const lim = root.querySelector(".tk-limit"); if (lim) lim.hidden = otype !== "limit";
    const go = root.querySelector("#tkGo"); if (go) { go.className = "tk-go " + side; go.textContent = `${otype === "limit" ? "Place limit " : ""}${side === "buy" ? "Buy" : "Sell"}`; }
    if (otype === "limit" && g && !root.querySelector("#tkLimit").value) root.querySelector("#tkLimit").value = (side === "buy" ? bid() * 0.97 : ask() * 1.03).toPrecision(5);
  }

  // Only touch the DOM when the content changed, so taps on buttons inside aren't lost between ticks.
  const put = (sel, html) => { const el = root.querySelector(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } };
  function update() {
    if (!g || !root.querySelector("#ssStats")) return;
    const total = worth(), chg = total / START - 1, p = price(), open = g.paths[g.day][0], dchg = p / open - 1;
    const unreal = g.coins ? g.coins * bid() - g.cost : 0;
    put("#ssStats", `
      <div><span class="muted">Day</span><b>${tradeDay()} / ${PLAY}</b></div>
      <div><span class="muted">Price</span><b>${pxf(p)} <small class="${dchg >= 0 ? "up" : "down"}">${pct(dchg)} today</small></b></div>
      <div><span class="muted">Cash</span><b>${usd(g.cash)}</b></div>
      <div><span class="muted">Account value</span><b class="${chg >= 0 ? "up" : "down"}">${usd(total)} <small>${pct(chg)}</small></b></div>`);
    put("#ssQuote", `<span><span class="muted">Bid (you sell)</span><b class="down">${pxf(bid())}</b></span><span><span class="muted">Ask (you buy)</span><b class="up">${pxf(ask())}</b></span>`);
    put("#ssPos", g.coins ? `
      <div class="kv"><span>Coins</span><b>${qtyf(g.coins)}</b></div>
      <div class="kv"><span>Average entry</span><b>${pxf(g.cost / g.coins)}</b></div>
      <div class="kv"><span>Worth now (at bid)</span><b>${usd(g.coins * bid())}</b></div>
      <div class="kv"><span>Open profit/loss</span><b class="${unreal >= 0 ? "up" : "down"}">${unreal >= 0 ? "+" : "−"}${usd(Math.abs(unreal))} (${pct(unreal / g.cost)})</b></div>
      <div class="kv"><span>Realised so far</span><b class="${g.realized >= 0 ? "up" : "down"}">${g.realized >= 0 ? "+" : "−"}${usd(Math.abs(g.realized))}</b></div>
      <div class="kv"><span>Fees paid</span><b>${usd(g.fees)}</b></div>`
      : `<p class="muted small">No coins yet. ${g.realized ? `Realised: <b class="${g.realized >= 0 ? "up" : "down"}">${g.realized >= 0 ? "+" : "−"}${usd(Math.abs(g.realized))}</b> · ` : ""}Fees paid: ${usd(g.fees)}</p>`);
    const ords = [...g.orders.map((o) => `<li><span>${o.side === "buy" ? "Buy" : "Sell"} limit at ${pxf(o.lim)} · ${o.side === "buy" ? usd(o.usd) : qtyf(o.qty) + " coins"}</span><button class="x" data-cancel="${o.id}" aria-label="Cancel order">✕</button></li>`),
      ...(g.sl ? [`<li><span class="down">Stop-loss at ${pxf(g.sl)}</span><button class="x" data-cancel="sl" aria-label="Cancel stop-loss">✕</button></li>`] : []),
      ...(g.tp ? [`<li><span class="up">Take-profit at ${pxf(g.tp)}</span><button class="x" data-cancel="tp" aria-label="Cancel take-profit">✕</button></li>`] : [])];
    put("#ssOrders", ords.length ? `<ul class="olist">${ords.join("")}</ul>` : `<p class="muted small">None. Limit, stop-loss and take-profit orders show here.</p>`);
    put("#ssLog", g.log.length ? `<div class="tablewrap"><table class="tlog"><tr><th>Day</th><th>Side</th><th>Type</th><th>Coins</th><th>Price</th><th>Fee</th></tr>${g.log.slice(0, 12).map((l) =>
      `<tr><td>${l.day}</td><td class="${l.side === "Buy" ? "up" : "down"}">${l.side}</td><td>${l.why || l.kind}</td><td>${qtyf(l.qty)}</td><td>${pxf(l.px)}</td><td>${usd(l.fee)}</td></tr>`).join("")}</table></div>` : `<p class="muted small">No trades yet.</p>`);
    const nw = root.querySelector("#ssNews");
    if (g.news && tradeDay() - g.news.day < 5) { nw.className = "sim-news" + (g.news.alert ? " stop" : g.news.good ? " good" : ""); nw.textContent = g.news.text; }
    else { nw.className = "sim-news empty"; nw.textContent = ""; }
    // estimate under the ticket
    const amt = parseFloat((root.querySelector("#tkAmt").value || "").replace(/[$,]/g, "")) || 0, rate = otype === "limit" ? FEE.maker : FEE.taker;
    const atPx = otype === "limit" ? parseFloat(root.querySelector("#tkLimit").value) || 0 : side === "buy" ? ask() : bid();
    put("#tkEst", amt && atPx ? `≈ ${qtyf(side === "buy" ? amt / (atPx * (1 + rate)) : amt / atPx)} coins at ${pxf(atPx)}${otype === "market" ? " + slippage" : ""} · fee ${usd(amt * rate)} (${(rate * 100).toFixed(1)}%)`
      : `Available: ${side === "buy" ? usd(freeCash()) + " cash" : qtyf(freeCoins()) + " coins (" + usd(freeCoins() * bid()) + ")"}`);
    const slb = root.querySelector('[data-sim="sl"]'), tpb = root.querySelector('[data-sim="tp"]');
    slb.textContent = g.sl ? "Update" : "Set"; tpb.textContent = g.tp ? "Update" : "Set";
    slb.disabled = tpb.disabled = !g.coins;
    root.querySelector("#tkSL").placeholder = g.coins ? pxf(bid() * 0.9).replace("$", "") : "buy first";
    root.querySelector("#tkTP").placeholder = g.coins ? pxf(ask() * 1.2).replace("$", "") : "buy first";
    drawChart();
  }

  function showResult() {
    const res = g.result, b = best();
    let title, extra, lesson;
    if (g.mode === "real") {
      const d0 = new Date(g.market[CONTEXT].time * 1000), d1 = new Date(g.market[CONTEXT + PLAY - 1].time * 1000), f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const nm = (typeof coinName === "function" && coinName(g.sym)) || g.sym, nextMove = g.after.length ? g.after[g.after.length - 1].close / g.after[0].open - 1 : null;
      title = `It was ${window.coinIcon ? coinIcon(g.sym, 26) : ""} ${nm} (${g.sym}), ${f(d0)} to ${f(d1)}.`;
      extra = nextMove != null ? `In the 30 days after the game ended, ${nm} went <b class="${nextMove >= 0 ? "up" : "down"}">${pct(nextMove)}</b>.` : "";
      lesson = g.log.length > 10 ? `You made ${g.log.length} trades and paid ${usd(g.fees)} in fees, plus the spread each time. On real prices, frequent trading usually loses to fees and noise.`
        : res.hold > 0.2 && res.you < res.hold / 2 ? `The coin rose ${pct(res.hold)} over the period. Getting shaken out of a winner by a scary day is one of the most common mistakes. Real markets rarely move in a straight line, even when the trend is up.`
        : res.hold < -0.15 && res.you > res.hold ? `The coin fell ${(-res.hold * 100).toFixed(1)}%. ${res.you >= 0 ? "You still made money" : "You lost less than holding would have"}: protecting your money in a downtrend counts as a win.`
        : `Real price history is messy: there are no headlines warning you, and patterns only look obvious afterwards. That's why a plan with a stop-loss beats guessing.`;
    } else {
      const sc = SCENARIOS[g.id];
      title = `It was ${icon(sc.icon)} ${sc.name}.`; extra = sc.hint; lesson = sc.lesson;
    }
    const prevBest = b[g.id];
    root.innerHTML = `
      <div class="sim-result">
        <div class="stars" aria-label="${res.stars} of 3 stars">${"★".repeat(res.stars)}${"☆".repeat(3 - res.stars)}</div>
        <h3>${title} You ended with ${usd(res.final)} (<span class="${res.you >= 0 ? "up" : "down"}">${pct(res.you)}</span>)</h3>
        <div class="sim-chart"><canvas aria-label="The whole market"></canvas></div>
        <div class="sim-stats" style="margin-top:10px">
          <div><span class="muted">You</span><b class="${res.you >= 0 ? "up" : "down"}">${pct(res.you)}</b></div>
          <div><span class="muted">Buy on day 1 and hold</span><b class="${res.hold >= 0 ? "up" : "down"}">${pct(res.hold)}</b></div>
          <div><span class="muted">Trades · fees</span><b>${g.log.length} · ${usd(g.fees)}</b></div>
          <div><span class="muted">Your best here</span><b>${prevBest != null ? pct(prevBest) : "–"}</b></div>
        </div>
        ${extra ? `<p style="margin:0 0 10px">${extra}</p>` : ""}
        <p class="sim-lesson"><b>${icon("bulb")} The lesson:</b> ${lesson}</p>
        <p class="muted small">Stars: one for making money, one for beating buy-and-hold, one for doing it in 8 trades or fewer.</p>
      </div>${pickerHtml()}`;
    drawChart();
  }

  // ── events ──
  root.addEventListener("click", (e) => {
    const n = e.target.closest("[data-sim-new]");
    if (n) return newGame(n.dataset.simNew);
    if (!g || g.over) return;
    const sd = e.target.closest("[data-side]"), ty = e.target.closest("[data-type]"), pc = e.target.closest("[data-pct]"), cx = e.target.closest("[data-cancel]");
    if (sd) { side = sd.dataset.side; if (otype === "limit") root.querySelector("#tkLimit").value = ""; syncTicket(); return update(); }
    if (ty) { otype = ty.dataset.type; root.querySelector("#tkLimit").value = ""; syncTicket(); return update(); }
    if (pc) { const f = +pc.dataset.pct; root.querySelector("#tkAmt").value = (side === "buy" ? freeCash() * f : freeCoins() * bid() * f).toFixed(2); return update(); }
    if (cx) { const id = cx.dataset.cancel; if (id === "sl") g.sl = null; else if (id === "tp") g.tp = null; else g.orders = g.orders.filter((o) => String(o.id) !== id); return update(); }
    if (e.target.id === "tkGo") return placeOrder();
    const a = e.target.closest("button[data-sim]");
    if (!a) return;
    const k = a.dataset.sim, msg = (t) => { root.querySelector("#tkMsg").textContent = t; };
    if (k === "toggle") g.paused ? play() : pause();
    else if (k === "next") nextDay();
    else if (k === "speed") { g.speed = { slow: "normal", normal: "fast", fast: "slow" }[g.speed]; if (!g.paused) play(); else syncControls(); }
    else if (k === "sl" || k === "tp") {
      const v = parseFloat(root.querySelector(k === "sl" ? "#tkSL" : "#tkTP").value.replace(/[$,]/g, ""));
      if (!(v > 0)) return msg(`Enter a ${k === "sl" ? "stop-loss" : "take-profit"} price.`);
      if (k === "sl" && v >= bid()) return msg("A stop-loss goes below the current price.");
      if (k === "tp" && v <= ask()) return msg("A take-profit goes above the current price.");
      g[k] = v; root.querySelector(k === "sl" ? "#tkSL" : "#tkTP").value = "";
      msg(k === "sl" ? `Stop-loss set at ${pxf(v)}.` : `Take-profit set at ${pxf(v)}.`); update();
    }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "tkAmt" || e.target.id === "tkLimit") update(); });
  root.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.id === "tkAmt" || e.target.id === "tkLimit")) { e.preventDefault(); placeOrder(); } });
  window.addEventListener("resize", () => g && drawChart());
  // Pause when the Learn tab isn't showing.
  new MutationObserver(() => { if (g && !g.over && !g.paused && root.closest(".tab")?.hidden) pause(); }).observe(root.closest(".tab"), { attributes: true, attributeFilter: ["hidden"] });
  window.simScenarios = SCENARIOS; window.simMakeMarket = makeMarket; // for tests

  root.innerHTML = `<div class="sim-intro"><p>Start with <b>$1,000 of pretend money</b> and trade for 60 days, the way you would on a real exchange: market and limit orders, buy and sell prices, fees, stop-losses and take-profits. Each day's candle builds live.</p>
    <ul class="muted"><li><b>Real market:</b> real prices from a random coin and a random stretch of the past. No hints. Which coin and when is revealed at the end.</li>
    <li><b>Practice scenario:</b> a made-up coin in a situation that really happens, with headlines along the way. Which one is revealed at the end.</li></ul>${pickerHtml()}</div>`;
})();

// Technical indicators + signal scoring. Pure functions, no DOM — works in browser and Node.
(function (root) {
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Wilder's RSI
  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const ef = ema(values, fast), es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const start = line.findIndex((v) => v != null);
    const sig = new Array(values.length).fill(null);
    if (start >= 0) {
      const e = ema(line.slice(start), signal);
      e.forEach((v, j) => (sig[start + j] = v));
    }
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, hist };
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const upper = [], lower = [];
    for (let i = 0; i < values.length; i++) {
      if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
      const win = values.slice(i - period + 1, i + 1);
      const sd = Math.sqrt(win.reduce((a, v) => a + (v - mid[i]) ** 2, 0) / period);
      upper.push(mid[i] + mult * sd);
      lower.push(mid[i] - mult * sd);
    }
    return { mid, upper, lower };
  }

  const last = (arr) => arr[arr.length - 1];
  const prev = (arr) => arr[arr.length - 2];

  // candles: [{time, low, high, open, close, volume}] oldest -> newest
  //
  // Trend-aware scoring. The long-term trend decides how everything else is read:
  // - In an uptrend, dips are buying opportunities and strength is left alone.
  // - In a downtrend, "oversold" is NOT a buy reason (falling prices often keep falling) and bounces are suspect.
  // Chosen after testing on ~4 years of daily data for 10 coins: the older version, which bought every oversold dip,
  // did no better than holding; this one lost about half as much in falling markets. See README → How tips are scored.
  function analyze(candles) {
    const closes = candles.map((c) => c.close);
    const vols = candles.map((c) => c.volume);
    const price = last(closes);
    const reasons = [];
    let score = 0;
    const add = (pts, text) => { score += pts; reasons.push({ pts, text }); };

    const r = last(rsi(closes, 14));
    const s50 = last(sma(closes, 50)), s200 = last(sma(closes, 200));
    const longTerm = s200 ?? s50;
    const change = closes.length > 1 ? (price - prev(closes)) / prev(closes) : 0;
    const base = { price, rsi: r, sma50: s50, sma200: s200, change24: change };
    if (longTerm == null || r == null) return { ...base, score: 0, action: "HOLD", reasons: [{ pts: 0, text: "Not enough price history yet to judge the trend" }] };

    const up = price > longTerm;
    const ltName = s200 != null ? "200-period" : "50-period";
    add(up ? 2 : -2, up ? `Price above its ${ltName} average — long-term uptrend` : `Price below its ${ltName} average — long-term downtrend`);
    if (s200 != null) add(price > s50 ? 1 : -1, price > s50 ? "Price above 50-period average — short-term strength" : "Price below 50-period average — short-term weakness");

    const m = macd(closes);
    const h = last(m.hist), hp = prev(m.hist);
    if (h != null && hp != null) {
      if (hp <= 0 && h > 0) add(1.5, "MACD just crossed above its signal line — momentum turning up");
      else if (hp >= 0 && h < 0) add(-1.5, "MACD just crossed below its signal line — momentum turning down");
      else add(h > 0 ? 0.5 : -0.5, h > 0 ? "MACD above its signal line — momentum positive" : "MACD below its signal line — momentum negative");
    }

    const R = r.toFixed(0);
    if (up) {
      if (r < 35) add(1.5, `RSI ${R} — a dip inside an uptrend, often a good entry`);
      else if (r < 45) add(0.5, `RSI ${R} — mild pullback inside an uptrend`);
      else if (r <= 80) add(0, `RSI ${R} — ${r > 70 ? "strong, but strength is normal in an uptrend" : "neutral"}`);
    } else {
      if (r > 65) add(-1, `RSI ${R} — a bounce inside a downtrend, these often fade`);
      else if (r < 30) add(0, `RSI ${R} — oversold, but in a downtrend falling prices often keep falling, so this is not a buy reason`);
      else add(0, `RSI ${R} — neutral`);
    }
    if (r > 80) add(-1, `RSI ${R} — extremely stretched, pullback risk`);

    // Context only (no points)
    const bb = bollinger(closes);
    const upB = last(bb.upper), loB = last(bb.lower);
    if (upB != null && price >= upB) add(0, "Price at the upper Bollinger band — stretched to the upside");
    if (loB != null && price <= loB) add(0, "Price at the lower Bollinger band — stretched to the downside");
    const v20 = last(sma(vols, 20));
    if (v20 && last(vols) > v20 * 1.5) add(0, `Volume spike (${(last(vols) / v20).toFixed(1)}× average) on ${change >= 0 ? "an up" : "a down"} move`);

    let action;
    if (score >= 4.5) action = "STRONG BUY";
    else if (score >= 2) action = "BUY";
    else if (score <= -4.5) action = "STRONG SELL";
    else if (score <= -2) action = "SELL";
    else action = "HOLD";

    // Raw indicator values for the technical table
    const tech = {
      macd: last(m.line), macdSignal: last(m.signal), macdHist: h ?? null,
      bbUpper: upB ?? null, bbLower: loB ?? null, bbMid: last(bb.mid) ?? null,
      volRatio: v20 ? last(vols) / v20 : null,
    };
    return { ...base, score, action, reasons, tech };
  }

  // Replays the signals over past candles: buy when the signal says BUY, sell when it says SELL, hold otherwise.
  // Each step only sees candles up to that point (no peeking ahead). fee = cost per buy or sell (0.005 = 0.5%).
  // Starts at candle 200 so the long-term average the signals rely on is always available.
  function backtest(candles, { start = 200, fee = 0.005 } = {}) {
    if (candles.length < start + 30) return null;
    let inPos = false, entry = 0, equity = 1, peak = 1, maxDrawdown = 0;
    const trades = [], markers = [];
    for (let i = start; i < candles.length; i++) {
      const { action } = analyze(candles.slice(0, i + 1));
      const { close: price, time } = candles[i];
      if (!inPos && action.includes("BUY")) {
        inPos = true; entry = price; equity *= 1 - fee;
        markers.push({ time, price, side: "buy" });
      } else if (inPos && action.includes("SELL")) {
        inPos = false;
        trades.push((price / entry) * (1 - fee) * (1 - fee) - 1);
        equity *= (price / entry) * (1 - fee);
        markers.push({ time, price, side: "sell" });
      }
      const value = inPos ? (equity * price) / entry : equity;
      peak = Math.max(peak, value);
      maxDrawdown = Math.max(maxDrawdown, 1 - value / peak);
    }
    const lastPrice = candles[candles.length - 1].close;
    const finalValue = inPos ? (equity * lastPrice) / entry : equity;
    const wins = trades.filter((t) => t > 0).length;
    return {
      bars: candles.length - start,
      from: candles[start].time,
      trades: trades.length,
      wins,
      winRate: trades.length ? wins / trades.length : null,
      strategyReturn: finalValue - 1,
      holdReturn: lastPrice / candles[start].close - 1,
      maxDrawdown,
      openTrade: inPos ? lastPrice / entry - 1 : null,
      fee,
      markers,
    };
  }

  // ── Research helpers (context only: none of these feed the score) ──

  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2; };

  // Finds the moments in this coin's own past whose price shape most resembled the last `window` candles,
  // and reports what happened next. Shapes are compared after normalising (so only the pattern matters, not the price level).
  // Tested on ~3,200 cases across 10 coins: the matches called the next move's direction right about half the time,
  // i.e. no better than chance. Shown as history, not as a forecast.
  function findSimilar(candles, { window = 30, horizons = [7, 30], k = 8 } = {}) {
    const maxH = Math.max(...horizons);
    if (candles.length < window * 4 + maxH) return null;
    const lp = candles.map((c) => Math.log(c.close));
    const norm = (end) => {
      const a = lp.slice(end - window, end);
      const m = a.reduce((x, y) => x + y, 0) / window;
      const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / window) || 1;
      return a.map((v) => (v - m) / sd);
    };
    const n = candles.length, cur = norm(n);
    const cand = [];
    for (let end = window; end <= n - maxH - 1; end++) {   // must have a known "what happened next"
      const w = norm(end);
      let d = 0;
      for (let j = 0; j < window; j++) d += (cur[j] - w[j]) ** 2;
      cand.push([d, end]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const picks = [];
    for (const [d, end] of cand) {
      if (picks.every((q) => Math.abs(q.end - end) >= window)) picks.push({ d, end }); // keep matches from different periods
      if (picks.length === k) break;
    }
    const matches = picks.map(({ d, end }) => {
      const base = candles[end - 1].close;
      return {
        time: candles[end - 1].time,
        similarity: Math.max(0, 1 - d / (2 * window)),            // 1 = identical shape, 0 = unrelated
        after: Object.fromEntries(horizons.map((h) => [h, candles[end - 1 + h].close / base - 1])),
        path: candles.slice(end - window, end + maxH).map((c) => c.close / base), // pattern, then what followed
      };
    });
    const summary = Object.fromEntries(horizons.map((h) => {
      const r = matches.map((m) => m.after[h]);
      return [h, { up: r.filter((x) => x > 0).length, total: r.length, median: median(r), best: Math.max(...r), worst: Math.min(...r) }];
    }));
    return { window, horizons, matches, summary, now: candles.slice(-window).map((c) => c.close / candles[n - 1].close), searched: cand.length };
  }

  // How this coin did over the next `horizon` candles, split by whether it was above or below its 200-period average.
  // This is the evidence behind the trend rule, shown for the coin itself.
  function setupHistory(candles, horizon = 30) {
    const closes = candles.map((c) => c.close), s200 = sma(closes, 200);
    const fw = { up: [], down: [] };
    for (let i = 199; i < closes.length - horizon; i++) fw[closes[i] > s200[i] ? "up" : "down"].push(closes[i + horizon] / closes[i] - 1);
    const stat = (r) => ({ n: r.length, median: median(r), pctUp: r.length ? r.filter((x) => x > 0).length / r.length : null });
    const lastAvg = last(s200);
    if (lastAvg == null || fw.up.length + fw.down.length < 60) return null;
    return { horizon, now: last(closes) > lastAvg ? "up" : "down", up: stat(fw.up), down: stat(fw.down) };
  }

  // Price floors (support) and ceilings (resistance): turning points the price has reacted to before.
  function levels(candles, { lookback = 250, span = 8 } = {}) {
    const c = candles.slice(-lookback), price = last(c).close, pivots = [];
    for (let i = span; i < c.length - span; i++) {
      const win = c.slice(i - span, i + span + 1).map((x) => x.close);
      if (c[i].close === Math.max(...win) || c[i].close === Math.min(...win)) pivots.push(c[i].close);
    }
    const below = pivots.filter((p) => p < price * 0.99), above = pivots.filter((p) => p > price * 1.01);
    return { support: below.length ? Math.max(...below) : null, resistance: above.length ? Math.min(...above) : null };
  }

  // Typical size of one candle's move (median absolute % change) over the last `n` candles.
  function typicalMove(candles, n = 30) {
    const c = candles.slice(-n - 1), moves = [];
    for (let i = 1; i < c.length; i++) moves.push(Math.abs(c[i].close / c[i - 1].close - 1));
    return median(moves);
  }

  const api = { sma, ema, rsi, macd, bollinger, analyze, backtest, findSimilar, setupHistory, levels, typicalMove, median };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Indicators = api;
})(typeof window !== "undefined" ? window : globalThis);

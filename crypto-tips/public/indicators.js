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
  function analyze(candles) {
    const closes = candles.map((c) => c.close);
    const vols = candles.map((c) => c.volume);
    const price = last(closes);
    const reasons = [];
    let score = 0;
    const add = (pts, text) => { score += pts; reasons.push({ pts, text }); };

    const r = last(rsi(closes, 14));
    if (r != null) {
      if (r < 30) add(2, `RSI ${r.toFixed(0)} — oversold, bounce possible`);
      else if (r < 40) add(1, `RSI ${r.toFixed(0)} — leaning oversold`);
      else if (r > 70) add(-2, `RSI ${r.toFixed(0)} — overbought, pullback risk`);
      else if (r > 60) add(-1, `RSI ${r.toFixed(0)} — leaning overbought`);
      else add(0, `RSI ${r.toFixed(0)} — neutral`);
    }

    const m = macd(closes);
    const h = last(m.hist), hp = prev(m.hist);
    if (h != null && hp != null) {
      if (hp <= 0 && h > 0) add(2, "MACD just crossed above signal — bullish momentum");
      else if (hp >= 0 && h < 0) add(-2, "MACD just crossed below signal — bearish momentum");
      else if (h > 0) add(h > hp ? 1 : 0.5, `MACD above signal${h > hp ? ", strengthening" : ", fading"}`);
      else add(h < hp ? -1 : -0.5, `MACD below signal${h < hp ? ", weakening" : ", recovering"}`);
    }

    const s50 = last(sma(closes, 50)), s200 = last(sma(closes, 200));
    if (s50 != null) {
      if (price > s50) add(1, "Price above 50-period average — uptrend");
      else add(-1, "Price below 50-period average — downtrend");
    }
    if (s50 != null && s200 != null) {
      if (s50 > s200) add(1, "50 avg above 200 avg — long-term bullish (golden cross zone)");
      else add(-1, "50 avg below 200 avg — long-term bearish (death cross zone)");
    }

    const bb = bollinger(closes);
    const up = last(bb.upper), lo = last(bb.lower);
    if (up != null) {
      if (price <= lo) add(1, "Price at/below lower Bollinger band — stretched to downside");
      else if (price >= up) add(-1, "Price at/above upper Bollinger band — stretched to upside");
    }

    const v20 = last(sma(vols, 20));
    const change = closes.length > 1 ? (price - prev(closes)) / prev(closes) : 0;
    if (v20 && last(vols) > v20 * 1.5) {
      add(change >= 0 ? 0.5 : -0.5, `Volume spike (${(last(vols) / v20).toFixed(1)}× avg) on ${change >= 0 ? "up" : "down"} move`);
    }

    let action;
    if (score >= 4) action = "STRONG BUY";
    else if (score >= 1.5) action = "BUY";
    else if (score <= -4) action = "STRONG SELL";
    else if (score <= -1.5) action = "SELL";
    else action = "HOLD";

    return {
      price, score, action, reasons,
      rsi: r, sma50: s50, sma200: s200,
      change24: closes.length > 1 ? change : 0,
    };
  }

  // Replays the signals over past candles: buy when the signal says BUY, sell when it says SELL, hold otherwise.
  // Each step only sees candles up to that point (no peeking ahead). fee = cost per buy or sell (0.005 = 0.5%).
  function backtest(candles, { start = 60, fee = 0.005 } = {}) {
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

  const api = { sma, ema, rsi, macd, bollinger, analyze, backtest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Indicators = api;
})(typeof window !== "undefined" ? window : globalThis);

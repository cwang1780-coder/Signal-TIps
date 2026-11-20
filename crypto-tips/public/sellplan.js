// Sell plan for a coin you own: when to take profit, where to cut a loss, and plain-English insights.
// Rule-based from daily candles (the same rules run on the server for push notifications), so it's a
// starting point, not a prediction. Pure functions, no DOM: works in the browser and in Node.
(function (root) {
  const I = typeof module !== "undefined" && module.exports ? require("./indicators.js") : root.Indicators;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const pctTxt = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0) + "%";

  // candles: daily candles, oldest first. cost: the price you paid in USD (optional).
  function plan(candles, { cost } = {}) {
    if (!candles || candles.length < 30) return null;
    const a = I.analyze(candles);
    const price = a.price;
    // The stop and target are set from the candles up to yesterday's close, so today's move is measured
    // against them (a level recomputed from today's price would always move out of the way).
    const before = candles.slice(0, -1), ref = before[before.length - 1].close;
    const vol = Math.max(0.01, I.typicalMove(before, 30) || 0.03); // a typical day's move, e.g. 0.025 = 2.5%
    const { support, resistance } = I.levels(before, { lookback: 120, span: 5 });
    const gain = cost > 0 ? price / cost - 1 : null;
    const at = (n) => candles[candles.length - 1 - n]?.close;
    const ch7 = at(7) ? price / at(7) - 1 : null, ch30 = at(30) ? price / at(30) - 1 : null;

    // Stop: just under the nearest support, or about 3 typical days down. Never closer than 2%, never further than 25%.
    // Stop: just under the lowest price of the last 10 days, or under the nearest support if that's higher.
    // Breaking a recent low is the classic sign a drop is turning into a downtrend. 2% to 25% below yesterday's close.
    const recentLow = Math.min(...before.slice(-10).map((c) => c.low));
    const useSupport = support && support * (1 - vol) > recentLow * (1 - vol / 2);
    let stop = useSupport ? support * (1 - vol) : recentLow * (1 - vol / 2);
    stop = clamp(stop, ref * 0.75, ref * 0.98);
    let stopWhy = useSupport ? "just under the nearest support level" : "just under the lowest price of the last 10 days";
    // Well in profit: don't let a winner turn into a loss. Raise the stop to what you paid.
    if (cost > 0 && ref / cost - 1 > 3 * vol && stop < cost && cost < ref * 0.98) { stop = cost; stopWhy = "what you paid, so a winner can't turn into a loss"; }
    // Target: just under the nearest resistance, or about 4 typical days up. At least 2% away.
    let target = resistance ? resistance * (1 - vol / 2) : ref * (1 + 4 * vol);
    target = Math.max(target, ref * 1.02);
    const targetWhy = resistance ? "just under the nearest resistance, where rallies have stalled before" : "about four typical days' rise above the price";
    const reward = Math.max(0, target / price - 1), risk = Math.max(0, 1 - stop / price);

    // Verdict, most urgent first. `state` is what push notifications watch for changes.
    const sellSig = a.action.includes("SELL"), buySig = a.action.includes("BUY"), hot = a.rsi > 78;
    let state, verdict, detail;
    const gainTxt = gain == null ? "limits the damage" : gain >= 0 ? `keeps the ${pctTxt(gain)} you're still up` : `stops a ${Math.abs(gain * 100).toFixed(0)}% loss from getting bigger`;
    if (price <= stop * 1.005) {
      state = "stop"; verdict = gain != null && gain >= 0 ? "Sell and keep the profit" : "Sell to limit the loss";
      detail = `The price fell to your stop (${stopWhy}). Below here a drop often keeps going, so selling now ${gainTxt}.`;
    } else if (sellSig) {
      state = "sell"; verdict = gain != null && gain > 0 ? "Consider selling and keeping the profit" : "Consider selling or cutting back";
      detail = `The signal is ${a.action}: the coin is in a downtrend. ${gain != null && gain > 0 ? "You're still up, so this is a chance to lock it in." : "Waiting for it to come back can turn a small loss into a big one."}`;
    } else if (price >= target * 0.995 || (hot && gain != null && gain > 0)) {
      state = "target"; verdict = "Take some profit";
      detail = hot ? `It's run up fast (RSI ${a.rsi.toFixed(0)}), which often comes before a pullback. Selling part, say a third, locks in some gains and keeps you in if it keeps going.`
        : `It reached the take-profit area (${targetWhy}). Selling part, say a third, locks in some gains.`;
    } else if (buySig) {
      state = "hold"; verdict = "Hold: the uptrend is intact";
      detail = `The signal is ${a.action}. Keep holding while it stays above the stop, and take some profit near the target.`;
    } else {
      state = "watch"; verdict = "Hold, but watch the stop";
      detail = "No clear trend either way. Hold, but sell if it closes below the stop.";
    }

    const insights = [];
    if (gain != null) insights.push(`You're ${gain >= 0 ? "up" : "down"} ${Math.abs(gain * 100).toFixed(1)}% on what you paid.`);
    const trend = a.reasons[0]?.text || "";
    if (trend) insights.push(trend.replace(/ — /g, ": ") + ".");
    const mom = a.reasons.find((r) => /MACD/.test(r.text));
    if (mom) insights.push(mom.text.replace(/ — /g, ": ") + ".");
    if (a.rsi != null) insights.push(`RSI ${a.rsi.toFixed(0)}: ${a.rsi > 70 ? "stretched to the upside" : a.rsi < 30 ? "beaten down" : "neither stretched nor beaten down"}.`);
    if (ch7 != null) insights.push(`Past week ${pctTxt(ch7)}${ch30 != null ? `, past month ${pctTxt(ch30)}` : ""}.`);
    insights.push(`A typical day moves about ±${(vol * 100).toFixed(1)}%, so ${risk > 0 ? `the stop is ${(risk * 100).toFixed(1)}% away` : "the price is already below the stop"} and the target ${(reward * 100).toFixed(1)}% away${risk > 0 && reward > 0 ? ` (reward/risk ${(reward / risk).toFixed(1)})` : ""}.`);
    if (a.tech?.volRatio > 1.5) insights.push(`Trading volume is ${a.tech.volRatio.toFixed(1)}× normal: big players are active.`);

    return { price, action: a.action, score: a.score, rsi: a.rsi, gain, stop, stopWhy, target, targetWhy, reward, risk, vol, ch7, ch30, state, verdict, detail, insights };
  }

  // The words for a push notification when the state changes (null = nothing worth a ping)
  function message(sym, p, prevState) {
    if (!p || p.state === prevState) return null;
    const f = (x) => "$" + (x >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: 2 }) : x.toPrecision(4));
    if (p.state === "stop") return { title: `${sym} hit your stop (${f(p.stop)})`, body: `Now ${f(p.price)}. ${p.verdict}.` };
    if (p.state === "sell") return { title: `${sym}: signal turned ${p.action}`, body: `Now ${f(p.price)}. ${p.verdict}.` };
    if (p.state === "target") return { title: `${sym}: take some profit`, body: `Now ${f(p.price)}${p.gain != null ? ` (${pctTxt(p.gain)} on what you paid)` : ""}. ${p.rsi > 78 ? "It's stretched after a fast run." : "It reached the target area."}` };
    if (p.state === "hold" && (prevState === "sell" || prevState === "stop")) return { title: `${sym}: the uptrend is back`, body: `Now ${f(p.price)}. Signal ${p.action}.` };
    return null;
  }

  const api = { plan, message };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SellPlan = api;
})(typeof window !== "undefined" ? window : globalThis);

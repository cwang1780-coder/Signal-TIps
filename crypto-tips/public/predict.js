// "Price prediction" on a coin's page: for 1 day, 1 week, 1 month and 3 months ahead, what usually happened next on
// past days that looked like today (Indicators.forecast), plus how often this method has actually been right
// (Indicators.forecastAccuracy, tested only on data it couldn't see). Uses globals from app.js: results, fetchCandles, fmt.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cache = {}; // sym -> {at, f, acc} | {loading} | {error}
  const pct = (x, d = 1) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? d : 0) + "%";
  const cls = (x) => (x > 0.002 ? "up" : x < -0.002 ? "down" : "");

  async function load(sym) {
    if (cache[sym]?.at && Date.now() - cache[sym].at < 15 * 60_000) return;
    if (cache[sym]?.loading) return;
    cache[sym] = { loading: true };
    try {
      const candles = document.getElementById("tf").value === "86400" && results[sym]?.candles?.length > 400 ? results[sym].candles : await fetchCandles(sym, 86400);
      const f = Indicators.forecast(candles);
      cache[sym] = f ? { at: Date.now(), f, acc: Indicators.forecastAccuracy(candles), days: candles.length } : { error: "Not enough price history for a prediction yet." };
    } catch (e) { cache[sym] = { error: "Couldn't load the price history for a prediction." }; }
    const box = document.getElementById("predictBox");
    if (box && box.dataset.sym === sym) box.outerHTML = html(sym);
  }

  function verdict(a) {
    if (!a) return `<span class="muted">not enough tests</span>`;
    const edge = a.directionRight - Math.max(a.alwaysUpRight, 1 - a.alwaysUpRight);
    const word = edge >= 0.08 ? "better than guessing" : edge > -0.05 ? "about a coin flip" : "worse than guessing";
    return `<span class="${edge >= 0.08 ? "up" : edge > -0.05 ? "" : "down"}">${Math.round(a.directionRight * 100)}% right</span> <span class="muted small">(${word})</span>`;
  }

  function html(sym) {
    const c = cache[sym];
    let body;
    if (!c || c.loading) body = `<p class="muted small">Working out the prediction from ${esc(sym)}'s price history…</p>`;
    else if (c.error) body = `<p class="muted small">${esc(c.error)}</p>`;
    else {
      const rows = c.f.horizons.map((h) => `<tr>
          <td><b>${esc(h.label)}</b></td>
          <td class="${cls(h.median)}"><b>${pct(h.median)}</b><span class="muted small"> ≈ ${fmt(h.target)}</span></td>
          <td>${fmt(h.low)} – ${fmt(h.high)}<span class="muted small"> (${pct(h.p25)} to ${pct(h.p75)})</span></td>
          <td>${Math.round(h.upPct * 100)}%</td>
          <td>${verdict(c.acc[h.days])}</td></tr>`).join("");
      const best = c.f.horizons.find((h) => h.days === 7) || c.f.horizons[0];
      const a7 = c.acc[best?.days];
      body = `${best ? `<p class="pd-head">Next ${esc(best.label)}: <b class="${cls(best.median)}">${pct(best.median)}</b> typical, likely between <b>${fmt(best.low)}</b> and <b>${fmt(best.high)}</b>.</p>` : ""}
        <div class="tablewrap"><table class="pd-table">
          <tr><th>Time</th><th>Typical move</th><th>Likely range (middle half)</th><th>Ended higher</th><th>Direction, when tested</th></tr>${rows}</table></div>
        <details class="pd-how"><summary>How this works, and how much to trust it</summary>
          <p class="small">We found the days in ${esc(sym)}'s last ${c.days} days of history that looked like today (${c.f.now.aboveAvg50 ? "above" : "below"} its 50-day average, RSI about ${Math.round(c.f.now.rsi)}, ${c.f.now.weekUp ? "up" : "down"} over the past week) and measured what happened next. "Typical move" is the middle result; half of those times it ended inside the "likely range".</p>
          <p class="small">Then we tested the method on past dates, using only what was known at the time. ${a7 ? `For 1 week ahead it called the direction right <b>${Math.round(a7.directionRight * 100)}%</b> of the time (always guessing "up" would have been right ${Math.round(a7.alwaysUpRight * 100)}%), and the real price ended inside the likely range ${Math.round(a7.inLikelyRange * 100)}% of the time.` : ""} <b>Treat the range as a guide to how far it could move, not the direction as a forecast.</b> Nobody can predict crypto prices reliably.</p>
        </details>`;
    }
    return `<div class="card pd-box" id="predictBox" data-sym="${esc(sym)}"><h3>Price prediction <span class="pill-beta">based on history</span></h3>${body}</div>`;
  }

  window.predictBoxHtml = (sym) => { if (!cache[sym] || (cache[sym].at && Date.now() - cache[sym].at > 15 * 60_000)) setTimeout(() => load(sym), 0); return html(sym); };
  // For Ask AI: the same numbers, so the AI talks about the prediction honestly
  window.predictionSnapshot = (sym) => {
    const c = cache[sym];
    if (!c?.f) return null;
    return { coin: sym, basedOnDays: c.days, horizons: c.f.horizons.map((h) => ({ timeframe: h.label, typicalMovePct: +(h.median * 100).toFixed(1), likelyRangePct: [+(h.p25 * 100).toFixed(1), +(h.p75 * 100).toFixed(1)], endedHigherPct: Math.round(h.upPct * 100), matches: h.n,
      testedDirectionRightPct: c.acc[h.days] ? Math.round(c.acc[h.days].directionRight * 100) : null, testedAlwaysUpRightPct: c.acc[h.days] ? Math.round(c.acc[h.days].alwaysUpRight * 100) : null })),
      note: "From similar past days, not a forecast model. When tested, direction calls were about a coin flip; the range is the useful part." };
  };
})();

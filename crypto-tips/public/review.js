// "AI second opinion" on a coin's signal: the AI checks the signal against the app's data and (with Gemini) a live
// web search, then the page shows both side by side. When they disagree, a tie-breaker shows the evidence and the
// safe rule: wait until both agree. Uses globals from app.js: results, selected, store, trackRecord, fmt.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = {}; // key -> {loading, data, error}
  const keyOf = (sym) => sym + ":" + (results[sym]?.action || "") + ":" + document.getElementById("tf").value;
  const dir = (a) => (/BUY/.test(a) ? "BUY" : /SELL/.test(a) ? "SELL" : "HOLD");
  const VCLS = { BUY: "b-BUY", HOLD: "b-HOLD", SELL: "b-SELL" };

  function tieBreaker(sym, d) {
    const r = results[sym], rows = [];
    const bt = r?.candles ? trackRecord(sym, r.candles) : null;
    if (bt) {
      const beat = bt.strategyReturn > bt.holdReturn;
      rows.push(`<li><b>The signal's track record on ${esc(sym)}:</b> following it made ${(bt.strategyReturn * 100).toFixed(0)}% vs ${(bt.holdReturn * 100).toFixed(0)}% for just holding, over this chart. ${beat ? "It has beaten holding here, so it deserves some weight." : "It has done worse than holding here, so don't lean on it alone."}</li>`);
    }
    const fg = window.researchSnapshot?.()?.fearGreed;
    if (fg?.value != null) rows.push(`<li><b>Market mood:</b> ${fg.value}/100 (${esc(fg.label || "")}). ${fg.value <= 25 ? "Extreme fear: prices are often cheap, but falls can keep going." : fg.value >= 75 ? "Extreme greed: rallies are often late and risky." : "Neither extreme."}</li>`);
    rows.push(`<li><b>AI confidence:</b> ${esc(d.confidence)}${d.confidence === "low" ? ", so its view is a weak one." : "."}</li>`);
    return `<div class="rv-tie"><b>They disagree. Who's right?</b>
      <p class="small">Nobody can know for sure. Here's the evidence on each side:</p><ul>${rows.join("")}</ul>
      <p class="rv-rule"><b>Our rule when they disagree:</b> ${dir(r.action) === "BUY" || d.verdict === "BUY" ? "don't buy yet. Wait until both agree, or keep it very small." : "don't add more. If you own it, protect it with a stop."}</p></div>`;
  }

  function html(sym) {
    const r = results[sym];
    if (!r || r.error || !r.action) return "";
    const st = state[keyOf(sym)];
    let body;
    if (!st) body = `<p class="small muted">Have the AI check this ${esc(r.action)} signal against the latest news and the whole market, and say whether it agrees.</p>
      <button class="rv-go" data-review="${esc(sym)}">Get AI second opinion</button>`;
    else if (st.loading) body = `<p class="small muted">Checking the news and the market… this can take up to 30 seconds.</p>`;
    else if (st.error) body = `<p class="small" style="color:var(--sell)">${esc(st.error)}</p><button class="rv-go" data-review="${esc(sym)}">Try again</button>`;
    else {
      const d = st.data, agree = d.agreesWithSignal && d.verdict === dir(r.action);
      body = `<div class="rv-pair"><div><span class="muted small">Signal</span><span class="badge ${VCLS[dir(r.action)]}">${esc(r.action)}</span></div>
          <div><span class="muted small">AI</span><span class="badge ${VCLS[d.verdict]}">${esc(d.verdict)}</span></div>
          <div class="rv-agree ${agree ? "yes" : "no"}">${agree ? "✓ They agree" : "⚠ They disagree"}</div></div>
        <p class="small">${esc(d.summary)} <span class="muted">(${esc(d.confidence)} confidence)</span></p>
        ${agree ? "" : tieBreaker(sym, d)}
        <details class="rv-more"><summary>The AI's reasons${d.news.length ? " and news" : ""}</summary>
          ${d.reasons.length ? `<b class="small">Why</b><ul>${d.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${d.risks.length ? `<b class="small">Risks</b><ul>${d.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${d.news.length ? `<b class="small">Recent news it found</b><ul>${d.news.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${d.sources?.length ? `<b class="small">Sources</b><ul>${d.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener nofollow">${esc(x.title)} ↗</a></li>`).join("")}</ul>` : ""}
        </details>
        <p class="muted small">${d.searched ? "Checked live web results." : "Based on the app's data (no live web search this time)."} ${new Date(d.at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · Not financial advice.</p>`;
    }
    return `<div class="side-box rv-box" id="reviewBox" data-sym="${esc(sym)}"><h3>AI second opinion</h3>${body}</div>`;
  }
  const refresh = () => { const b = document.getElementById("reviewBox"); if (b) b.outerHTML = html(b.dataset.sym); };

  async function run(sym) {
    const key = keyOf(sym);
    state[key] = { loading: true }; refresh();
    try {
      const res = await fetch("/api/ask?review=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coin: sym, snapshot: window.aiSnapshot?.() }), signal: AbortSignal.timeout ? AbortSignal.timeout(60_000) : undefined });
      const d = await res.json().catch(() => ({}));
      if (res.status === 402) { delete state[key]; refresh(); return window.paywall?.("AI second opinion"); }
      if (!res.ok) throw new Error(d.reason || "Something went wrong (" + res.status + ")");
      state[key] = { data: d };
      try { sessionStorage.setItem("rv:" + key, JSON.stringify({ at: Date.now(), d })); } catch {}
    } catch (e) {
      state[key] = { error: e.name === "TimeoutError" ? "That took too long. Try again." : e.message };
    }
    refresh();
  }

  // Reuse a recent answer (20 minutes) after a reload
  function restore(sym) {
    const key = keyOf(sym);
    if (state[key]) return;
    try { const c = JSON.parse(sessionStorage.getItem("rv:" + key) || "null"); if (c && Date.now() - c.at < 20 * 60_000) state[key] = { data: c.d }; } catch {}
  }
  window.reviewBoxHtml = (sym) => { restore(sym); return html(sym); };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-review]"); if (b) run(b.dataset.review); });
})();

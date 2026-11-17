// "Ask AI" chat panel. Sends the app's current data with each question to the local server (/api/ask).
// Uses globals from app.js: results, cb, holdings, allSyms, $, selected.
(function () {
  let chat = []; // [{role, content}]
  let busy = false;

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Tiny, safe markdown: escape first, then **bold**, _italic_, `code`, bullets, paragraphs.
  function md(text) {
    const lines = esc(text).split("\n");
    let html = "", inList = false;
    for (const raw of lines) {
      let line = raw
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, "$1<i>$2</i>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
      const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (bullet) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${bullet[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (/^#{1,4}\s/.test(line)) html += `<p><b>${line.replace(/^#+\s/, "")}</b></p>`;
      else if (line.trim()) html += `<p>${line}</p>`;
    }
    return html + (inList ? "</ul>" : "");
  }

  function snapshot() {
    const round = (n, d = 2) => (n == null || !isFinite(n) ? null : +n.toFixed(d));
    const sig = (n) => (n == null ? null : +n.toPrecision(6));
    const coinsOut = {};
    for (const sym of allSyms()) {
      const r = results[sym];
      if (!r) continue;
      if (r.error) { coinsOut[sym] = { error: r.error }; continue; }
      coinsOut[sym] = {
        price: sig(r.price), change24hPct: round(r.change24 * 100), action: r.action, score: round(r.score, 1),
        rsi: round(r.rsi, 0), sma50: sig(r.sma50), sma200: sig(r.sma200),
        reasons: r.reasons.map((x) => `${x.pts > 0 ? "+" : ""}${x.pts}: ${x.text}`),
      };
    }
    const all = [...cb.holdings.map((h) => ({ ...h, source: "Coinbase" })), ...(window.walletHoldings?.() || []).map((h) => ({ ...h, source: "Connected wallet (read-only)" })), ...holdings.map((h) => ({ ...h, source: "Manual (e.g. Exodus)" }))];
    return {
      timeframe: $("tf").selectedOptions[0].textContent,
      selectedCoin: selected || null,
      coins: coinsOut,
      holdings: all.map((h) => {
        const p = results[h.sym]?.price;
        return { coin: h.sym, amount: sig(h.amt), avgBuyPrice: h.cost || null, valueUSD: p ? round(p * h.amt) : null,
          profitUSD: p && h.cost ? round((p - h.cost) * h.amt) : null, source: h.source };
      }),
      cash: cb.cash,
      displayCurrency: window.Currency ? { code: Currency.code, perUSD: +Currency.toLocal(1).toPrecision(6) } : { code: "USD", perUSD: 1 },
      userExperience: window.userLevel ? (window.userLevel() === "pro" ? "experienced trader" : "new to trading") : "new to trading",
      social: window.socialSnapshot ? window.socialSnapshot() : null,
      research: window.researchSnapshot ? window.researchSnapshot() : null,
      trackRecordOfSelectedCoin: (() => {
        const r = results[selected];
        if (!r?.candles) return null;
        const bt = trackRecord(selected, r.candles);
        return bt && { coin: selected, candles: bt.bars, followingSignalsPct: round(bt.strategyReturn * 100, 1), justHoldingPct: round(bt.holdReturn * 100, 1),
          finishedTrades: bt.trades, tradesWon: bt.wins, maxDrawdownPct: round(bt.maxDrawdown * 100, 0), feePerTradePct: bt.fee * 100 };
      })(),
    };
  }

  function render() {
    const log = $("aiLog");
    log.innerHTML = chat.length
      ? chat.map((m) => `<div class="msg ${m.role}">${m.role === "user" ? esc(m.content) : md(m.content) || '<span class="muted">Thinking…</span>'}</div>`).join("")
      : `<div class="muted">Ask anything about the signals or your holdings. The AI sees the same live data you see on this page.</div>`;
    log.scrollTop = log.scrollHeight;
    $("aiSend").disabled = busy;
    $("aiSend").textContent = busy ? "…" : "Ask";
  }

  async function ask(question) {
    question = question.trim();
    if (!question || busy) return;
    if (location.protocol === "file:") {
      chat.push({ role: "user", content: question }, { role: "assistant", content: "Ask AI needs the local server. Run `node server.js` and open http://localhost:8000." });
      return render();
    }
    const history = chat.slice();
    chat.push({ role: "user", content: question });
    const answer = { role: "assistant", content: "" };
    chat.push(answer);
    busy = true; render();
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ question, history, snapshot: snapshot() }),
      });
      if (!res.ok) {
        const t = await res.text();
        let reason = t;
        try { reason = JSON.parse(t).reason || t; } catch {}
        if (res.status === 402) { window.showUpgrade?.(); window.refreshPro?.(); throw new Error(reason === "Ask AI is a Pro feature." ? "Ask AI is a Pro feature. Tap \"Go Pro\" above to unlock it." : reason); }
        if (res.status === 429) { window.refreshPro?.(); throw new Error(reason); }
        if (res.status === 401) throw new Error("Ask AI is only for the site owner right now. If that's you, tap \"Owner login\" under My holdings.");
        if (res.status === 503) throw new Error("Ask AI isn't turned on for this site yet.");
        throw new Error(reason || "HTTP " + res.status);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer.content += dec.decode(value, { stream: true });
        render();
      }
      if (!answer.content.trim()) answer.content = "No answer came back. Try again.";
      window.refreshPro?.();
    } catch (e) {
      answer.content = "Error: " + (e.message || "Request failed");
    }
    busy = false; render();
  }

  window.askAI = (q) => { showTab("ai"); ask(q); };

  $("aiForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $("aiInput").value; $("aiInput").value = ""; ask(q); });
  $("aiChips").addEventListener("click", (e) => { if (e.target.dataset.q) ask(e.target.dataset.q); });
  $("aiClear").onclick = () => { if (!busy) { chat = []; render(); } };
  render();
})();

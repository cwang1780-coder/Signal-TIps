// Research: market mood bar, extra reasons for and against, what history says, similar past patterns, news.
// Everything here is context to weigh. None of it changes the signal score (see README → Research).
// Uses globals from app.js: results, selected, $, fmt, pct, coinName, trackRecord, fetchPage, API.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const p0 = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(0) + "%";
  const p1 = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  const gran = () => +$("tf").value;
  const UNIT = { 86400: ["day", "days"], 21600: ["6-hour candle", "6-hour candles"], 3600: ["hour", "hours"] };
  const units = (n) => `${n} ${UNIT[gran()][n === 1 ? 0 : 1]}`;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };

  // ── data ──
  const research = {};   // sym (or "") -> {at, data}
  const deep = {};       // "SYM:gran" -> candles (up to ~2,400) for history searches
  const loading = new Set();

  async function loadResearch(sym) {
    const key = sym || "";
    if (location.protocol === "file:" || loading.has("r" + key) || (research[key] && Date.now() - research[key].at < 10 * 60000)) return;
    loading.add("r" + key);
    try {
      const res = await fetch(`/api/research?coin=${encodeURIComponent(key)}&name=${encodeURIComponent(coinName(key))}`);
      if (res.ok) { research[key] = { at: Date.now(), data: await res.json() }; if (!research[""]) research[""] = research[key]; }
    } catch {}
    loading.delete("r" + key);
    renderMarket(); renderTopNews();
    if (selected === sym) renderResearch(sym);
  }

  // Older price history for the selected coin only, so pattern searches have years to look through.
  async function loadDeep(sym) {
    const key = sym + ":" + gran(), base = results[sym]?.candles;
    if (!base || deep[key] || loading.has("d" + key)) return;
    loading.add("d" + key);
    const map = new Map(base.map((c) => [c.time, c]));
    let end = base[0].time;
    for (let k = 0; k < 5; k++) {
      try {
        const older = await fetchPage(sym, gran(), end - gran());
        if (!older.length) break;
        older.forEach((c) => map.set(c.time, c));
        end = older[0].time;
      } catch { break; }
    }
    deep[key] = [...map.values()].sort((a, b) => a.time - b.time);
    loading.delete("d" + key);
    if (selected === sym) renderResearch(sym);
  }
  // Deep history with the newest candles from the live data merged in.
  function history(sym) {
    const d = deep[sym + ":" + gran()], live = results[sym]?.candles;
    if (!live) return null;
    if (!d) return live;
    const map = new Map(d.map((c) => [c.time, c]));
    live.forEach((c) => map.set(c.time, c));
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  // ── market bar (Signals tab) ──
  function moodClass(v) { return v <= 25 ? "down" : v >= 75 ? "up" : ""; }
  function renderMarket() {
    const d = research[""]?.data, el = $("marketBar");
    if (!d || (!d.fearGreed && !d.global)) { el.hidden = true; return; }
    el.hidden = false;
    const f = d.fearGreed, g = d.global, parts = [];
    if (f?.value != null) parts.push(`<span title="The Fear &amp; Greed index: 0 is extreme fear, 100 is extreme greed. A week ago it was ${f.weekAgo ?? "?"}.">Market mood <b class="${moodClass(f.value)}">${esc(f.label)} · ${f.value}/100</b></span>`);
    if (g?.marketCapUsd) parts.push(`<span title="The combined value of all cryptocurrencies">All crypto <b>$${(g.marketCapUsd / 1e12).toFixed(2)}T</b>${g.change24hPct != null ? ` <b class="${g.change24hPct >= 0 ? "up" : "down"}">${g.change24hPct >= 0 ? "+" : ""}${g.change24hPct}% today</b>` : ""}</span>`);
    if (g?.btcDominancePct != null) parts.push(`<span title="Bitcoin's share of the whole crypto market. A rising share usually means money is leaving smaller coins.">Bitcoin's share <b>${g.btcDominancePct}%</b></span>`);
    el.innerHTML = parts.join("");
  }

  function newsList(items) {
    return `<ul class="news">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.source)} · ${ago(n.time)}</span></li>`).join("")}</ul>`;
  }
  function renderTopNews() {
    const top = research[""]?.data?.news?.top;
    $("topNews").innerHTML = top?.length ? `<h2>Top crypto headlines</h2><div class="panel">${newsList(top)}<p class="muted" style="margin-top:6px">Headlines from Cointelegraph and Decrypt. Tap to read the full story on their site.</p></div>` : "";
  }

  // ── more reasons for and against ──
  function reasons(sym) {
    const r = results[sym], out = [];
    const add = (side, title, text) => out.push({ side, title, text });
    const c = r.candles, price = r.price;
    const btc = results.BTC;

    if (sym !== "BTC" && btc && !btc.error) {
      if (btc.action.includes("SELL")) add("against", "Bitcoin is in a downtrend", "Most coins follow Bitcoin. When it falls, smaller coins usually fall harder.");
      else if (btc.action.includes("BUY")) add("for", "Bitcoin is in an uptrend", "Most coins follow Bitcoin, so a rising Bitcoin is a tailwind.");
      else add("neutral", "Bitcoin is undecided", "Most coins follow Bitcoin, and right now it has no clear direction.");
      const n = Math.min(90, c.length - 1, btc.candles.length - 1);
      const rel = c[c.length - 1].close / c[c.length - 1 - n].close - btc.candles[btc.candles.length - 1].close / btc.candles[btc.candles.length - 1 - n].close;
      if (rel > 0.05) add("for", `Stronger than Bitcoin lately`, `Over the last ${units(n)} it did ${p0(rel)} better than Bitcoin. Coins that lead tend to keep getting attention.`);
      else if (rel < -0.05) add("against", `Weaker than Bitcoin lately`, `Over the last ${units(n)} it did ${p0(rel)} versus Bitcoin. Money has been moving away from it.`);
    }

    const yr = c.slice(-Math.min(c.length, Math.round((365 * 86400) / gran())));
    const hi = Math.max(...yr.map((x) => x.close)), lo = Math.min(...yr.map((x) => x.close));
    const fromHi = price / hi - 1, span = gran() === 86400 ? "1-year" : "recent";
    if (fromHi > -0.1) add("for", `Near its ${span} high`, `Only ${p0(fromHi)} from the top of its ${span} range (${fmt(hi)}). Strength tends to continue, though buying right at a high can mean a wait.`);
    else if (fromHi < -0.5) add("against", `Down ${Math.round(-fromHi * 100)}% from its ${span} high`, `It peaked at ${fmt(hi)}. A big discount is not the same as good value: coins that fall this far often keep falling.`);
    else add("neutral", `${Math.round(-fromHi * 100)}% below its ${span} high`, `Range over that time: ${fmt(lo)} to ${fmt(hi)}.`);

    const lv = Indicators.levels(c);
    if (lv.support || lv.resistance) {
      const bits = [];
      if (lv.support) bits.push(`nearest floor ${fmt(lv.support)} (${p1(lv.support / price - 1)})`);
      if (lv.resistance) bits.push(`nearest ceiling ${fmt(lv.resistance)} (${p1(lv.resistance / price - 1)})`);
      const nearFloor = lv.support && price / lv.support - 1 < 0.03;
      add("neutral", nearFloor ? "Sitting just above a price floor" : "Price floors and ceilings",
        `${bits.join(", ")}. These are levels where the price turned around before. ${nearFloor ? "Buyers stepped in here last time; if it breaks below, that is a warning sign." : "Traders watch them for bounces and breakouts."} You can draw them on the chart and set an alert.`);
    }

    const mv = Indicators.typicalMove(c);
    if (mv != null) {
      const btcMv = btc?.candles ? Indicators.typicalMove(btc.candles) : null;
      const ratio = sym !== "BTC" && btcMv ? mv / btcMv : null;
      add(ratio && ratio >= 2 ? "against" : "neutral", ratio && ratio >= 2 ? "Much jumpier than Bitcoin" : "How much it swings",
        `A typical move is ±${(mv * 100).toFixed(1)}% per ${UNIT[gran()][0]}${ratio ? `, about ${ratio.toFixed(1)}× Bitcoin's` : ""}. Bigger swings mean bigger losses when you're wrong, so smaller positions make sense.`);
    }

    const s = window.socialSnapshot?.().coins?.[sym];
    if (s && !s.error && s.bullishPct != null) {
      if (["high", "very high"].includes(s.hype) && s.bullishPct >= 85) add("against", "The crowd is extremely bullish", `${s.bullishPct}% of tagged posts are bullish and hype is ${s.hype}. When almost everyone already agrees, there are fewer buyers left to push it higher.`);
      else if (s.bullishPct <= 35) add("neutral", "The crowd is gloomy", `Only ${s.bullishPct}% of tagged posts are bullish. Some traders read that as a contrarian sign, but on its own it has not been reliable.`);
      else add("neutral", "What the crowd thinks", `${s.bullishPct}% of tagged posts are bullish, hype is ${s.hype}. See the Buzz tab for the posts.`);
    }

    const m = research[""]?.data;
    if (m?.global?.change24hPct != null && Math.abs(m.global.change24hPct) >= 3)
      add(m.global.change24hPct > 0 ? "for" : "against", `The whole market is ${m.global.change24hPct > 0 ? "up" : "down"} ${Math.abs(m.global.change24hPct)}% today`, "Big market-wide days carry most coins with them, whatever their own story is.");
    if (m?.fearGreed?.value != null)
      add("neutral", `Market mood: ${m.fearGreed.label} (${m.fearGreed.value}/100)`, `A week ago it was ${m.fearGreed.weekAgo ?? "?"}. People often say "buy when others are fearful", but when we checked 2018 to 2026, Bitcoin's next 30 days were up 57% of the time after extreme fear versus 54% on any ordinary day. Mood alone has not been a reliable signal.`);

    const bt = trackRecord(sym, c);
    if (bt && bt.trades + (bt.openTrade != null ? 1 : 0) > 0) {
      const d = bt.strategyReturn - bt.holdReturn;
      if (d > 0.05) add("for", "The signals have worked on this coin", `On this chart, following them did ${Math.round(d * 100)} points better than holding. Past results do not predict future results.`);
      else if (d < -0.05) add("against", "The signals have not worked well on this coin", `On this chart, following them did ${Math.round(-d * 100)} points worse than holding. Give the signal less weight here.`);
    }
    return out;
  }

  function reasonsHtml(sym) {
    const all = reasons(sym);
    const col = (side, title, cls) => {
      const items = all.filter((x) => x.side === side);
      return `<div class="rcol ${cls}"><h3>${title} <span class="muted">${items.length}</span></h3>${items.length ? items.map((x) => `<div class="reason"><b>${esc(x.title)}</b><span>${x.text}</span></div>`).join("") : `<div class="muted">Nothing stands out right now.</div>`}</div>`;
    };
    return `<h2>More to weigh <span class="muted">other reasons people buy or sell. These don't change the score above.</span></h2>
      <div class="rgrid">${col("for", "👍 Reasons for", "rfor")}${col("against", "👎 Reasons against", "ragainst")}${col("neutral", "🔎 Worth knowing", "rneutral")}</div>`;
  }

  // ── what history says ──
  function spark(path, split) {
    const W = 150, H = 46, min = Math.min(...path), max = Math.max(...path);
    const X = (i) => (i / (path.length - 1)) * W, Y = (v) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
    const pts = (a, off) => a.map((v, i) => `${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const up = path[path.length - 1] >= path[split - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Price pattern and what followed">
      <polyline points="${pts(path.slice(0, split), 0)}" fill="none" stroke="#9aa1ad" stroke-width="1.5"/>
      <polyline points="${pts(path.slice(split - 1), split - 1)}" fill="none" stroke="${up ? "#098551" : "#cf202f"}" stroke-width="2"/>
      <circle cx="${X(split - 1).toFixed(1)}" cy="${Y(path[split - 1]).toFixed(1)}" r="2.5" fill="#0a0b0d"/></svg>`;
  }

  // Say what this coin's own history shows, whichever way it points.
  function setupVerdict(sh) {
    if (!sh.up.n || !sh.down.n) return "It has spent this whole period on one side of its average, so there is nothing to compare.";
    const d = sh.up.median - sh.down.median;
    if (d >= 0.03) return "In this coin's history, the weeks after it was above its long-term average went better than the weeks after it was below. That fits the trend idea behind the signal.";
    if (d <= -0.03) return "In this coin's history, the weeks after it was below its long-term average actually went better. That is the opposite of the trend idea behind the signal, so give the signal less weight for this coin over this timespan.";
    return "In this coin's history, the next stretch looked about the same either way. The trend signal's edge in our tests came from avoiding the long slides, not from every short stretch.";
  }

  function historyHtml(sym) {
    const h = history(sym), name = coinName(sym) || sym;
    if (!h) return "";
    const key = sym + ":" + gran(), stillLoading = !deep[key];
    const years = ((h[h.length - 1].time - h[0].time) / (365 * 86400));
    const span = years >= 1 ? `${years.toFixed(1)} years` : `${Math.round(years * 365)} days`;
    let html = `<h2>What history says <span class="muted">searching ${span} of ${esc(name)}'s prices${stillLoading ? " (loading more…)" : ""}</span></h2>`;

    const sh = Indicators.setupHistory(h, 30);
    if (sh) {
      const row = (k, label) => `<div class="${sh.now === k ? "nowrow" : ""}"><span class="muted">${label}${sh.now === k ? " <b>(like now)</b>" : ""}</span>
        <b class="${sh[k].median >= 0 ? "up" : "down"}">${sh[k].n ? p0(sh[k].median) : "–"}</b><span class="muted">${sh[k].n ? `typical move over the next ${units(30)} · up ${Math.round(sh[k].pctUp * 100)}% of the time` : "never happened in this period"}</span></div>`;
      html += `<div class="stats setup">${row("up", "When it was above its 200-period average")}${row("down", "When it was below its 200-period average")}</div>
        <p class="muted" style="margin:6px 0 14px">${setupVerdict(sh)} Based on ${sh.up.n + sh.down.n} past ${UNIT[gran()][1]}.</p>`;
    }

    const sim = Indicators.findSimilar(h);
    if (sim) {
      const [h1, h2] = sim.horizons, s1 = sim.summary[h1], s2 = sim.summary[h2];
      const line = (hh, s) => `<div><span class="muted">${units(hh)} later</span><b class="${s.median >= 0 ? "up" : "down"}">${p0(s.median)}</b><span class="muted">typical · up in ${s.up} of ${s.total} · from ${p0(s.worst)} to ${p0(s.best)}</span></div>`;
      html += `<h3 class="subh">Similar moments in the past</h3>
        <p style="margin-bottom:8px">The last ${units(sim.window)} of ${esc(name)}'s chart look most like these ${sim.matches.length} earlier moments. Here is what happened next each time:</p>
        <div class="stats setup">${line(h1, s1)}${line(h2, s2)}</div>
        <div class="sims">${sim.matches.map((m) => `<div class="sim" title="${Math.round(m.similarity * 100)}% similar shape">
          ${spark(m.path, sim.window)}
          <div><b>${new Date(m.time * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</b> <span class="muted">${Math.round(m.similarity * 100)}% alike</span></div>
          <div class="${m.after[h2] >= 0 ? "up" : "down"}">then ${p0(m.after[h2])} in ${units(h2)}</div></div>`).join("")}</div>
        <p class="muted" style="margin-top:8px">Grey is the matching pattern, the coloured part is what followed. <b>How much to trust this: not much.</b> We tested this method on about 3,200 past cases across 10 coins,
        and the matches got the direction right about half the time, the same as a coin flip. It shows the range of things that have happened, not what will happen.</p>`;
    } else if (!stillLoading) {
      html += `<p class="muted">Not enough price history to look for similar patterns yet.</p>`;
    }
    return html;
  }

  function coinNewsHtml(sym) {
    const d = research[sym]?.data;
    if (!d) return "";
    const items = d.news?.coin || [];
    return `<h2>Latest news <span class="muted">headlines that mention ${esc(coinName(sym) || sym)}</span></h2>` +
      (items.length ? newsList(items) : `<p class="muted">No recent headlines mention it. ${d.news?.error ? "(News is unavailable right now.)" : "See the Buzz tab for the top crypto stories."}</p>`);
  }

  function renderResearch(sym) {
    const el = document.getElementById("detailResearch");
    if (!el || !sym || !results[sym] || results[sym].error) return;
    el.innerHTML = reasonsHtml(sym) + historyHtml(sym) + coinNewsHtml(sym);
    loadResearch(sym); loadDeep(sym);
  }

  // Compact research data for the AI. Headlines are untrusted text; the server prompt says so.
  window.researchSnapshot = () => {
    const m = research[""]?.data, sym = selected, out = { fearGreed: m?.fearGreed || null, market: m?.global || null, topHeadlines: (m?.news?.top || []).slice(0, 5).map((n) => n.title) };
    if (sym && results[sym] && !results[sym].error) {
      const h = history(sym), sim = h && Indicators.findSimilar(h), sh = h && Indicators.setupHistory(h, 30);
      out.selectedCoin = {
        coin: sym,
        otherReasons: reasons(sym).map((x) => `${x.side}: ${x.title}. ${x.text.replace(/<[^>]+>/g, "")}`),
        aboveVsBelow200avg: sh && { now: sh.now, above: { medianNext30Pct: Math.round(sh.up.median * 100), upPct: Math.round(sh.up.pctUp * 100) }, below: { medianNext30Pct: Math.round(sh.down.median * 100), upPct: Math.round(sh.down.pctUp * 100) } },
        similarPastPatterns: sim && { note: "Tested: these matches predict direction no better than a coin flip. History, not a forecast.", after: Object.fromEntries(sim.horizons.map((hh) => [hh + " candles", { up: sim.summary[hh].up, of: sim.summary[hh].total, medianPct: Math.round(sim.summary[hh].median * 100) }])) },
        headlines: (research[sym]?.data?.news?.coin || []).map((n) => n.title),
      };
    }
    return out;
  };
  window.renderResearch = renderResearch;

  document.addEventListener("prices-updated", () => { loadResearch(""); renderMarket(); });
  renderMarket();
})();

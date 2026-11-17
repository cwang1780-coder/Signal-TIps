// Trench page: coins making big moves right now, with how risky chasing them has been in the past.
// Uses globals from app.js: store, $, fmt, coins, results, analyzeCoin, render, coinIcon, showTab, openCoin.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let data = null, stats = null, onlyCoinbase = store.get("trenchCB", false), loadedAt = 0;
  const pc = (x) => Math.round(x * 100) + "%";
  const sgn = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  const money = (n) => Currency.compact(n);
  const BUCKET_TXT = { surge30to60: "Coins that rose 30–60% in a week", surge60to100: "Coins that rose 60–100% in a week", surgeOver100: "Coins that more than doubled in a week" };

  function momentum(x) {
    if (x.ch24 <= -20) return ["down", "Crashing now"];
    if (x.ch24 < -5) return ["down", "Dropping back"];
    if (x.ch24 < 5) return ["", "Cooling off"];
    return ["up", "Still climbing"];
  }

  async function load(force) {
    if (location.protocol === "file:") return;
    if (!force && data && Date.now() - loadedAt < 4 * 60000) return render2();
    $("trenchStatus").textContent = "Scanning the market…";
    try {
      const [t, s] = await Promise.all([
        fetch("/api/trench").then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.reason || "HTTP " + r.status); return d; }),
        stats ? stats : fetch("trench-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      data = t; stats = s; loadedAt = Date.now();
      $("trenchStatus").textContent = "Updated " + new Date(t.updated).toLocaleTimeString() + " · refreshes every 5 minutes";
    } catch (e) { $("trenchStatus").textContent = "Scanner unavailable: " + e.message; }
    render2();
  }

  function render2() {
    if (stats) {
      $("trenchStudy").innerHTML = `
        <div class="ts-head"><b>Before you chase: what happened after ${stats.events} big come-ups</b>
          <span class="muted">Every coin trading on Coinbase (${stats.coinsStudied} coins), ${stats.from} to ${stats.to}. A come-up = up 30%+ in a week with trading volume 3×+ normal.</span></div>
        <div class="stats setup">
          <div><span class="muted">Higher 7 days later</span><b class="down">${pc(stats.after7.higher)}</b><span class="muted">an ordinary day: ${pc(stats.ordinaryDay7.higher)}</span></div>
          <div><span class="muted">Typical result after 30 days</span><b class="down">${sgn(stats.after30.median * 100)}</b><span class="muted">middle result</span></div>
          <div><span class="muted">Fell another 30%+ within a month</span><b class="down">${pc(stats.within30.fellBy30AtSomePoint)}</b><span class="muted">vs ${pc(stats.within30.roseBy50AtSomePoint)} that rose another 50%+</span></div>
        </div>
        <p class="muted small" style="margin-top:8px">In plain words: by the time a coin is visibly "coming up", most of the move has usually happened, and buying then has lost money about 3 times out of 4. Bigger hype did worse. Trench shows you what's moving and the risk, not sure winners: no tool can honestly promise those.</p>`;
    }
    if (!data) return;
    const list = data.movers.filter((x) => !onlyCoinbase || x.onCoinbase);
    $("trenchList").innerHTML = list.length ? list.map((x) => {
      const [mc, mt] = momentum(x), b = stats?.buckets?.[x.bucket];
      return `<article class="tcard">
        <div class="row"><span class="tc-name">${coinIcon(x.sym, 36)}<span><b>${esc(x.sym)}</b><span class="muted">${esc(x.name)}${x.rank ? " · #" + x.rank : ""}</span></span></span>
          <span class="badge ${x.risk === "very high" ? "b-SELL" : "b-HOLD"}">Chase risk: ${x.risk}</span></div>
        <div class="tc-moves"><div><span class="muted">7 days</span><b class="${x.ch7 >= 0 ? "up" : "down"}">${sgn(x.ch7)}</b></div>
          <div><span class="muted">24 hours</span><b class="${x.ch24 >= 0 ? "up" : "down"}">${sgn(x.ch24)}</b></div>
          <div><span class="muted">Price</span><b>${fmt(x.price)}</b></div></div>
        <div class="tc-tags"><span class="tag2 ${mc}">${mt}</span>
          ${x.trendingRank ? `<span class="tag2">${icon("flame")} Trending #${x.trendingRank}</span>` : ""}
          <span class="tag2" title="24h trading volume compared with the coin's total value">Volume ${money(x.volume)} · ${Math.round(x.turnover * 100)}% of its value</span>
          ${x.social ? `<a class="tag2" href="${esc(x.social.url)}" target="_blank" rel="noopener">StockTwits: hype ${esc(x.social.hype)}${x.social.bullishPct != null ? `, ${x.social.bullishPct}% bullish` : ""}</a>` : ""}
          ${x.onCoinbase ? `<span class="tag2 cb">On Coinbase</span>` : `<span class="tag2">Not on Coinbase</span>`}</div>
        ${b ? `<p class="tc-hist">${BUCKET_TXT[x.bucket]}: <b>${pc(b.higher7)}</b> were higher a week later (typical ${sgn(b.median7 * 100)}).</p>` : ""}
        <div class="tc-actions">
          ${x.onCoinbase ? `<button class="pill dark" data-trench-open="${esc(x.sym)}">Look closer in Signal Tips</button>` : ""}
          <a class="pill-link" href="${esc(x.url)}" target="_blank" rel="noopener">CoinGecko ↗</a></div>
      </article>`;
    }).join("") : `<p class="muted">No coins are making a big move right now${onlyCoinbase ? " on Coinbase" : ""}. That's normal in quiet or falling markets.</p>`;
  }

  window.trenchSnapshot = () => data && { movers: data.movers.slice(0, 10).map((x) => ({ sym: x.sym, ch7: x.ch7, ch24: x.ch24, risk: x.risk, trending: x.trendingRank, onCoinbase: x.onCoinbase, social: x.social && { hype: x.social.hype, bullishPct: x.social.bullishPct } })),
    study: stats && { comeUps: stats.events, higherAfter7d: Math.round(stats.after7.higher * 100), ordinaryDay: Math.round(stats.ordinaryDay7.higher * 100), median30d: Math.round(stats.after30.median * 100) } };

  document.addEventListener("click", async (e) => {
    const o = e.target.closest("[data-trench-open]");
    if (!o) return;
    const sym = o.dataset.trenchOpen;
    if (!coins.includes(sym)) { coins.push(sym); store.set("coins", coins); }
    if (!results[sym]) { o.textContent = "Loading…"; try { results[sym] = await analyzeCoin(sym); } catch (err) { results[sym] = { error: err.message }; } }
    openCoin(sym);
  });
  $("trenchCB").checked = onlyCoinbase;
  $("trenchCB").onchange = () => { onlyCoinbase = $("trenchCB").checked; store.set("trenchCB", onlyCoinbase); render2(); };
  $("trenchRefresh").onclick = () => load(true);
  window.loadTrench = load;
  setInterval(() => { if (!document.querySelector('[data-tab="trench"]').hidden) load(true); }, 5 * 60000);
  document.addEventListener("currency-changed", () => { if (typeof data !== "undefined" && data) render2(); });
})();

// Trench page: coins making big moves right now, with how risky chasing them has been in the past.
// Uses globals from app.js: store, $, fmt, coins, results, analyzeCoin, render, coinIcon, showTab, openCoin.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let data = null, stats = null, onlyCoinbase = store.get("trenchCB", false), loadedAt = 0;
  const pc = (x) => Math.round(x * 100) + "%";
  const sgn = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  const money = (n) => Currency.compact(n);
  const BUCKET_TXT = { surge30to60: "Coins that rose 30–60% in a week", surge60to100: "Coins that rose 60–100% in a week", surgeOver100: "Coins that more than doubled in a week" };

  // Where to buy a mover: Coinbase if it's listed, else a swap site on the coin's own blockchain, plus "where it trades".
  const SWAP = {
    ethereum: (a) => ["Uniswap", `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${a}`],
    base: (a) => ["Uniswap (Base)", `https://app.uniswap.org/swap?chain=base&outputCurrency=${a}`],
    "arbitrum-one": (a) => ["Uniswap (Arbitrum)", `https://app.uniswap.org/swap?chain=arbitrum&outputCurrency=${a}`],
    "polygon-pos": (a) => ["Uniswap (Polygon)", `https://app.uniswap.org/swap?chain=polygon&outputCurrency=${a}`],
    "optimistic-ethereum": (a) => ["Uniswap (Optimism)", `https://app.uniswap.org/swap?chain=optimism&outputCurrency=${a}`],
    solana: (a) => ["Jupiter", `https://jup.ag/swap/SOL-${a}`],
    "binance-smart-chain": (a) => ["PancakeSwap", `https://pancakeswap.finance/swap?outputCurrency=${a}`],
    "the-open-network": (a) => ["STON.fi", `https://app.ston.fi/swap?ft=TON&tt=${a}`],
  };
  function buyLinks(x) {
    const out = [];
    if (x.onCoinbase) out.push(`<a class="pill dark" href="https://www.coinbase.com/advanced-trade/spot/${encodeURIComponent(x.sym)}-USD" target="_blank" rel="noopener">Buy on Coinbase ↗</a>`);
    const sw = x.address && SWAP[x.chain] ? SWAP[x.chain](encodeURIComponent(x.address)) : null;
    if (sw) out.push(`<a class="pill dark" href="${esc(sw[1])}" target="_blank" rel="noopener" title="Opens the swap with this exact token (${esc(x.address)})">Buy on ${esc(sw[0])} ↗</a>`);
    out.push(`<a class="pill-link" href="${esc(x.url)}#markets" target="_blank" rel="noopener">Where it trades ↗</a>`);
    return out.join("");
  }

  function momentum(x) {
    if (x.ch24 <= -20) return ["down", "Crashing now"];
    if (x.ch24 < -5) return ["down", "Dropping back"];
    if (x.ch24 < 5) return ["", "Cooling off"];
    return ["up", "Still climbing"];
  }

  // ── Upcoming: young coins getting early traction ──
  let mode = store.get("trenchMode", "upcoming"), up = null, upAt = 0;
  const ageTxt = (h) => (h < 1 ? Math.round(h * 60) + " min" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " days");
  const pctTxt = (v) => (v == null ? "–" : (v >= 0 ? "+" : "") + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + "%");
  async function loadUp(force) {
    if (!force && up && Date.now() - upAt < 4 * 60000) return renderUp();
    $("trenchStatus").textContent = "Scanning new trading pools on 8 blockchains…";
    try {
      const r = await fetch("/api/trench?mode=upcoming" + (window.isPro?.() ? "&full=1" : ""), { credentials: "same-origin" });
      const d = await r.json(); if (!r.ok) throw new Error(d.reason || "HTTP " + r.status);
      up = d; upAt = Date.now();
      $("trenchStatus").textContent = "Updated " + new Date(d.updated).toLocaleTimeString() + " · refreshes every 5 minutes";
    } catch (e) { $("trenchStatus").textContent = "Scanner unavailable: " + e.message; }
    renderUp();
  }
  function safetyLink(x) {
    if (!x.address) return "";
    if (x.network === "solana") return `<a class="pill-link" href="https://rugcheck.xyz/tokens/${encodeURIComponent(x.address)}" target="_blank" rel="noopener">Safety check ↗</a>`;
    if (["eth", "bsc", "base"].includes(x.network)) return `<a class="pill-link" href="https://honeypot.is/?address=${encodeURIComponent(x.address)}" target="_blank" rel="noopener">Safety check ↗</a>`;
    return "";
  }
  // Picks: the coins on this list with the best mix of traction and fewest red flags.
  function picksHtml(items, kind) {
    if (!items.length) return "";
    const head = (t, sub) => `<div class="picks-head"><h2>${icon("star")} ${t}</h2><span class="muted">${sub}</span></div>`;
    const note = `<p class="picks-note">Chosen automatically from this list. These are still very high-risk bets, not recommendations; most fail. Only use money you can lose.</p>`;
    if (kind === "upcoming") {
      const bad = /Thin liquidity|More sellers|Already up|Tiny/;
      const ok = items.filter((x) => !x.flags.some((f) => bad.test(f))).sort((a, b) => b.score - a.score).slice(0, 2);
      if (!ok.length) return head("No standout picks right now", "Upcoming") + `<p class="picks-none">Every coin on the list has a serious warning flag (thin liquidity, more sellers than buyers, or already exploded). The app's suggestion is to wait for a cleaner setup.</p>` + note;
      return head("Top picks from Upcoming", "Strongest traction with the fewest warning flags") + `<div class="pick-list">${ok.map((x, i) => `<a class="pick" href="#up-${esc(x.address || x.sym)}" data-tkey="up:${esc(x.pool)}">
          <span class="pick-top">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" />` : coinIcon(x.sym.replace(/[^A-Za-z0-9]/g, ""), 32)}<span><b>${esc(x.sym)}</b><span class="muted small">${esc(x.netName)} · ${ageTxt(x.ageH)} old</span></span><span class="badge b-SELL">Risk: ${esc(x.risk)}</span></span>
          <span class="rank">#${i + 1} pick</span>
          <ul><li>${x.buyers.toLocaleString()} buyers in 24h, ${Math.round(x.buyRatio * 100)}% buying</li><li>${money(x.vol24)} traded, ${money(x.liq)} liquidity</li>${x.accel >= 1.5 ? "<li>Busier than usual this hour</li>" : ""}</ul></a>`).join("")}</div>` + note;
    }
    // Big movers: our study says chasing loses on average, so only coins on Coinbase, not "very high" risk, not crashing.
    const ok = items.filter((x) => x.onCoinbase && x.risk !== "very high" && x.ch24 > -5).sort((a, b) => a.ch7 - b.ch7).slice(0, 2);
    if (!ok.length) return head("No standout picks right now", "Big movers") + `<p class="picks-none">Every big mover is either very high chase risk, not on Coinbase, or falling today. In our study, buying coins after a run-up like this lost money about 3 times out of 4, so the app's suggestion is to wait.</p>` + note;
    return head("Least risky big movers", "On Coinbase, smaller run-ups, not falling today") + `<div class="pick-list">${ok.map((x, i) => `<button class="pick" data-trench-open="${esc(x.sym)}">
        <span class="pick-top">${coinIcon(x.sym, 32)}<span><b>${esc(x.sym)}</b><span class="muted small">${esc(x.name)}</span></span><span class="badge b-HOLD">Chase risk: ${esc(x.risk)}</span></span>
        <span class="rank">#${i + 1} pick</span>
        <ul><li>Up ${x.ch7.toFixed(0)}% in 7 days, ${x.ch24 >= 0 ? "+" : ""}${x.ch24.toFixed(1)}% today</li><li>On Coinbase: tap to see its full signal</li></ul></button>`).join("")}</div>` + note;
  }

  function renderUp() {
    $("trenchStudy").innerHTML = `<div class="ts-head"><b>Upcoming coins: early, and very risky</b>
        <span class="muted">New coins (under 3 weeks old) that are starting to get real traction: enough cash in the pool to trade, real volume, hundreds of different buyers, and not already dumping. Found earlier than the "Big movers" list.</span></div>
      <p class="muted small" style="margin:0">Most new coins lose most of their value within weeks, and many are scams: the creators sell everything, or the token can't be sold at all. This list shows coins with early traction; it can't tell you which will last. Run the safety check, only use money you can lose, and expect most picks to fail.</p>`;
    const cb = $("trenchCB")?.closest("label"); if (cb) cb.hidden = true;
    if (!up) return;
    $("trenchPicks").innerHTML = picksHtml(up.coins, "upcoming");
    $("trenchList").innerHTML = up.coins.length ? up.coins.map((x) => {
      const buy = x.address && SWAP[x.chain] ? SWAP[x.chain](encodeURIComponent(x.address)) : null;
      return `<article class="tcard tc-click" id="up-${esc(x.address || x.sym)}" data-tkey="up:${esc(x.pool)}" tabindex="0" role="button" aria-label="Open ${esc(x.sym)}">
        <div class="row"><span class="up-head">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" onerror="this.replaceWith(document.createRange().createContextualFragment(window.coinIcon('${esc(x.sym.replace(/[^A-Za-z0-9]/g, "").slice(0, 6))}', 36)))" />` : coinIcon(x.sym.replace(/[^A-Za-z0-9]/g, ""), 36)}<span><b>${esc(x.sym)}</b><span class="muted">${esc(x.name)} · ${esc(x.netName)}</span></span></span>
          <span class="badge b-SELL">Risk: ${esc(x.risk)}</span></div>
        <div class="tc-tags"><span class="tag2 up">${esc(x.stage)}</span><span class="tag2">${ageTxt(x.ageH)} old</span>${x.ch1 != null ? `<span class="tag2 ${x.ch1 >= 0 ? "up" : "down"}">Last hour ${pctTxt(x.ch1)}</span>` : ""}${x.accel >= 1.5 ? `<span class="tag2 up">Busier than usual this hour</span>` : ""}</div>
        <div class="up-stats">
          <div><span class="muted">Price</span><b>${fmt(x.price)}</b></div>
          <div><span class="muted">24h change</span><b class="${(x.ch24 ?? 0) >= 0 ? "up" : "down"}">${pctTxt(x.ch24)}</b></div>
          <div><span class="muted">Valued at</span><b>${x.fdv != null ? money(x.fdv) : "–"}</b></div>
          <div><span class="muted">Liquidity</span><b>${money(x.liq)}</b></div>
          <div><span class="muted">Volume 24h</span><b>${money(x.vol24)}</b></div>
          <div><span class="muted">Buyers 24h</span><b>${x.buyers.toLocaleString()}</b></div>
        </div>
        <div title="${x.buyers} buyers vs ${x.sellers} sellers in 24 hours"><div class="bs-bar"><i style="width:${Math.round(x.buyRatio * 100)}%"></i></div>
          <p class="up-traction">${Math.round(x.buyRatio * 100)}% of traders in the last 24h were buyers (${x.buyers.toLocaleString()} buyers, ${x.sellers.toLocaleString()} sellers)</p></div>
        ${x.flags.length ? `<ul class="up-flags">${x.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        <div class="tc-actions">
          ${buy ? `<a class="pill dark" href="${esc(buy[1])}" target="_blank" rel="noopener">Buy on ${esc(buy[0])} ↗</a>` : ""}
          <a class="pill-link" href="${esc(x.url)}" target="_blank" rel="noopener">Chart ↗</a>${safetyLink(x)}</div>
        ${x.address ? `<p class="muted small tc-addr">Token: <code>${esc(x.address.slice(0, 6))}…${esc(x.address.slice(-4))}</code>. Check it matches before you swap; copycat tokens are common.</p>` : ""}
      </article>`;
    }).join("") + (up.locked ? `<article class="tcard tc-locked">${icon("lock")}<b>${up.locked} more upcoming coin${up.locked === 1 ? "" : "s"}</b>
        <span class="muted">Pro shows the whole list, rescanned every 5 minutes.</span><button class="primary pill" data-pw="show">See all with Pro</button></article>` : "")
      : `<p class="muted">No new coins pass the traction checks right now. That happens; it's better than showing junk.</p>`;
  }
  function setMode(m) {
    mode = m; store.set("trenchMode", m);
    document.querySelectorAll("[data-tmode]").forEach((b) => b.classList.toggle("on", b.dataset.tmode === m));
    const cb = $("trenchCB")?.closest("label"); if (cb) cb.hidden = m === "upcoming";
    $("trenchList").innerHTML = ""; $("trenchPicks").innerHTML = "";
    load();
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-tmode]"); if (b) setMode(b.dataset.tmode); });

  async function load(force) {
    if (location.protocol === "file:") return;
    if (mode === "upcoming") return loadUp(force);
    if (!force && data && Date.now() - loadedAt < 4 * 60000) return render2();
    $("trenchStatus").textContent = "Scanning the market…";
    try {
      const [t, s] = await Promise.all([
        fetch("/api/trench" + (window.isPro?.() ? "?full=1" : ""), { credentials: "same-origin" }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.reason || "HTTP " + r.status); return d; }),
        stats ? stats : fetch("trench-stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      data = t; stats = s; loadedAt = Date.now();
      $("trenchStatus").textContent = "Updated " + new Date(t.updated).toLocaleTimeString() + " · refreshes every 5 minutes";
    } catch (e) { $("trenchStatus").textContent = "Scanner unavailable: " + e.message; }
    render2();
  }

  function render2() {
    if (mode === "upcoming") return renderUp();
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
    $("trenchPicks").innerHTML = picksHtml(data.movers, "movers");
    const list = data.movers.filter((x) => !onlyCoinbase || x.onCoinbase);
    $("trenchList").innerHTML = list.length ? list.map((x) => {
      const [mc, mt] = momentum(x), b = stats?.buckets?.[x.bucket];
      return `<article class="tcard tc-click" data-tkey="mv:${esc(x.id)}" tabindex="0" role="button" aria-label="Open ${esc(x.sym)}">
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
          ${buyLinks(x)}
          ${x.onCoinbase ? `<button class="pill" data-trench-open="${esc(x.sym)}">Look closer</button>` : ""}</div>
        ${x.address ? `<p class="muted small tc-addr">Token: <code>${esc(x.address.slice(0, 6))}…${esc(x.address.slice(-4))}</code> on ${esc(x.chain)}. Check it matches before you swap; copycat tokens with the same name are common.</p>` : ""}
      </article>`;
    }).join("") + (data.locked ? `<article class="tcard tc-locked">${icon("lock")}<b>${data.locked} more coin${data.locked === 1 ? " is" : "s are"} making a big move</b>
        <span class="muted">Pro shows the full list, refreshed every 5 minutes, plus the Coinbase-only filter.</span><button class="primary pill" data-pw="show">See all movers with Pro</button></article>` : "")
      : `<p class="muted">No coins are making a big move right now${onlyCoinbase ? " on Coinbase" : ""}. That's normal in quiet or falling markets.</p>`;
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
  $("trenchCB").onchange = () => {
    if ($("trenchCB").checked && !window.proGate?.("The Coinbase-only filter")) { $("trenchCB").checked = false; return; }
    onlyCoinbase = $("trenchCB").checked; store.set("trenchCB", onlyCoinbase); render2();
  };
  document.querySelectorAll("[data-tmode]").forEach((b) => b.classList.toggle("on", b.dataset.tmode === mode));
  document.addEventListener("plan-changed", () => { if (!window.isPro?.()) { onlyCoinbase = false; $("trenchCB").checked = false; } data = null; up = null; if (!document.querySelector('[data-tab="trench"]').hidden) load(true); });
  $("trenchRefresh").onclick = () => load(true);
  window.loadTrench = load;

  // ── Coin page for a Trench coin (most aren't on Coinbase, so it has its own page) ──
  const find = (key) => key.startsWith("up:") ? [up?.coins?.find((c) => "up:" + c.pool === key), "up"] : [data?.movers?.find((c) => "mv:" + c.id === key), "mv"];
  const kv = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const chg = (v) => (v == null ? "–" : `<span class="${v >= 0 ? "up" : "down"}">${pctTxt(v)}</span>`);
  function openTrenchCoin(key) {
    const [x, kind] = find(key);
    if (!x) return;
    if (kind === "mv" && x.onCoinbase) { o_open(x.sym); return; } // listed on Coinbase: the full mainstream page
    if (typeof selected !== "undefined" && selected) { selected = null; render(); } // one chart at a time
    const el = $("tdetail");
    el.hidden = false; el.scrollTop = 0;
    document.body.classList.add("detailOpen");
    if (!history.state?.tcoin) history.pushState({ tcoin: key }, "");
    const icon36 = x.image ? `<img class="ah-img" src="${esc(x.image)}" alt="" />` : coinIcon(x.sym.replace(/[^A-Za-z0-9]/g, ""), 32);
    const swap = x.address && SWAP[x.chain] ? SWAP[x.chain](encodeURIComponent(x.address)) : null;
    const risk = kind === "up" ? `<span class="badge b-SELL sig-big">Risk: ${esc(x.risk)}</span>` : `<span class="badge ${x.risk === "very high" ? "b-SELL" : "b-HOLD"} sig-big">Chase risk: ${esc(x.risk)}</span>`;
    const flags = kind === "up" ? x.flags : [momentum(x)[1], x.risk === "very high" ? "A very big or very frantic move: chasing these has gone worst" : "A big move: most of it has usually already happened"];
    const stats = kind === "up"
      ? [kv("Price", fmt(x.price)), kv("Last hour", chg(x.ch1)), kv("6 hours", chg(x.ch6)), kv("24 hours", chg(x.ch24)), kv("Valued at", x.fdv != null ? money(x.fdv) : "–"),
         kv("Liquidity", money(x.liq)), kv("Volume 24h", money(x.vol24)), kv("Volume last hour", money(x.vol1)), kv("Buyers / sellers 24h", `${x.buyers.toLocaleString()} / ${x.sellers.toLocaleString()}`),
         kv("Age", ageTxt(x.ageH)), kv("Blockchain", esc(x.netName)), kv("Stage", esc(x.stage))]
      : [kv("Price", fmt(x.price)), kv("24 hours", chg(x.ch24)), kv("7 days", chg(x.ch7)), kv("Volume 24h", money(x.volume)), kv("Market value", money(x.marketCap)),
         kv("Rank", x.rank ? "#" + x.rank : "–"), kv("Traded vs value", Math.round(x.turnover * 100) + "%"), kv("Trending", x.trendingRank ? "#" + x.trendingRank : "No"), kv("On Coinbase", x.onCoinbase ? "Yes" : "No")];
    el.innerHTML = `
      <nav class="dnav"><div class="dnav-top"><button class="dback" data-tclose aria-label="Back to Trench">← <span>Trench</span></button></div></nav>
      <div class="detailHead">
        <div class="ah-name">${icon36}<b>${esc(x.name || x.sym)}</b><span class="muted">${esc(x.sym)}${kind === "up" ? " · " + esc(x.netName) : ""}</span></div>
        <div class="ah-px">${fmt(x.price)}</div>
        <div class="ah-chg ${(x.ch24 ?? 0) >= 0 ? "up" : "down"}">${(x.ch24 ?? 0) >= 0 ? "↗" : "↘"} ${pctTxt(x.ch24)} <span class="muted">past 24 hours</span></div>
      </div>
      <div class="ov-grid">
        <div class="ov-chart">
          <div id="tChart"><p class="muted" style="padding:40px 0">Loading the price chart…</p></div>
          <div class="muted small" id="tChartNote"></div>
        </div>
        <aside class="ov-side">
          <div class="side-box">${risk}${flags.length ? `<ul class="up-flags">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
            <span class="muted small">${kind === "up" ? "New coins are the riskiest thing in crypto: most fail and many are scams." : "In our study, buying after a run-up like this lost money about 3 times out of 4."}</span></div>
          <div class="side-box act-box">
            ${swap ? `<a class="btn-primary" href="${esc(swap[1])}" target="_blank" rel="noopener">Buy on ${esc(swap[0])} ↗</a>` : ""}
            ${kind === "mv" ? `<a class="btn-primary${swap ? " alt" : ""}" href="${esc(x.url)}#markets" target="_blank" rel="noopener">Where it trades ↗</a>` : ""}
            ${safetyLink(x) ? safetyLink(x).replace('class="pill-link"', 'class="side-btn"') : ""}
            <a class="side-btn" href="${esc(x.url)}" target="_blank" rel="noopener">${kind === "up" ? "Live chart on GeckoTerminal ↗" : "CoinGecko page ↗"}</a>
            ${x.address ? `<button class="side-btn" data-tcopy="${esc(x.address)}">Copy token address</button><span class="muted small">Token: <code>${esc(x.address.slice(0, 8))}…${esc(x.address.slice(-6))}</code>. Check it matches in your wallet before you swap; copycats are common.</span>` : ""}
          </div>
          <div class="side-box stats-box"><h3>Stats</h3><dl class="mstats">${stats.join("")}</dl></div>
        </aside>
      </div>`;
    const q = kind === "up" ? `network=${encodeURIComponent(x.network)}&pool=${encodeURIComponent(x.pool)}` : `id=${encodeURIComponent(x.id)}`;
    const direct = async () => {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(x.network)}/pools/${encodeURIComponent(x.pool)}/ohlcv/hour?aggregate=1&limit=500&currency=usd`, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const list = (await r.json()).data?.attributes?.ohlcv_list || [];
      return { candles: list.map(([t, o, h, l, c, v]) => ({ time: t, open: +o, high: +h, low: +l, close: +c, volume: +v })).filter((c) => c.close > 0).sort((a, b) => a.time - b.time), interval: "1h", source: "GeckoTerminal" };
    };
    fetch("/api/trench?mode=chart&" + q).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.candles?.length) return d;
      if (kind === "up") return direct(); // our server was rate-limited or blocked: try from this device
      throw new Error(d.reason || "HTTP " + r.status);
    }).then((d) => {
      if (el.hidden || history.state?.tcoin !== key) return;
      const c = d.candles || [];
      if (c.length < 5) { $("tChart").innerHTML = `<p class="muted" style="padding:40px 0">Not enough price history yet: this coin is very new.</p>`; return; }
      Draw.mount($("tChart"), "TRENCH:" + x.sym, c, []);
      let note = `${c.length} ${d.interval === "1h" ? "hourly" : "4-hour"} candles from ${esc(d.source)}.`;
      if (c.length >= 60 && window.Indicators?.analyze) {
        try { const a = Indicators.analyze(c); note += ` Trend on this chart: <span class="${actionClass(a.action)}">${a.action}</span> (from the same signals as the main list, on a short history, so treat it lightly).`; } catch {}
      }
      $("tChartNote").innerHTML = note;
    }).catch(() => { $("tChart").innerHTML = `<p class="muted" style="padding:40px 0">Couldn't load the price chart right now.</p>`; });
  }
  const o_open = async (sym) => {
    if (!coins.includes(sym)) { coins.push(sym); store.set("coins", coins); }
    if (!results[sym]) { try { results[sym] = await analyzeCoin(sym); } catch (err) { results[sym] = { error: err.message }; } }
    openCoin(sym);
  };
  function closeTrenchCoin(fromHistory) {
    const el = $("tdetail");
    if (el.hidden) return;
    el.hidden = true; el.innerHTML = "";
    document.body.classList.remove("detailOpen");
    if (!fromHistory && history.state?.tcoin) history.back();
  }
  window.closeTrenchCoin = closeTrenchCoin;
  window.openTrenchCoin = openTrenchCoin;
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-tclose]")) return closeTrenchCoin();
    const cp = t.closest("[data-tcopy]");
    if (cp) { navigator.clipboard?.writeText(cp.dataset.tcopy).then(() => window.toast?.("Token address copied."), () => window.toast?.(cp.dataset.tcopy)); return; }
    const k = t.closest("[data-tkey]");
    if (k && !t.closest("a:not([data-tkey]), button:not([data-tkey]), input, label")) { e.preventDefault(); openTrenchCoin(k.dataset.tkey); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTrenchCoin();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".tc-click")) { e.preventDefault(); openTrenchCoin(e.target.dataset.tkey); }
  });
  window.addEventListener("popstate", () => { if (!history.state?.tcoin) closeTrenchCoin(true); });
  setInterval(() => { if (!document.querySelector('[data-tab="trench"]').hidden) load(true); }, 5 * 60000);
  document.addEventListener("currency-changed", () => { if (typeof data !== "undefined" && data) render2(); });
})();

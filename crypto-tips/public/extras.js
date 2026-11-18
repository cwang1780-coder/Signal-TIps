// Price alerts + social buzz panel.
// Uses globals from app.js: results, allSyms, store, $, fmt, selected, actionClass.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = (t) => {
    const m = Math.round((Date.now() - Date.parse(t)) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago";
  };

  // ───────────── Price alerts ─────────────
  // alert: {id, sym, type: above|below|move|buy|sell|hype, value, triggeredAt}
  let alerts = store.get("alerts", []);
  const save = () => store.set("alerts", alerts);

  const TYPES = {
    above: { label: "price goes above", needsValue: "$", test: (a, r) => r.price >= a.value, text: (a) => `${a.sym} above ${fmt(a.value)}` },
    below: { label: "price drops below", needsValue: "$", test: (a, r) => r.price <= a.value, text: (a) => `${a.sym} below ${fmt(a.value)}` },
    move: { adv: true, label: "moves more than ±% in a day", needsValue: "%", test: (a, r) => Math.abs(r.change24 * 100) >= a.value, text: (a) => `${a.sym} moves ±${a.value}% in 24h` },
    buy: { label: "signal turns BUY", test: (a, r) => r.action.includes("BUY"), text: (a) => `${a.sym} signal turns BUY` },
    sell: { label: "signal turns SELL", test: (a, r) => r.action.includes("SELL"), text: (a) => `${a.sym} signal turns SELL` },
    hype: { adv: true, label: "social hype gets high", test: (a, r, s) => s && ["high", "very high"].includes(s.hype), text: (a) => `${a.sym} social hype high` },
  };

  function describeHit(a, r, s) {
    if (a.type === "hype") return `${a.sym}: social hype is ${s.hype} (${s.postsPerHour ?? "?"} posts/hr, ${s.bullishPct ?? "?"}% bullish). Price ${fmt(r?.price)}.`;
    return `${a.sym} is ${fmt(r.price)} (${r.change24 >= 0 ? "+" : ""}${(r.change24 * 100).toFixed(2)}% 24h) · signal ${r.action}.`;
  }

  function notify(title, body) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<b>${icon("bell")} ${esc(title)}</b><div>${esc(body)}</div>`;
    t.onclick = () => t.remove();
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), 20000);
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag: title });
    } catch {}
  }

  function checkAlerts() {
    let changed = false;
    for (const a of alerts) {
      if (a.triggeredAt) continue;
      const r = results[a.sym], s = social.coins?.[a.sym];
      if (a.type === "hype" ? !s || s.error : !r || r.error) continue;
      if (TYPES[a.type].test(a, r, s)) {
        a.triggeredAt = Date.now();
        a.hit = describeHit(a, r, s);
        notify(TYPES[a.type].text(a), a.hit);
        changed = true;
      }
    }
    if (changed) { save(); renderAlerts(); }
  }

  function renderAlerts() {
    const typeSel = $("alType").value;
    $("alValue").hidden = !TYPES[typeSel].needsValue;
    $("alValue").placeholder = TYPES[typeSel].needsValue === "%" ? "e.g. 5" : `Price in ${Currency.code}`;
    const syms = allSyms();
    const cur = $("alSym").value;
    $("alSym").innerHTML = syms.map((s) => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("");
    $("alList").innerHTML = alerts.length
      ? alerts.map((a) => `<li class="${a.triggeredAt ? "hit" : ""}">
          <span>${icon(a.triggeredAt ? "check" : "clock")} <b>${esc(TYPES[a.type].text(a))}</b>
          ${a.triggeredAt ? `<span class="muted">— triggered ${ago(new Date(a.triggeredAt).toISOString())}: ${esc(a.hit || "")}</span>` : results[a.sym]?.price ? `<span class="muted">— now ${fmt(results[a.sym].price)}</span>` : ""}</span>
          <span>${a.triggeredAt ? `<button data-rearm="${a.id}">Re-arm</button>` : ""}<button class="x" data-del="${a.id}" title="Delete">✕</button></span>
        </li>`).join("")
      : `<li class="muted">No alerts yet. Pick a coin and what to watch for above. Example: tell me when BTC drops below $60,000.</li>`;
    const waiting = alerts.filter((a) => !a.triggeredAt).length;
    $("alCount").hidden = !waiting; $("alCount").textContent = waiting;
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    $("alNotify").hidden = perm !== "default";
    $("alNote").textContent = perm === "granted"
      ? "Phone/desktop notifications are on. Alerts are checked every minute while this page is open (it can be in a background tab)."
      : "Alerts show on this page and are checked every minute while it's open (it can be in a background tab).";
  }

  window.hasAlert = (sym, value) => alerts.some((a) => a.sym === sym && a.value === value && (a.type === "above" || a.type === "below") && !a.triggeredAt);
  // Used by chart drawings: turn a price level into an alert.
  window.addAlert = (sym, type, value) => {
    if (!TYPES[type] || alerts.some((a) => a.sym === sym && a.type === type && a.value === value && !a.triggeredAt)) return true;
    alerts.push({ id: Date.now().toString(36), sym, type, value, triggeredAt: null });
    save(); renderAlerts(); checkAlerts();
    return true;
  };

  // Beginners see the basic alert types; experienced traders also get 24h moves and social hype.
  window.renderAlertTypes = () => {
    const pro = window.userLevel?.() === "pro", cur = $("alType").value;
    $("alType").innerHTML = Object.entries(TYPES).filter(([, t]) => pro || !t.adv).map(([k, t]) => `<option value="${k}"${k === cur ? " selected" : ""}>${t.label}</option>`).join("");
    renderAlerts();
  };
  window.renderAlertTypes();
  $("alType").onchange = renderAlerts;
  $("alForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = $("alType").value, sym = $("alSym").value, typed = parseFloat($("alValue").value);
    const value = TYPES[type].needsValue === "$" ? Currency.toUsd(typed) : typed; // prices are stored in USD
    if (!sym || (TYPES[type].needsValue && !(value > 0))) { $("alValue").focus(); return; }
    alerts.push({ id: Date.now().toString(36), sym, type, value: TYPES[type].needsValue ? value : null, triggeredAt: null });
    $("alValue").value = "";
    save(); renderAlerts(); checkAlerts();
  });
  $("alList").addEventListener("click", (e) => {
    const { del, rearm } = e.target.dataset;
    if (del) alerts = alerts.filter((a) => a.id !== del);
    if (rearm) { const a = alerts.find((x) => x.id === rearm); if (a) { a.triggeredAt = null; a.hit = null; } }
    if (del || rearm) { save(); renderAlerts(); checkAlerts(); }
  });
  $("alNotify").onclick = async () => {
    try { await Notification.requestPermission(); } catch {}
    renderAlerts();
  };

  // ───────────── Social buzz ─────────────
  let social = { coins: {}, trending: [] };
  let openSym = null;
  const HYPE_CLASS = { low: "h-low", moderate: "h-mod", high: "h-high", "very high": "h-vhigh" };

  async function loadSocial() {
    if (location.protocol === "file:") { $("socStatus").textContent = "Social buzz needs the server: run node server.js."; return; }
    const syms = allSyms().slice(0, 15);
    if (!syms.length) return;
    $("socStatus").textContent = "Loading social posts…";
    try {
      const res = await fetch("/api/social?coins=" + syms.join(","));
      const d = await res.json();
      if (!res.ok) throw new Error(d.reason || "HTTP " + res.status);
      social = d;
      $("socStatus").textContent = "Updated " + new Date(d.updated).toLocaleTimeString() + " · refreshes every 5 min";
    } catch (e) {
      $("socStatus").textContent = "Social data unavailable: " + e.message;
    }
    renderSocial();
    renderDetailSocial(selected);
    checkAlerts();
  }

  function crowdVsChart(s, r) {
    if (!s || s.error || !r || r.error || s.bullishPct == null || s.tagged < 5) return "";
    if (s.bullishPct >= 75 && r.action.includes("SELL")) return `<div class="warn">${icon("alert")} Crowd is ${s.bullishPct}% bullish but the chart signal says ${r.action}. Hype and price are disagreeing.</div>`;
    if (s.bullishPct <= 35 && r.action.includes("BUY")) return `<div class="note">The crowd is gloomy (${s.bullishPct}% bullish) while the chart says ${r.action}. Some traders see that as a contrarian opportunity.</div>`;
    if (s.bullishPct >= 85 && s.hype !== "low") return `<div class="warn">${icon("alert")} Almost everyone is bullish. Extreme one-sided hype often comes before a pullback. Be careful chasing it.</div>`;
    return "";
  }

  function moodBar(s) {
    if (s.bullishPct == null) return `<span class="muted">not enough tagged posts</span>`;
    return `<span class="mood" title="${s.bullish} bullish / ${s.bearish} bearish of the latest posts"><i style="width:${s.bullishPct}%"></i></span>
      <span class="muted">${s.bullishPct}% bullish <small>(${s.tagged} posts)</small></span>`;
  }

  function postsHtml(s) {
    if (!s.posts?.length) return `<div class="muted">No recent posts.</div>`;
    return `<ul class="posts">${s.posts.map((p) => `<li>
      <div class="row"><span><b>@${esc(p.user)}</b> ${p.sentiment ? `<span class="tag ${p.sentiment === "Bullish" ? "bull" : "bear"}">${esc(p.sentiment)}</span>` : ""}</span>
      <span class="muted">${esc(ago(p.time))}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}</span></div>
      <div>${esc(p.text)}</div></li>`).join("")}</ul>
      <a class="more" href="${esc(s.url)}" target="_blank" rel="noopener">See all posts on StockTwits ↗</a>`;
  }

  function renderSocial() {
    const t = social.trending || [];
    const mine = new Set(allSyms());
    $("socTrending").innerHTML = t.length
      ? `<span class="muted">Trending searches on CoinGecko:</span> ` + t.map((c) => `<a class="chip ${mine.has(c.symbol) ? "mine" : ""}" href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.name)}${c.marketCapRank ? " · market cap #" + c.marketCapRank : " · tiny / unranked coin"}">#${c.rank} ${esc(c.symbol)}${c.change24hPct != null ? ` <span class="${c.change24hPct >= 0 ? "up" : "down"}">${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct}%</span>` : ""}</a>`).join("")
      : social.trendingError ? `<span class="muted">Trending list unavailable (${esc(social.trendingError)}).</span>` : "";

    const rows = allSyms().slice(0, 15).map((sym) => {
      const s = social.coins?.[sym];
      if (!s) return "";
      const r = results[sym];
      const open = openSym === sym;
      return `<div class="soc ${open ? "open" : ""}" data-soc="${sym}">
        <div class="socrow">
          <b class="sym">${window.coinIcon ? window.coinIcon(sym, 24) : ""} ${sym}</b>
          <span class="badge ${HYPE_CLASS[s.hype]}">Hype: ${s.hype}</span>
          ${s.error ? `<span class="muted">${esc(s.error)}</span>` : `${moodBar(s)}<span class="muted">${s.postsPerHour ?? "?"} posts/hr</span>`}
          ${s.trendingRank ? `<span class="badge h-high">${icon("flame")} Trending #${s.trendingRank}</span>` : ""}
          ${r?.action ? `<span class="${actionClass(r.action)}">Chart: ${r.action}</span>` : ""}
          <span class="muted caret">${open ? "▲" : "▼ posts"}</span>
        </div>
        ${crowdVsChart(s, r)}
        ${open && !s.error ? postsHtml(s) : ""}
      </div>`;
    }).join("");
    $("socList").innerHTML = rows || `<div class="muted">Loading…</div>`;
  }

  function renderDetailSocial(sym) {
    const el = document.getElementById("detailSocial");
    if (!el || !sym) return;
    const s = social.coins?.[sym];
    if (!s) { el.innerHTML = `<h2>What people are saying</h2><div class="muted">Loading social posts…</div>`; return; }
    if (s.error) { el.innerHTML = `<h2>What people are saying</h2><div class="muted">${esc(s.error)}</div>`; return; }
    el.innerHTML = `<h2>What people are saying <span class="badge ${HYPE_CLASS[s.hype]}">Hype: ${s.hype}</span></h2>
      <div class="socrow">${moodBar(s)}<span class="muted">${s.postsPerHour ?? "?"} posts/hr</span>${s.trendingRank ? `<span class="badge h-high">${icon("flame")} Trending #${s.trendingRank}</span>` : ""}</div>
      ${crowdVsChart(s, results[sym])}${postsHtml({ ...s, posts: s.posts.slice(0, 4) })}`;
  }

  $("socList").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-soc]");
    if (row) { openSym = openSym === row.dataset.soc ? null : row.dataset.soc; renderSocial(); }
  });

  // Compact social data for the AI (post text is untrusted user content; the server prompt says so).
  window.socialSnapshot = () => ({
    trendingOnCoinGecko: (social.trending || []).map((t) => ({ rank: t.rank, symbol: t.symbol, change24hPct: t.change24hPct, marketCapRank: t.marketCapRank })),
    coins: Object.fromEntries(Object.entries(social.coins || {}).map(([sym, s]) => [sym, s.error ? { error: s.error } : {
      hype: s.hype, bullishPct: s.bullishPct, taggedPosts: s.tagged, postsPerHour: s.postsPerHour, trendingRank: s.trendingRank,
      recentPosts: s.posts.slice(0, 3).map((p) => ({ sentiment: p.sentiment, text: p.text.slice(0, 200) })),
    }])),
  });
  window.renderDetailSocial = renderDetailSocial;

  // Hooks from app.js
  document.addEventListener("currency-changed", () => renderAlerts());
  document.addEventListener("prices-updated", () => {
    renderAlerts(); checkAlerts();
    const missing = allSyms().slice(0, 15).some((s) => !(s in (social.coins || {})));
    if (missing) loadSocial(); else renderSocial();
  });
  $("socRefresh").onclick = loadSocial;
  setInterval(loadSocial, 5 * 60 * 1000);
  renderAlerts();
  // "Set a price alert" from a coin's page: pick that coin and a price alert, ready to type the price.
  window.prefillAlert = (sym) => {
    if (![...$("alSym").options].some((o) => o.value === sym)) $("alSym").add(new Option(sym, sym));
    $("alSym").value = sym; $("alType").value = "above"; renderAlerts(); $("alValue").focus();
  };
})();

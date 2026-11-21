// "Your sell plan": for every coin you've said you own, when to take profit, where to cut a loss,
// and what's going on with it. Plus notifications when that advice changes:
// - while the app is open: an on-screen message and a phone/desktop notification
// - when it's closed: real push notifications (the server checks your coins on a schedule, push.js)
// Uses globals from app.js: results, store, $, fmt, fetchCandles, coinIcon, siteConfig.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plans = {}; // sym -> plan
  const daily = {}; // sym -> { at, candles }
  const LABEL = { stop: ["Sell", "b-SELL"], sell: ["Consider selling", "b-SELL"], target: ["Take profit", "b-HOLD"], hold: ["Hold", "b-BUY"], watch: ["Hold · watch", "b-HOLD"] };

  // One entry per coin, with the average price paid across the places you hold it (where known)
  function owned() {
    const by = {};
    for (const h of window.ownedCoins?.() || []) {
      const o = (by[h.sym] ||= { sym: h.sym, amt: 0, costAmt: 0, costSum: 0 });
      o.amt += +h.amt || 0;
      if (h.cost > 0) { o.costAmt += +h.amt || 0; o.costSum += h.cost * (+h.amt || 0); }
    }
    const paid = store.get("paidPrices", {}); // prices you typed in for coins that came without one (wallets)
    return Object.values(by).map((o) => ({ sym: o.sym, amt: o.amt, cost: o.costAmt ? o.costSum / o.costAmt : paid[o.sym] || 0, paidByHand: !o.costAmt && paid[o.sym] > 0 }));
  }

  async function dailyCandles(sym) {
    if ($("tf").value === "86400" && results[sym]?.candles?.length) return results[sym].candles;
    const d = daily[sym];
    if (d && Date.now() - d.at < 10 * 60_000) return d.candles;
    const candles = await fetchCandles(sym, 86400);
    daily[sym] = { at: Date.now(), candles };
    return candles;
  }

  // ── notifications while the app is open ──
  async function localNotify(sym, msg) {
    window.toast?.(`${msg.title}. ${msg.body}`);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body: msg.body, tag: "plan-" + sym, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: "/?coin=" + sym } };
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) return reg.showNotification(msg.title, opts); } catch {}
    try { new Notification(msg.title, opts); } catch {}
  }

  let busy = false;
  async function update() {
    if (busy) return; busy = true;
    try {
      const mine = owned(), states = store.get("planStates", {});
      for (const sym of Object.keys(plans)) if (!mine.some((o) => o.sym === sym)) delete plans[sym];
      for (const o of mine) {
        try { plans[o.sym] = SellPlan.plan(await dailyCandles(o.sym), { cost: o.cost }); } catch { plans[o.sym] = null; }
        const p = plans[o.sym];
        if (!p) continue;
        const msg = states[o.sym] ? SellPlan.message(o.sym, p, states[o.sym]) : null;
        states[o.sym] = p.state;
        if (msg) localNotify(o.sym, msg);
      }
      store.set("planStates", states);
      render();
      syncPush();
    } finally { busy = false; }
  }

  function levelRow(label, price, why, cls) {
    return `<div class="pl-lv ${cls}"><span>${label}</span><b>${fmt(price)}</b><span class="muted small">${esc(why)}</span></div>`;
  }
  function card(o, p) {
    if (!p) return `<div class="pl-card"><div class="pl-head">${coinIcon(o.sym, 28)}<b>${esc(o.sym)}</b><span class="muted small">Not enough price history on Coinbase to make a plan.</span></div></div>`;
    const [lab, cls] = LABEL[p.state];
    const value = p.price * o.amt;
    return `<div class="pl-card st-${p.state}">
      <div class="pl-head">${coinIcon(o.sym, 28)}<div><b>${esc(o.sym)}</b> <span class="muted small">${fmt(p.price)} · you hold ${fmt(value)}${p.gain != null ? ` · <span class="${p.gain >= 0 ? "up" : "down"}">${p.gain >= 0 ? "+" : ""}${(p.gain * 100).toFixed(1)}%</span>` : ""}</span></div>
        <span class="badge ${cls}">${lab}</span></div>
      <p class="pl-verdict"><b>${esc(p.verdict)}.</b> ${esc(p.detail)}</p>
      <div class="pl-levels">${levelRow("Take profit near", p.target, p.targetWhy, "tp")}${levelRow(p.price <= p.stop ? "Stop, already broken" : "Sell if it drops to", p.stop, p.stopWhy, "sl")}</div>
      ${!o.cost ? `<form class="pl-paid" data-plpaid="${esc(o.sym)}"><label>What did you pay per ${esc(o.sym)}? <span class="muted small">(adds profit/loss advice)</span></label><span><input type="number" step="any" min="0" placeholder="Price in ${esc(Currency.code)}" aria-label="Price you paid per ${esc(o.sym)}" /><button>Save</button></span></form>`
        : o.paidByHand ? `<p class="muted small">You paid ${fmt(o.cost)} each · <button class="linkbtn" data-plpaidclear="${esc(o.sym)}">change</button></p>` : ""}
      <details class="pl-ins"><summary>Insights on ${esc(o.sym)}</summary><ul>${p.insights.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
      <div class="pl-acts"><button data-plalert="${esc(o.sym)}">Alert me at these prices</button><button class="linkbtn" data-plopen="${esc(o.sym)}">Open chart →</button></div>
    </div>`;
  }

  function render() {
    const el = $("planList");
    if (!el) return;
    const mine = owned();
    $("planWrap").hidden = false;
    if (!window.isPro?.()) { // the sell plan and its notifications are Pro
      el.innerHTML = `<div class="pl-empty pro-lock"><b>Your sell plan is part of Pro.</b> For each coin you own${mine.length ? ` (${mine.map((o) => esc(o.sym)).join(", ")})` : ""}: when to take profit, where to sell to limit a loss, insights, and a phone notification when it's time. <button class="primary pill" data-pw-feature="Wallet sell plans">Unlock with Pro</button></div>`;
      const pb = $("pushBox"); if (pb) pb.hidden = true;
      return;
    }
    { const pb = $("pushBox"); if (pb) pb.hidden = false; }
    // Leftover "dust" (worth under $1) doesn't need advice
    const dust = mine.filter((o) => plans[o.sym] && plans[o.sym].price * o.amt < 1), shown = mine.filter((o) => !dust.includes(o));
    el.innerHTML = (shown.map((o) => card(o, plans[o.sym])).join("") + (dust.length ? `<p class="muted small pl-dust">Also tiny leftover amounts (under $1) of ${dust.map((o) => esc(o.sym)).join(", ")}, not worth acting on.</p>` : "")) ||
      `<div class="pl-empty"><b>Nothing to plan yet.</b> Connect your wallet above (paste its public address) or add a coin you own, and you'll get what to do with each coin: when to take profit, when to sell, and what's going on with it.</div>`;
    renderPush();
    const box = $("ownBox");
    if (box) fillOwnBox(box, box.dataset.sym);
  }

  // The box on a coin's page when you own it
  function fillOwnBox(box, sym) {
    const o = owned().find((x) => x.sym === sym), p = plans[sym];
    box.hidden = !o || !p || !window.isPro?.();
    if (!o || !p) return;
    const [lab, cls] = LABEL[p.state];
    box.innerHTML = `<span class="muted small">You own ${esc(sym)}${p.gain != null ? ` · ${p.gain >= 0 ? "up" : "down"} ${Math.abs(p.gain * 100).toFixed(1)}%` : ""}</span>
      <span class="badge ${cls} sig-big">${lab}</span><p><b>${esc(p.verdict)}.</b> ${esc(p.detail)}</p>
      <dl class="mstats"><div><dt>Take profit near</dt><dd>${fmt(p.target)}</dd></div><div><dt>${p.price <= p.stop ? "Stop (broken)" : "Sell if it drops to"}</dt><dd>${fmt(p.stop)}</dd></div></dl>
      <button class="linkbtn" data-go="coins">Your full sell plan →</button>`;
  }
  window.ownBoxHtml = (sym) => `<div class="side-box own-box" id="ownBox" data-sym="${esc(sym)}" hidden></div>`;
  window.fillOwnBox = () => { const b = $("ownBox"); if (b) fillOwnBox(b, b.dataset.sym); };

  // ── push notifications (work with the app closed) ──
  // In a browser: web push. Inside the iPhone app (Capacitor): Apple's own push notifications.
  const NP = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.PushNotifications : null;
  const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const post = (action, body) => fetch("/api/push?action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.reason || "Failed"); return d; });
  async function currentSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
  const payloadCoins = () => owned().map((o) => ({ sym: o.sym, cost: o.cost || 0, state: plans[o.sym]?.state || null }));
  const supported = () => (NP ? Boolean(siteConfig?.apnsPush) : Boolean(siteConfig?.pushKey) && pushOk());
  // How the server knows this device: { apns: token } in the app, { endpoint } in a browser
  async function deviceId() {
    if (NP) { const t = store.get("apnsToken", null); return t ? { apns: t } : null; }
    const sub = await currentSub();
    return sub ? { endpoint: sub.endpoint, sub } : null;
  }

  if (NP) {
    // Tapping a notification opens that coin; one arriving while the app is open shows as a message
    NP.addListener("pushNotificationActionPerformed", (a) => { const u = a?.notification?.data?.url; if (u && u.startsWith("/")) location.href = u; });
    NP.addListener("pushNotificationReceived", (n) => window.toast?.(`${n.title || ""}. ${n.body || ""}`));
  }
  function nativeToken() {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer from Apple's notification service")), 20000);
      const ok = await NP.addListener("registration", (t) => { clearTimeout(timer); ok.remove?.(); bad.remove?.(); resolve(t.value); });
      const bad = await NP.addListener("registrationError", (e) => { clearTimeout(timer); ok.remove?.(); bad.remove?.(); reject(new Error(e?.error || "registration failed")); });
      NP.register();
    });
  }

  let pushMsg = "";
  function renderPush() {
    const el = $("pushBox");
    if (!el) return;
    const on = store.get("pushOn", false);
    let html;
    if (!NP && siteConfig?.pushKey && !pushOk()) html = isIOS && !standalone
      ? `<p class="muted small">On iPhone, notifications work in the Signal Tips app, or once this site is on your Home Screen: tap Share, then <b>Add to Home Screen</b>, open it from there and come back here.</p>`
      : `<p class="muted small">This browser can't receive push notifications.</p>`;
    else if (!supported()) html = `<p class="muted small">Push notifications aren't switched on ${NP ? "in the app" : "for this site"} yet. While the app is open you'll still get a notification when the advice for a coin changes.</p>`;
    else if (on) html = `<p class="pl-on">✓ On. We'll notify this ${NP ? "iPhone" : "device"} when to sell or take profit on ${owned().map((o) => esc(o.sym)).join(", ") || "your coins"}, even when the app is closed.</p>
      <div class="pl-acts"><button data-push="test">Send a test</button><button class="linkbtn" data-push="off">Turn off</button></div>`;
    else html = `<p class="muted small">Get a notification on this ${NP ? "iPhone" : "device"} when one of your coins hits its stop, turns SELL, reaches its take-profit or recovers, even when the app is closed.</p>
      <div class="pl-acts"><button class="primary" data-push="on">Turn on notifications</button></div>`;
    el.innerHTML = html + (pushMsg ? `<p class="muted small">${esc(pushMsg)}</p>` : "") +
      `<p class="muted small">To do this, the coins you hold and the price you paid (not how much you hold) are kept on our server with this device's notification address. Turning off deletes them.</p>`;
  }

  let lastSent = "";
  async function syncPush(force) {
    if (!store.get("pushOn", false) || !supported()) return;
    const body = payloadCoins(), sig = JSON.stringify(body.map((c) => [c.sym, c.cost]));
    if (!force && sig === lastSent) return;
    const id = await deviceId();
    if (!id) { store.set("pushOn", false); renderPush(); return; }
    try { await post("subscribe", { ...(id.apns ? { apns: id.apns } : { subscription: id.sub.toJSON() }), coins: body }); lastSent = sig; } catch {}
  }

  async function pushOn() {
    pushMsg = "";
    try {
      let id;
      if (NP) {
        const perm = await NP.requestPermissions();
        if (perm.receive !== "granted") { pushMsg = "Notifications are off for Signal Tips. Turn them on in Settings > Notifications > Signal Tips, then try again."; return renderPush(); }
        const token = await nativeToken();
        store.set("apnsToken", token);
        id = { apns: token };
        await post("subscribe", { apns: token, coins: payloadCoins() });
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { pushMsg = "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again."; return renderPush(); }
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(siteConfig.pushKey) }));
        id = { endpoint: sub.endpoint };
        await post("subscribe", { subscription: sub.toJSON(), coins: payloadCoins() });
      }
      store.set("pushOn", true); lastSent = "";
      await post("test", id).catch(() => {});
      pushMsg = "Done. You should get a test notification in a moment.";
    } catch (e) { pushMsg = "Couldn't turn on notifications: " + e.message; }
    renderPush();
  }
  async function pushOff() {
    const id = await deviceId();
    if (id) await post("unsubscribe", id.apns ? { apns: id.apns } : { endpoint: id.endpoint }).catch(() => {});
    if (id?.sub) await id.sub.unsubscribe().catch(() => {});
    store.set("pushOn", false); pushMsg = "Notifications are off and your coins were removed from our server."; renderPush();
  }
  async function pushTest() {
    const id = await deviceId();
    pushMsg = id ? ((await post("test", id.apns ? { apns: id.apns } : { endpoint: id.endpoint }).catch(() => ({}))).ok ? "Test sent." : "The test didn't go through. Try turning notifications off and on.") : "Not subscribed on this device.";
    renderPush();
  }

  document.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-plpaid]");
    if (!f) return;
    e.preventDefault();
    const v = parseFloat(f.querySelector("input").value);
    if (!(v > 0)) return f.querySelector("input").focus();
    const paid = store.get("paidPrices", {}); paid[f.dataset.plpaid] = Currency.toUsd(v); store.set("paidPrices", paid);
    update();
  });
  document.addEventListener("click", async (e) => {
    const clr = e.target.closest("[data-plpaidclear]");
    if (clr) { const paid = store.get("paidPrices", {}); delete paid[clr.dataset.plpaidclear]; store.set("paidPrices", paid); return update(); }
    const t = e.target.closest("[data-push], [data-plalert], [data-plopen]");
    if (!t) return;
    if (t.dataset.push === "on") return pushOn();
    if (t.dataset.push === "off") return pushOff();
    if (t.dataset.push === "test") return pushTest();
    const sym = t.dataset.plalert || t.dataset.plopen, p = plans[sym];
    if (t.dataset.plalert && p) {
      const a = window.addAlert?.(sym, "above", +p.target.toPrecision(6)), b = a !== false && window.addAlert?.(sym, "below", +p.stop.toPrecision(6));
      if (a !== false && b !== false) window.toast?.(`Alerts set: ${sym} above ${fmt(p.target)} and below ${fmt(p.stop)}`);
    }
    if (t.dataset.plopen) { window.showTab?.("signals"); if (!coins.includes(sym)) await window.addCoin?.(sym); selected = sym; window.render(); }
  });

  document.addEventListener("prices-updated", update);
  document.addEventListener("plan-changed", () => { render(); update(); });
  document.addEventListener("holdings-changed", update);
  const prevOnConfig = window.onSiteConfig;
  window.onSiteConfig = (c) => { prevOnConfig?.(c); renderPush(); syncPush(); };
  window.updateSellPlans = update;
  // For Ask AI: each coin you own with its plan (prices in USD)
  window.sellPlansSnapshot = () => owned().map((o) => {
    const p = plans[o.sym], r = (x) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(6));
    return { coin: o.sym, amount: r(o.amt), paidPerCoinUSD: o.cost ? r(o.cost) : null, valueUSD: p ? r(p.price * o.amt) : null,
      gainPct: p?.gain != null ? +(p.gain * 100).toFixed(1) : null,
      plan: p ? { advice: p.verdict, why: p.detail, takeProfitNearUSD: r(p.target), sellIfItDropsToUSD: r(p.stop), stopAlreadyBroken: p.price <= p.stop, insights: p.insights } : "no plan (not enough price history on Coinbase)" };
  });
  render();
})();

// Pro subscription UI: Go Pro button, activation after Stripe checkout, status, manage, restore with a key.
// Uses globals from app.js: store, $, authHeaders.
(function () {
  const box = $("proBox");
  let cfg = null;      // from /api/config: {enabled, price, monthlyLimit}
  let status = null;   // from /api/pro?action=status
  let note = "";       // one-line message shown in the box
  let busy = false;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = () => store.get("proKey", "");
  const priceText = () => {
    if (!cfg?.price) return "";
    let amount;
    try { amount = new Intl.NumberFormat(undefined, { style: "currency", currency: cfg.price.currency }).format(cfg.price.amount); }
    catch { amount = cfg.price.amount + " " + cfg.price.currency; }
    return `${amount} / ${cfg.price.interval}`;
  };

  async function api(action, opts = {}) {
    const res = await fetch("/api/pro?action=" + action, { ...opts, headers: { ...(opts.headers || {}), ...(key() ? { "X-Pro-Key": key() } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 401) throw new Error(data.reason || "HTTP " + res.status);
    return data;
  }

  async function loadStatus() {
    if (!cfg?.enabled || !key()) { status = null; return render(); }
    try { status = await api("status"); } catch (e) { note = e.message; }
    render();
  }

  function render() {
    if (!cfg?.enabled) { box.hidden = true; return; }
    box.hidden = false;
    const msg = note ? `<div class="proNote">${esc(note)}</div>` : "";
    if (key() && status?.pro) {
      const end = status.periodEnd ? new Date(status.periodEnd * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
      box.innerHTML = `<div class="proRow"><span><b>⭐ Pro is active.</b> ${status.used} of ${status.limit} AI questions used this month.
          ${end ? `<span class="muted">${status.cancelAtPeriodEnd ? "Ends" : "Renews"} ${end}.</span>` : ""}</span>
        <span class="proBtns"><button data-act="portal">Manage subscription</button><button data-act="copy" title="Use this key to unlock Pro on another phone or computer">Copy my Pro key</button></span></div>${msg}`;
    } else if (key() && status) {
      box.innerHTML = `<div class="proRow"><span><b>Pro is not active.</b> ${esc(status.reason || "")}</span>
        <span class="proBtns">${status.status ? `<button data-act="portal">Manage subscription</button>` : ""}<button data-act="forget">Remove key</button></span></div>${msg}`;
    } else {
      box.innerHTML = `<div class="proRow"><span><b>⭐ Go Pro: ${esc(priceText())}</b><br>
          <span class="muted">Ask AI about any coin, your holdings and the social hype. ${cfg.monthlyLimit} questions a month. Cancel anytime.</span></span>
        <span class="proBtns"><button class="primary" data-act="buy" ${busy ? "disabled" : ""}>${busy ? "Opening checkout…" : "Go Pro"}</button></span></div>
        <form class="proRestore"><span class="muted">Already subscribed?</span><input name="k" placeholder="Paste your Pro key" autocomplete="off" /><button type="submit">Unlock</button></form>${msg}`;
    }
  }

  box.addEventListener("click", async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    note = "";
    try {
      if (act === "buy") {
        busy = true; render();
        const { url } = await api("checkout", { method: "POST" });
        location.href = url; // Stripe's hosted checkout page
        return;
      }
      if (act === "portal") { const { url } = await api("portal", { method: "POST" }); location.href = url; return; }
      if (act === "forget") { store.set("proKey", ""); status = null; }
      if (act === "copy") {
        try { await navigator.clipboard.writeText(key()); note = "Pro key copied. Paste it under \"Already subscribed?\" on your other device. Keep it private."; }
        catch { note = "Your Pro key: " + key(); }
      }
    } catch (err) { note = err.message; }
    busy = false; render();
  });

  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const k = e.target.k.value.trim();
    if (!k) return;
    store.set("proKey", k); note = "";
    await loadStatus();
    if (!status?.pro) { note = status?.reason || "That Pro key isn't valid."; if (!status?.status) { store.set("proKey", ""); status = null; } render(); }
  });

  async function handleReturn() {
    const q = new URLSearchParams(location.search);
    const session = q.get("pro_session"), cancelled = q.get("pro") === "cancelled";
    if (!session && !cancelled) return;
    history.replaceState(null, "", location.pathname);
    if (cancelled) { note = "Checkout cancelled. You have not been charged."; return; }
    try {
      const { key: k } = await api("activate&session_id=" + encodeURIComponent(session));
      store.set("proKey", k);
      note = "Welcome to Pro! Ask AI is unlocked on this device.";
      $("aiTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { note = "Couldn't confirm your payment: " + e.message + " If you were charged, reload this page or contact support."; }
  }

  window.onSiteConfig = async (c) => { cfg = c.pro || null; await handleReturn(); await loadStatus(); };
  window.refreshPro = loadStatus;
  window.showUpgrade = () => { if (cfg?.enabled) box.scrollIntoView({ behavior: "smooth", block: "center" }); };
  window.proEnabled = () => Boolean(cfg?.enabled);
})();

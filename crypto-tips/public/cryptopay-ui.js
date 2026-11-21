// "Pay with crypto" sheet: pick a coin, send the exact amount to the shown address, paste the transaction ID.
// The server (cryptopay.js) checks it on the blockchain and adds Pro. Uses window.toast / refreshPro from account.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let cfg = null, order = null;
  const post = (action, body) => fetch("/api/account?action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.reason || "Something went wrong (" + r.status + ")"); return d; });

  function sheet(html) {
    const d = $("authDialog");
    d.innerHTML = `<div class="sheet cp"><button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>${html}</div>`;
    if (!d.open) d.showModal();
  }
  function choose() {
    order = null;
    sheet(`<span class="pro-badge">₿ Pay with crypto</span>
      <h2>$${cfg.priceUsd} for ${cfg.days} days of Pro</h2>
      <p class="muted small">Pay from any wallet (Exodus, Phantom, Coinbase Wallet…). No card, no account with a payment company. Pick a coin:</p>
      <div class="cp-methods">${cfg.methods.map((m) => `<button class="cp-m" data-cp-method="${esc(m.id)}"><b>${esc(m.label)}</b><span class="muted small">${esc(m.network)}${m.note ? " · " + esc(m.note) : ""}</span></button>`).join("")}</div>
      <p class="muted small">It's a one-time payment for ${cfg.days} days. Nothing renews by itself; pay again any time to add more days.</p>`);
  }
  function pay() {
    const o = order, mins = Math.max(0, Math.round((o.expires - Date.now()) / 60000));
    sheet(`<span class="pro-badge">₿ ${esc(o.label)}</span>
      <h2>Send exactly</h2>
      <div class="cp-amount"><b>${esc(o.amount)} ${esc(o.asset)}</b><button class="pill" data-cp-copy="${esc(o.amount)}">Copy amount</button></div>
      <p class="small">to this <b>${esc(o.network)}</b> address:</p>
      <div class="cp-addr"><code>${esc(o.address)}</code><button class="pill" data-cp-copy="${esc(o.address)}">Copy address</button></div>
      <ul class="cp-warn small">
        <li>Send the <b>exact</b> amount, including the last digits: that's how we know the payment is yours.</li>
        <li>Use the <b>${esc(o.network)}</b> network${o.asset === "USDC" ? ` and send <b>USDC</b>, not another coin` : ""}. Coins sent on the wrong network can't be recovered.</li>
        <li>This amount is held for ${mins >= 60 ? Math.round(mins / 60) + " hours" : mins + " minutes"} (≈ $${o.usd}).${o.note ? " " + esc(o.note) : ""}</li>
      </ul>
      <form class="cp-check" data-cp-form>
        <label class="small"><b>After sending:</b> paste the transaction ID (or the explorer link) from your wallet's transaction details</label>
        <input id="cpTx" autocomplete="off" spellcheck="false" placeholder="Transaction ID" />
        <button class="primary pill lg">Check my payment</button>
      </form>
      <p class="cp-msg small" id="cpMsg" aria-live="polite"></p>
      <button class="linkbtn small" data-cp-back>← Pay with a different coin</button>`);
  }

  async function start(method) {
    sheet(`<p class="muted">Getting your exact amount…</p>`);
    try { order = await post("cryptoQuote", { method }); pay(); }
    catch (e) { sheet(`<p style="color:var(--sell)">${esc(e.message)}</p><button class="pill" data-cp-back>Back</button>`); }
  }
  async function check() {
    const tx = $("cpTx").value.trim(), msg = $("cpMsg"), btn = document.querySelector("[data-cp-form] button");
    if (!tx) return $("cpTx").focus();
    btn.disabled = true; msg.className = "cp-msg small"; msg.textContent = "Checking the blockchain…";
    try {
      const r = await post("cryptoVerify", { invoice: order.invoice, tx });
      sheet(`<span class="pro-badge">✓ Paid</span><h2>You're Pro!</h2>
        <p>Thanks! We received ${esc(r.amount || order.amount)} ${esc(r.asset || order.asset)}. Pro is on until <b>${new Date(r.until).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</b>.</p>
        <button class="primary pill lg" data-close-sheet>Start using Pro</button>`);
      window.refreshPro?.();
      window.toast?.("Payment received. Pro is on.");
    } catch (e) {
      msg.className = "cp-msg small err"; msg.textContent = e.message; btn.disabled = false;
    }
  }

  window.payWithCrypto = () => {
    if (!cfg) return window.toast?.("Crypto payments aren't switched on yet.");
    if (!window.accountUser?.()) { window.toast?.("Create a free account or sign in first, so the payment goes to your account."); return document.querySelector('[data-pw="signup"], [data-auth="signup"]')?.click(); }
    order ? pay() : choose();
  };
  document.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-cp-method]"); if (m) return start(m.dataset.cpMethod);
    if (e.target.closest("[data-cp-back]")) return choose();
    if (e.target.closest("[data-crypto-pay]")) return window.payWithCrypto();
    const c = e.target.closest("[data-cp-copy]");
    if (c) { try { await navigator.clipboard.writeText(c.dataset.cpCopy); c.textContent = "Copied ✓"; setTimeout(() => (c.textContent = c.dataset.cpCopy.length > 20 ? "Copy address" : "Copy amount"), 1500); } catch {} }
  });
  document.addEventListener("submit", (e) => { if (e.target.closest("[data-cp-form]")) { e.preventDefault(); check(); } });
  const prev = window.onSiteConfig;
  window.onSiteConfig = (c) => { prev?.(c); cfg = c.cryptoPay || null; document.querySelectorAll("[data-crypto-pay]").forEach((b) => (b.hidden = !cfg)); };
})();

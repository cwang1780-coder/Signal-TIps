// "Pay with crypto" sheet: pick a coin, send the exact amount to the shown address, paste the transaction ID.
// The server (cryptopay.js) checks it on the blockchain and adds Pro. Uses window.toast / refreshPro from account.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let cfg = null, order = null, purpose = "pro", site = null;
  const post = (action, body) => fetch("/api/account?action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.reason || "Something went wrong (" + r.status + ")"); return d; });

  // ── The payment sheet: a bold header with the price, a step tracker, then the step itself ──
  const COIN = { "usdc-sol": "USDC", sol: "SOL", btc: "BTC", eth: "ETH", "usdc-eth": "USDC" };
  const ic = (sym, size = 36) => (window.coinIcon ? window.coinIcon(sym, size) : "");
  function sheet(html, step) {
    const d = $("authDialog"), t = site?.trial;
    const credit = purpose === "pro" ? window.accountUser?.()?.credit || 0 : 0;
    const price = purpose === "deposit" ? t?.depositUsd : Math.max(0.5, (cfg?.priceUsd || 5) - credit);
    const what = purpose === "deposit" ? `${t?.depositDays}-day Pro trial` : `${cfg?.days || 30} days of Pro`;
    const steps = ["Choose a coin", "Send", "Confirm"];
    d.innerHTML = `<div class="sheet cp cp2">
      <div class="cp-hero">
        <button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>
        <span class="cp-kicker">${purpose === "deposit" ? "Trial deposit" : "Signal Tips Pro"}</span>
        <div class="cp-price"><b>$${price}</b><span>${what}</span></div>
        ${purpose === "deposit" ? `<p class="cp-hero-note">Comes off your first month, so it isn't an extra cost.</p>` : credit ? `<p class="cp-hero-note">Includes your $${credit} deposit credit.</p>` : `<p class="cp-hero-note">One payment. Nothing renews by itself.</p>`}
        ${step ? `<ol class="cp-steps">${steps.map((x, k) => `<li class="${k + 1 < step ? "done" : k + 1 === step ? "on" : ""}"><i>${k + 1 < step ? "✓" : k + 1}</i><span>${x}</span></li>`).join("")}</ol>` : ""}
      </div>
      <div class="cp-body">${html}</div></div>`;
    if (!d.open) d.showModal();
  }
  function choose() {
    order = null;
    sheet(`<p class="cp-lead">Pay from any wallet: Exodus, Phantom, Coinbase Wallet, Trust… No card and no payment company.</p>
      <div class="cp-methods">${cfg.methods.map((m, k) => `<button class="cp-m${k === 0 ? " best" : ""}" data-cp-method="${esc(m.id)}">
          <span class="cp-m-ic">${ic(COIN[m.id], 36)}${m.id.startsWith("usdc") ? `<span class="cp-net">${ic(m.network === "Solana" ? "SOL" : "ETH", 16)}</span>` : ""}</span>
          <span class="cp-m-txt"><b>${esc(m.label)}</b><span>${esc(m.network)}${m.note ? " · " + esc(m.note) : ""}</span></span>
          ${k === 0 ? `<em class="cp-best">Best</em>` : `<span class="cp-arrow">›</span>`}</button>`).join("")}</div>
      <p class="cp-fine">🔒 Checked on the public blockchain. We never see your wallet's keys.</p>`, 1);
  }
  function qrSvg(text) {
    try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch { return ""; }
  }
  function pay() {
    const o = order, mins = Math.max(0, Math.round((o.expires - Date.now()) / 60000));
    sheet(`<div class="cp-sendgrid">
        <div class="cp-qr">${o.uri ? qrSvg(o.uri) : ""}<span>Scan with your wallet app</span></div>
        <div class="cp-sendinfo">
          <span class="cp-label">Send exactly</span>
          <div class="cp-amount2">${ic(o.asset, 28)}<b>${esc(o.amount)}</b><span>${esc(o.asset)}</span></div>
          <button class="cp-copy" data-cp-copy="${esc(o.amount)}">Copy amount</button>
          <span class="cp-label">To this ${esc(o.network)} address</span>
          <code class="cp-addr2">${esc(o.address)}</code>
          <button class="cp-copy" data-cp-copy="${esc(o.address)}">Copy address</button>
        </div>
      </div>
      <div class="cp-alert"><b>⚠ Exact amount, ${esc(o.network)} network${o.asset === "USDC" ? ", USDC only" : ""}.</b> The last digits are how we know it's yours. Coins sent on the wrong network can't be recovered. Held for ${mins >= 60 ? Math.round(mins / 60) + " hours" : mins + " minutes"}.${o.note ? " " + esc(o.note) : ""}</div>
      <form class="cp-check" data-cp-form>
        <label><b>Sent it?</b> Paste the transaction ID (or explorer link) from your wallet</label>
        <input id="cpTx" autocomplete="off" spellcheck="false" placeholder="Transaction ID" />
        <button class="cp-go">Confirm payment</button>
      </form>
      <p class="cp-msg small" id="cpMsg" aria-live="polite"></p>
      <button class="linkbtn small" data-cp-back>← Pay with a different coin</button>`, 2);
  }
  function done(r) {
    sheet(`<div class="cp-done"><div class="cp-tick">✓</div><h2>${r.deposit ? "Your trial has started!" : "You're Pro!"}</h2>
      <p>We received ${esc(r.amount || order.amount)} ${esc(r.asset || order.asset)}. ${r.deposit ? "Your Pro trial" : "Pro"} is on until <b>${new Date(r.until).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</b>.${r.deposit ? ` Your $${r.credit} comes off your first month.` : ""}</p>
      <button class="cp-go" data-close-sheet>Start using Pro</button></div>`, 4);
  }

  async function start(method) {
    sheet(`<p class="cp-lead">Getting your exact amount…</p>`, 2);
    try { order = await post("cryptoQuote", { method, purpose }); pay(); }
    catch (e) { sheet(`<p class="cp-msg err">${esc(e.message)}</p><button class="pill" data-cp-back>Back</button>`, 1); }
  }
  async function check() {
    const tx = $("cpTx").value.trim(), msg = $("cpMsg"), btn = document.querySelector("[data-cp-form] button");
    if (!tx) return $("cpTx").focus();
    btn.disabled = true; msg.className = "cp-msg small"; msg.textContent = "Checking the blockchain… this takes a few seconds.";
    try {
      const r = await post("cryptoVerify", { invoice: order.invoice, tx });
      done(r);
      window.refreshPro?.();
      window.toast?.("Payment received. Pro is on.");
    } catch (e) {
      msg.className = "cp-msg small err"; msg.textContent = e.message; btn.disabled = false;
    }
  }

  window.payWithCrypto = (p = "pro") => {
    if (p !== purpose) order = null;
    purpose = p;
    if (!cfg) return window.toast?.("Crypto payments aren't switched on yet.");
    if (!window.accountUser?.()) { window.toast?.("Create a free account or sign in first, so the payment goes to your account."); return document.querySelector('[data-pw="signup"], [data-auth="signup"]')?.click(); }
    order ? pay() : choose();
  };
  document.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-cp-method]"); if (m) return start(m.dataset.cpMethod);
    if (e.target.closest("[data-cp-back]")) return choose();
    if (e.target.closest("[data-crypto-pay]")) return window.payWithCrypto("pro");
    if (e.target.closest("[data-crypto-deposit]")) return window.payWithCrypto("deposit");
    const c = e.target.closest("[data-cp-copy]");
    if (c) { try { await navigator.clipboard.writeText(c.dataset.cpCopy); c.textContent = "Copied ✓"; setTimeout(() => (c.textContent = c.dataset.cpCopy.length > 20 ? "Copy address" : "Copy amount"), 1500); } catch {} }
  });
  document.addEventListener("submit", (e) => { if (e.target.closest("[data-cp-form]")) { e.preventDefault(); check(); } });
  const prev = window.onSiteConfig;
  window.onSiteConfig = (c) => { prev?.(c); cfg = c.cryptoPay || null; site = c; document.querySelectorAll("[data-crypto-pay]").forEach((b) => (b.hidden = !cfg)); };
})();

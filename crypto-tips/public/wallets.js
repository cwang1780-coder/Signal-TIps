// Connect a wallet, read-only: the user gives a PUBLIC address (or shares it from a browser wallet).
// We never ask for usernames, passwords, emails or recovery phrases. Addresses are saved only in this browser.
// Uses globals from app.js: store, $, results, analyzeCoin, render, fmt.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NETS = { auto: "Detect automatically", btc: "Bitcoin", eth: "Ethereum (+ popular tokens)", sol: "Solana", ltc: "Litecoin", doge: "Dogecoin", xrp: "XRP" };
  const STABLE = new Set(["USDC", "USDT", "DAI"]); // worth about $1 each: shown as cash, not as coins to trade
  let wallets = store.get("wallets", []);          // [{id, chain, address, label}]
  const balances = {};                              // id -> {balances, checked, error}
  const save = () => store.set("wallets", wallets);
  const short = (a) => (a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

  // A recovery phrase is 12–24 words. Refuse it here, before anything leaves the browser.
  const looksLikeSecret = (s) => /\s/.test(s.trim()) || /^(0x)?[0-9a-f]{64}$/i.test(s.trim());

  async function lookup(w) {
    try {
      const res = await fetch(`/api/wallet?chain=${encodeURIComponent(w.chain)}&address=${encodeURIComponent(w.address)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.reason || "HTTP " + res.status);
      if (w.chain === "auto") { w.chain = d.chain; save(); }
      balances[w.id] = { balances: d.balances, checked: d.checked, network: d.network };
      const missing = d.balances.map((b) => b.sym).filter((s) => !STABLE.has(s) && !results[s]);
      await Promise.all(missing.map(async (s) => { try { results[s] = await analyzeCoin(s); } catch (e) { results[s] = { error: e.message }; } }));
    } catch (e) {
      balances[w.id] = { error: e.message };
    }
  }

  async function syncAll() {
    if (location.protocol === "file:" || !wallets.length) return renderWallets();
    $("walletStatus").textContent = "Checking balances…";
    await Promise.all(wallets.map(lookup));
    $("walletStatus").textContent = "Updated " + new Date().toLocaleTimeString();
    renderWallets(); render();
  }

  function renderWallets() {
    const el = $("walletList");
    if (!el) return;
    el.innerHTML = wallets.length ? wallets.map((w) => {
      const b = balances[w.id];
      const items = b?.error ? `<span class="down">${esc(b.error)}</span>`
        : !b ? `<span class="muted">Checking…</span>`
        : b.balances.filter((x) => x.amt > 0).map((x) => `${window.coinIcon ? window.coinIcon(x.sym, 20) : ""} ${(+x.amt.toPrecision(8)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${esc(x.token || x.sym)}`).join(" · ") || `<span class="muted">Empty (0 balance)</span>`;
      return `<li><div><b>${esc(w.label || NETS[w.chain] || "Wallet")}</b> <span class="muted">${esc(b?.network || NETS[w.chain] || "")} · <code title="${esc(w.address)}">${esc(short(w.address))}</code></span>
        <div class="wbal">${items}</div></div><button class="x" data-wrm="${w.id}" title="Remove this wallet" aria-label="Remove wallet">✕</button></li>`;
    }).join("") : `<li class="muted">No wallets connected yet.</li>`;
  }

  async function addWallet(chain, address, label) {
    address = address.trim();
    const msg = $("walletMsg");
    if (!address) { msg.textContent = "Paste a public address first."; return; }
    if (looksLikeSecret(address)) {
      $("walletAddr").value = "";
      msg.innerHTML = "<b>⚠️ That looks like a recovery phrase or private key.</b> We cleared it and nothing was sent. Never share those with any app or person. Paste your <b>public receive address</b> instead.";
      return;
    }
    if (wallets.some((w) => w.address === address)) { msg.textContent = "That wallet is already connected."; return; }
    const w = { id: Date.now().toString(36), chain, address, label: label.trim().slice(0, 40) };
    msg.textContent = "Checking…";
    await lookup(w);
    if (balances[w.id]?.error) { msg.textContent = balances[w.id].error; delete balances[w.id]; return; }
    wallets.push(w); save();
    msg.textContent = "✅ Connected (read-only).";
    $("walletAddr").value = ""; $("walletLabel").value = "";
    renderWallets(); render();
  }

  // Holdings from connected wallets, for the My coins table and the coin list.
  window.walletHoldings = () => {
    const out = [];
    for (const w of wallets) for (const b of balances[w.id]?.balances || []) {
      if (b.amt > 0 && !STABLE.has(b.sym)) out.push({ sym: b.sym, amt: b.amt, cost: 0, src: "Wallet " + short(w.address) });
    }
    return out;
  };
  window.walletCash = () => {
    const out = {};
    for (const w of wallets) for (const b of balances[w.id]?.balances || []) if (STABLE.has(b.sym) && b.amt > 0) out[b.sym] = (out[b.sym] || 0) + b.amt;
    return out;
  };

  $("walletNet").innerHTML = Object.entries(NETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("walletForm").addEventListener("submit", (e) => { e.preventDefault(); addWallet($("walletNet").value, $("walletAddr").value, $("walletLabel").value); });
  $("walletList").addEventListener("click", (e) => {
    const id = e.target.dataset.wrm;
    if (id) { wallets = wallets.filter((w) => w.id !== id); delete balances[id]; save(); renderWallets(); render(); }
  });
  // Browser wallets (MetaMask, Coinbase Wallet…): they share only the public address, after the user approves.
  const eth = window.ethereum;
  if (eth?.request) {
    $("walletBrowser").hidden = false;
    $("walletBrowser").onclick = async () => {
      try {
        const [addr] = await eth.request({ method: "eth_requestAccounts" });
        if (addr) addWallet("eth", addr, "Browser wallet");
      } catch { $("walletMsg").textContent = "The wallet didn't share an address. Nothing was connected."; }
    };
  }
  renderWallets();
  syncAll();
  setInterval(syncAll, 5 * 60 * 1000);
})();

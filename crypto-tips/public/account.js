// Accounts, Pro and the app install prompt.
// - Sign up / sign in (email + password). The session is an HttpOnly cookie the page can't read.
// - Plans: Free, 7-day Pro trial (no card), Pro (Stripe subscription), owner.
// - Pro features are unlocked with window.isPro(); window.proGate(name) shows the upgrade sheet when locked.
// - Signed-in accounts sync the watchlist, alerts, holdings and settings between devices (wallet addresses stay on the device).
// Uses globals from app.js: store, $, showTab, siteConfig. Icons from icons.js.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FREE = { coins: 10, alerts: 3 };
  const SYNCED = ["coins", "alerts", "holdings", "wallets", "paidPrices", "level", "levelChosen", "currency", "learnDone", "simBest", "trenchCB", "theme", "settings"];
  const PRO_FEATURES = [
    ["sparkle", "Ask AI", "Ask anything about a coin, your holdings or today's market, in plain English."],
    ["megaphone", "Buzz from 7 sources", "Bluesky, Mastodon, Hacker News, Lemmy and news headlines on top of StockTwits and trending searches, with a combined hype score."],
    ["flame", "The full Trench", "Every coin making a big move, not just the top 3, plus the Coinbase-only filter."],
    ["chart", "Deep coin research", "Chart patterns with years of history, similar past moments, and each coin's signal track record."],
    ["bell", "Unlimited watchlist and alerts", `Follow every coin you like and set as many alerts as you need (free: ${FREE.coins} coins, ${FREE.alerts} alerts).`],
    ["game", "Real-market simulator", "Practise on real past prices of a hidden coin, not just made-up scenarios."],
    ["wallet", "Wallet sell plans and phone alerts", "When to take profit or cut a loss on every coin you own, and a notification when it's time."],
    ["gauge", "Price predictions", "The typical move and likely range for each coin over a day, week, month and 3 months, with its real track record."],
    ["shield", "AI second opinion", "The AI checks each signal against live news and the market, and says if it agrees."],
  ];

  let user = null, cfg = null, note = "", loaded = false;
  const plan = () => user?.plan || { pro: false, kind: "guest" };
  window.isPro = () => Boolean(plan().pro);
  window.accountUser = () => user;
  window.account = () => user;

  async function api(action, opts = {}) {
    const init = { method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    const res = await fetch("/api/account?action=" + action, init);
    const d = await res.json().catch(() => ({}));
    if (d.banned) showBanned(d);
    if (!res.ok) throw Object.assign(new Error(d.message || d.reason || "Something went wrong (HTTP " + res.status + ")."), { status: res.status, banned: Boolean(d.banned) });
    return d;
  }

  function setUser(u) {
    const wasPro = window.isPro();
    user = u;
    try { if (u) localStorage.setItem("seenSignedIn", "1"); } catch {}
    document.body.classList.toggle("signedIn", Boolean(u));
    document.body.classList.toggle("isPro", window.isPro());
    renderHeader(); renderPanel(); renderProBox(); renderGate(); renderFinish();
    if (wasPro !== window.isPro()) document.dispatchEvent(new Event("plan-changed"));
  }

  // ── header button ──
  function renderHeader() {
    const b = $("acctBtn");
    if (!b) return;
    if (user) {
      b.className = "acct-btn signed";
      b.innerHTML = `<span class="avatar">${esc(user.email[0].toUpperCase())}</span>${window.isPro() ? `<span class="pro-tag">PRO</span>` : ""}`;
      b.setAttribute("aria-label", "Your account");
    } else {
      b.className = "acct-btn pill";
      b.textContent = "Sign in";
      b.setAttribute("aria-label", "Sign in or create an account");
    }
  }

  // ── sign in / create account sheet ──
  let mode = "signup";
  function openAuth(m = "signup", why = "") {
    mode = m;
    const d = $("authDialog");
    const social = ["google", "apple"].filter((p) => cfg?.oauth?.[p]);
    d.innerHTML = `<form method="dialog" class="sheet auth" novalidate>
      <button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>
      <h2>${mode === "signup" ? "Create your account" : "Sign in to Signal Tips"}</h2>
      ${why ? `<p class="muted">${esc(why)}</p>` : `<p class="muted">${mode === "signup" ? `Free to start. Try Pro free for ${cfg?.trial?.freeDays || 3} days.` : "Welcome back."}</p>`}
      ${social.length ? `<div class="oauth-btns">${social.map((p) => `<a class="oauth-btn ${p}" href="/api/account?action=oauth&provider=${p}">${p === "google" ? `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>` : `<svg width="16" height="18" viewBox="0 0 17 20" aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.9 3.2-.5 8 1.3 10.6.9 1.3 2 2.7 3.4 2.6 1.3-.1 1.9-.9 3.5-.9s2.1.9 3.5.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3 0 0-2.8-1.1-2.8-4.3zM11.5 2.9c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.2.1 2.3-.6 3-1.5z"/></svg>`}<span>Continue with ${p === "google" ? "Google" : "Apple"}</span></a>`).join("")}</div><div class="or"><span>or</span></div>` : ""}
      ${mode === "signup" ? `
      <label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required placeholder="you@example.com" /></label>
      <label>Username<input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="30" placeholder="e.g. sam_trades" /></label>
      <span class="muted small">3 to 30 letters, numbers, dots, dashes or underscores. You can sign in with it or your email.</span>`
      : `<label>Email or username<input name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>`}
      <label>Password<input name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required minlength="8" /></label>
      ${mode === "signup" ? `<span class="muted small">At least 8 characters. We only store a scrambled (hashed) version of it.</span>` : ""}
      <p class="auth-err" role="alert"></p>
      <button class="primary pill lg" type="submit">${mode === "signup" ? "Create account" : "Sign in"}</button>
      <p class="muted small">${mode === "signup" ? `Already have an account? <button type="button" class="linkbtn" data-auth="login">Sign in</button>` : `New here? <button type="button" class="linkbtn" data-auth="signup">Create an account</button>`}</p>
      ${mode === "login" ? `<p class="muted small">Forgot your password? Contact the site owner to reset it.</p>` : ""}
      <p class="muted small">By creating an account you agree that Signal Tips gives general information, not financial advice.</p>
    </form>`;
    if (!d.open) d.showModal();
    d.querySelector("input[name=email]").focus();
  }

  async function submitAuth(form) {
    const err = form.querySelector(".auth-err"), btn = form.querySelector("button[type=submit]");
    const email = form.email.value.trim(), password = form.password.value, username = form.username?.value.trim();
    if (mode === "signup" && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { err.textContent = "Enter your email address."; return form.email.focus(); }
    if (mode === "signup" && !username) { err.textContent = "Pick a username."; return form.username.focus(); }
    if (!email || !password) { err.textContent = "Enter your email or username and a password."; return; }
    btn.disabled = true; err.textContent = "";
    try {
      const d = await api(mode, { method: "POST", body: { email, password, ...(mode === "signup" ? { username } : {}) } });
      $("authDialog").close();
      setUser(d.user);
      toast(mode === "signup" ? "Account created. Welcome!" : "Signed in.");
      await syncAfterSignIn();
      if (afterAuth) { const f = afterAuth; afterAuth = null; f(); }
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  }
  let afterAuth = null;

  // The two ways to try Pro: 3 days free, or 7 days for a small deposit that comes off the first month
  function trialButtons(big) {
    const t = cfg?.trial || { freeDays: 3 };
    return `<button class="primary pill${big ? " lg" : ""}" data-pw="trial">Start ${t.freeDays}-day free trial</button>`
      + (t.depositAvailable ? `<button class="pill${big ? " lg" : ""}" data-crypto-deposit>${t.depositDays}-day trial · $${t.depositUsd} deposit <span class="muted small">(comes off your first month)</span></button>` : "");
  }
  // ── upgrade sheet (paywall) ──
  function paywall(feature) {
    const d = $("authDialog"), p = plan(), price = cfg?.pro?.enabled && cfg.pro.price ? priceText(cfg.pro.price) : null;
    const cta = !user ? `<button class="primary pill lg" data-pw="signup">Create free account and start trial</button>`
      : !p.pro && !p.trialUsed && p.kind !== "lapsed" ? trialButtons(true)
      : cfg?.pro?.enabled || cfg?.cryptoPay ? (cfg?.pro?.enabled ? `<button class="primary pill lg" data-pw="buy">Go Pro${price ? " · " + esc(price) : ""}</button>` : "")
        + (cfg?.cryptoPay ? `<button class="${cfg?.pro?.enabled ? "pill" : "primary pill lg"}" data-crypto-pay>Pay with crypto · $${cfg.cryptoPay.priceUsd} for ${cfg.cryptoPay.days} days</button>` : "")
      : `<p class="muted">Pro subscriptions open soon. Your trial has ended; thanks for trying it!</p>`;
    d.innerHTML = `<div class="sheet paywall">
      <button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>
      <span class="pro-badge">${icon("star")} Signal Tips Pro</span>
      <h2>${feature ? `${esc(feature)} is a Pro feature` : "Get more with Pro"}</h2>
      <ul class="pro-list">${PRO_FEATURES.map(([ic, t, s]) => `<li>${icon(ic)}<span><b>${t}</b><span class="muted">${s}</span></span></li>`).join("")}</ul>
      ${cta}
      <p class="muted small">${!user || (!p.pro && !p.trialUsed) ? `Try it free for ${cfg?.trial?.freeDays || 3} days${cfg?.trial?.depositAvailable ? `, or ${cfg.trial.depositDays} days for a $${cfg.trial.depositUsd} deposit that comes off your first month` : ""}. ` : ""}${price ? `Then ${esc(price)}. ` : ""}Cancel anytime.</p>
    </div>`;
    if (!d.open) d.showModal();
  }
  window.paywall = paywall;
  window.showUpgrade = () => paywall("Ask AI");
  // Returns true if the feature can be used; otherwise shows the upgrade sheet.
  window.proGate = (feature) => { if (window.isPro()) return true; paywall(feature); return false; };
  window.freeLimits = FREE;

  async function startTrial() {
    try { const d = await api("trial", { method: "POST", body: {} }); setUser(d.user); $("authDialog").close(); toast(`Pro trial started: ${cfg?.trial?.freeDays || 3} days of everything.`); }
    catch (e) { toast(e.message); }
  }
  async function buy() {
    try { const { url } = await api("checkout", { method: "POST", body: {} }); location.href = url; }
    catch (e) { toast(e.message); }
  }
  const priceText = (pr) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: pr.currency }).format(pr.amount) + " / " + pr.interval; } catch { return pr.amount + " " + pr.currency + " / " + pr.interval; } };

  // ── Me tab: account panel ──
  function planLine(p) {
    if (p.kind === "owner") return `<span class="plan-badge pro">Owner</span> Everything is unlocked for you.${user?.admin ? ` <a href="/admin" class="admin-link">Open the admin panel →</a>` : ""}`;
    if (p.kind === "crypto") return `<span class="plan-badge pro">Pro</span> Paid with crypto, until ${new Date(p.until).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`;
    if (p.kind === "comp") return `<span class="plan-badge pro">Pro</span> ${p.until ? "Free until " + new Date(p.until).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Free, courtesy of the site"}.`;
    if (p.kind === "trial") return `<span class="plan-badge pro">Pro trial</span> Ends ${new Date(p.until).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`;
    if (p.kind === "subscription") return `<span class="plan-badge pro">Pro</span> ${p.cancelAtPeriodEnd ? "Ends" : "Renews"} ${p.periodEnd ? new Date(p.periodEnd * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}.`;
    if (p.kind === "lapsed") return `<span class="plan-badge">Free</span> Your subscription is ${esc(String(p.status).replace("_", " "))}.`;
    return `<span class="plan-badge">Free</span>${p.trialUsed ? " Your trial has ended." : ""}`;
  }
  function renderPanel() {
    const el = $("acctPanel");
    if (!el) return;
    if (cfg && cfg.accounts === false) { el.innerHTML = `<h3>Account</h3><p class="muted">Accounts aren't switched on for this site yet.</p>`; return; }
    if (!user) {
      el.innerHTML = `<h3>Your account</h3>
        <p>Create a free account to keep your watchlist, alerts and settings on your phone and computer, and try Pro free for ${cfg?.trial?.freeDays || 3} days.</p>
        <div class="acct-actions"><button class="primary pill" data-auth="signup">Create free account</button><button class="pill" data-auth="login">Sign in</button></div>`;
      return;
    }
    const p = plan(), price = cfg?.pro?.enabled && cfg.pro.price ? priceText(cfg.pro.price) : null;
    el.innerHTML = `<h3>Your account</h3>
      <div class="acct-row"><span class="avatar lg">${esc(user.email[0].toUpperCase())}</span><span><b>${esc(user.email)}</b><span class="muted small">Member since ${new Date(user.created).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></span></div>
      <p class="plan-line">${planLine(p)}</p>
      ${p.pro && typeof p.aiLimit === "number" ? `<p class="muted small">AI questions this month: ${user.aiUsed} of ${p.aiLimit}.</p>` : ""}
      <div class="acct-actions">
        ${!p.pro && !p.trialUsed && p.kind !== "lapsed" ? trialButtons(false) : ""}
        ${user.credit > 0 ? `<span class="muted small">$${user.credit} deposit credit: it comes off your next Pro payment.</span>` : ""}
        ${(p.kind !== "subscription" && p.kind !== "owner") && cfg?.pro?.enabled ? `<button class="${p.pro ? "pill" : "primary pill"}" data-pw="buy">Go Pro${price ? " · " + esc(price) : ""}</button>` : ""}
        ${p.kind !== "owner" && p.kind !== "subscription" && cfg?.cryptoPay ? `<button class="${p.pro || cfg?.pro?.enabled ? "pill" : "primary pill"}" data-crypto-pay>${p.kind === "crypto" ? "Add more days with crypto" : `Pay with crypto · $${cfg.cryptoPay.priceUsd}`}</button>` : ""}
        ${p.kind === "subscription" || p.kind === "lapsed" ? `<button class="pill" data-acct="portal">Manage subscription</button>` : ""}
        ${!p.pro ? `<button class="pill" data-pw="show">See what Pro includes</button>` : ""}
        <button class="pill" data-acct="logout">Sign out</button>
      </div>
      ${note ? `<p class="acct-note">${esc(note)}</p>` : ""}
      <p class="muted small">Your watchlist, alerts, holdings and settings sync to this account. Wallet addresses stay on each device.</p>
      <details class="acct-more"><summary>Change password or delete account</summary>
        <form data-form="password" class="acct-form"><input name="current" type="password" placeholder="Current password" autocomplete="current-password" /><input name="next" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" /><button class="pill">Change password</button></form>
        <form data-form="delete" class="acct-form"><input name="password" type="password" placeholder="Your password" autocomplete="current-password" /><button class="pill danger">Delete my account</button></form>
        <span class="muted small">Deleting removes your account and synced settings from our server. ${p.kind === "subscription" ? "Cancel your subscription first under Manage subscription." : ""}</span>
      </details>`;
  }

  // ── Ask AI tab: plan box ──
  function renderProBox() {
    const box = $("proBox");
    if (!box) return;
    const p = plan();
    box.hidden = false;
    if (p.pro) {
      box.innerHTML = `<div class="proRow"><span><b>${icon("star")} ${p.kind === "trial" ? "Pro trial" : p.kind === "owner" ? "Owner" : "Pro"}</b> ${typeof p.aiLimit === "number" ? `· ${user.aiUsed} of ${p.aiLimit} AI questions used this month` : "· unlimited AI questions"}${cfg && !cfg.aiConfigured ? `<br><span class="muted">The AI isn't connected on this site yet (the site owner needs to add an AI key).</span>` : ""}</span></div>`;
    } else {
      box.innerHTML = `<div class="proRow"><span><b>${icon("star")} Ask AI is part of Pro.</b><br><span class="muted">Try it free for ${cfg?.trial?.freeDays || 3} days, no card needed.</span></span>
        <span class="proBtns"><button class="primary" data-pw="${!user ? "signup" : !p.trialUsed ? "trial" : "show"}">${!user ? "Create free account" : !p.trialUsed ? "Start free trial" : "Go Pro"}</button></span></div>`;
    }
  }

  // ── settings sync ──
  const snapshot = () => Object.fromEntries(SYNCED.map((k) => [k, store.get(k, null)]).filter(([, v]) => v !== null));
  let syncTimer = null, syncing = false;
  async function pushPrefs() {
    if (!user || syncing) return;
    try { await api("sync", { method: "PUT", body: { prefs: snapshot() } }); } catch {}
  }
  async function syncAfterSignIn() {
    try {
      syncing = true;
      const d = await api("sync");
      if (d.prefs && Object.keys(d.prefs).length) {
        const local = snapshot();
        if (JSON.stringify(local) !== JSON.stringify(d.prefs)) {
          for (const k of SYNCED) if (k in d.prefs) localStorage.setItem(k, JSON.stringify(d.prefs[k]));
          syncing = false;
          location.reload(); // simplest way to apply everything everywhere
          return;
        }
      } else { syncing = false; await pushPrefs(); }
    } catch {}
    syncing = false;
  }
  // Save synced settings to the account shortly after they change.
  const origSet = store.set;
  store.set = (key, val) => {
    origSet(key, val);
    if (user && SYNCED.includes(key)) { clearTimeout(syncTimer); syncTimer = setTimeout(pushPrefs, 1500); }
  };

  // ── toasts ──
  function toast(text) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = text; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3500);
  }
  window.toast = toast;

  // ── events ──
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-auth]");
    if (a) { e.preventDefault(); return openAuth(a.dataset.auth); }
    if (e.target.closest("[data-close-sheet]")) return $("authDialog").close();
    if (e.target.closest("#acctBtn")) { if (user) { showTab("me"); $("acctPanel").scrollIntoView({ block: "start" }); } else openAuth("signup"); return; }
    const pf = e.target.closest("[data-pw-feature]");
    if (pf) { e.preventDefault(); return paywall(pf.dataset.pwFeature); }
    const pw = e.target.closest("[data-pw]");
    if (pw) {
      const k = pw.dataset.pw;
      if (k === "signup") { afterAuth = () => { if (!plan().pro && !plan().trialUsed) startTrial(); }; return openAuth("signup"); }
      if (k === "trial") return startTrial();
      if (k === "buy") return buy();
      if (k === "show") return paywall();
    }
    const ac = e.target.closest("[data-acct]");
    if (ac) {
      if (ac.dataset.acct === "logout") { try { await api("logout", { method: "POST", body: {} }); } catch {} setUser(null); toast("Signed out."); }
      if (ac.dataset.acct === "portal") { try { const { url } = await api("portal", { method: "POST", body: {} }); location.href = url; } catch (err) { note = err.message; renderPanel(); } }
    }
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.closest("#authDialog") && f.classList.contains("auth")) { e.preventDefault(); return submitAuth(f); }
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    try {
      if (kind === "password") { await api("password", { method: "POST", body: { current: f.current.value, next: f.next.value } }); note = "Password changed."; }
      if (kind === "delete") {
        if (!confirm("Delete your account and synced settings? This can't be undone.")) return;
        await api("delete", { method: "POST", body: { password: f.password.value } }); setUser(null); toast("Your account was deleted."); return;
      }
    } catch (err) { note = err.message; }
    renderPanel();
  });
  // Close the sheet when tapping outside it
  $("authDialog").addEventListener("click", (e) => { if (e.target === $("authDialog")) $("authDialog").close(); });

  // Back from Stripe checkout
  // Accounts missing an email or a username must add it before using the app
  function renderFinish() {
    const need = user?.needs || [];
    let f = $("finishAcct");
    if (!need.length) { f?.remove(); return; }
    if (f) return;
    f = document.createElement("div");
    f.id = "finishAcct";
    f.innerHTML = `<form class="finish-card" novalidate>
      <h2>Finish setting up your account</h2>
      <p class="muted">${need.includes("username") ? "Pick a username so friends and support can find you." : ""} ${need.includes("email") ? "Add your email so you can sign in with it and get account notices." : ""}</p>
      ${need.includes("email") ? `<label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" required placeholder="you@example.com" /></label>` : ""}
      ${need.includes("username") ? `<label>Username<input name="username" type="text" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="30" placeholder="e.g. sam_trades" /></label>` : ""}
      <p class="auth-err" role="alert"></p>
      <button class="primary pill lg" type="submit">Continue</button>
      <button type="button" class="linkbtn small" data-acct="logout">Sign out</button></form>`;
    document.body.appendChild(f);
    f.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target, er = form.querySelector(".auth-err");
      try { const d = await api("profile", { method: "POST", body: { email: form.email?.value.trim(), username: form.username?.value.trim() } }); setUser(d.user); toast("You're all set."); }
      catch (x) { er.textContent = x.message; }
    });
    f.querySelector("input").focus();
  }

  async function handleReturn() {
    const q0 = new URLSearchParams(location.search);
    if (q0.get("authError") || q0.get("signedIn")) {
      history.replaceState(null, "", location.pathname);
      if (q0.get("authError")) { openAuth("login"); const e = document.querySelector("#authDialog .auth-err"); if (e) e.textContent = q0.get("authError"); }
      else { toast("Signed in with " + (q0.get("signedIn") === "apple" ? "Apple" : "Google") + "."); await syncAfterSignIn(); }
      return;
    }
    const q = new URLSearchParams(location.search), session = q.get("pro_session");
    if (!session && q.get("pro") !== "cancelled") return;
    history.replaceState(null, "", location.pathname);
    if (!session) return toast("Checkout cancelled. You have not been charged.");
    try { const d = await api("activate&session_id=" + encodeURIComponent(session)); setUser(d.user); toast("Welcome to Pro! Everything is unlocked."); }
    catch (e) { toast("Couldn't confirm your payment: " + e.message); }
  }

  // Banned (by account or internet address): a full screen saying so, with the end date and reason
  function showBanned(d) {
    if ($("bannedScreen")) return;
    const el = document.createElement("div");
    el.id = "bannedScreen";
    el.innerHTML = `<div><div class="em-tag">Access blocked</div><h1>You're banned from Signal Tips${d.until ? "" : "."}</h1>
      ${d.until ? `<p class="bn-until">until ${new Date(d.until).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>` : ""}
      ${d.reason ? `<p>Reason: ${esc(d.reason)}</p>` : ""}<p class="bn-small">If you think this is a mistake, contact the site owner.</p></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.remove("gate-wait");
    document.body.classList.add("gated");
  }
  let accountsOn = false;
  async function load() {
    try { const d = await api("me"); accountsOn = true; setUser(d.user); } catch { setUser(null); }
    loaded = true;
    renderGate();
    await handleReturn();
  }

  // ── Sign-in wall: like Coinbase, the app is for account holders. Visitors see this page until they sign in. ──
  function renderGate() {
    let g = $("gate");
    const show = loaded && accountsOn && !user;
    document.body.classList.toggle("gated", show);
    document.documentElement.classList.remove("gate-wait");
    if (!show) { g?.remove(); return; }
    if (g) return;
    g = document.createElement("div");
    g.id = "gate";
    const t = cfg?.trial || { freeDays: 3, depositDays: 7, depositUsd: 1 }, price = cfg?.cryptoPay?.priceUsd || 5;
    const social = ["google", "apple"].filter((p) => cfg?.oauth?.[p]);
    const row = (sym, name) => `<tr data-lsym="${sym}"><td><span class="lg-c">${window.coinIcon ? window.coinIcon(sym, 28) : ""}<b>${name}</b> <span class="lg-dim">${sym}</span></span></td><td class="lg-px">…</td><td class="lg-ch">…</td><td><button class="lg-trade" data-auth="signup">Get signal</button></td></tr>`;
    g.innerHTML = `
      <header class="lg-nav"><div class="lg-wrap">
        <a class="lg-logo" href="/"><img src="/icon.svg" width="32" height="32" alt="" /><b>Signal Tips</b></a>
        <nav class="lg-links"><a href="#lg-features">Features</a><a href="#lg-markets">Markets</a><a href="#lg-pricing">Pricing</a><a href="#lg-faq">FAQ</a></nav>
        <div class="lg-actions"><button class="lg-btn ghost" data-auth="login">Sign in</button><button class="lg-btn blue" data-auth="signup">Sign up</button></div>
      </div></header>
      <section class="lg-hero"><div class="lg-wrap lg-hero-grid">
        <div>
          <h1>Know when to buy, hold or sell crypto.</h1>
          <p class="lg-lead">Live signals for every coin, a sell plan for what's in your wallet, price predictions and an AI you can ask anything. Sign up and try Pro free for ${t.freeDays} days.</p>
          <form class="lg-email" data-lg-signup><input type="email" placeholder="you@example.com" aria-label="Email address" autocomplete="email" /><button class="lg-btn blue lg">Sign up</button></form>
          ${social.length ? `<div class="lg-social">${social.map((p) => `<a class="lg-social-btn" href="/api/account?action=oauth&provider=${p}">Continue with ${p === "google" ? "Google" : "Apple"}</a>`).join("")}</div>` : ""}
          <p class="lg-fine">Not financial advice: signals are automated and often wrong.</p>
        </div>
        <div class="lg-phone" aria-hidden="true"><div class="lg-screen">
          <div class="lg-screen-top"><b>Signals</b><span>Today</span></div>
          ${[["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["SOL", "Solana"], ["XRP", "XRP"], ["DOGE", "Dogecoin"]].map(([s, n], k) => `<div class="lg-coin">${window.coinIcon ? window.coinIcon(s, 30) : ""}<div><b>${n}</b><span class="lg-dim" data-lpx="${s}">${s}</span></div><svg viewBox="0 0 60 24" class="lg-spark ${k % 2 ? "dn" : "up"}"><path d="${k % 2 ? "M0 6 L10 9 L20 7 L30 13 L40 12 L50 18 L60 20" : "M0 20 L10 16 L20 18 L30 11 L40 12 L50 6 L60 4"}"/></svg><em class="lg-tag ${["b", "h", "s"][k % 3]}">${["BUY", "HOLD", "SELL"][k % 3]}</em></div>`).join("")}
          <div class="lg-screen-card"><b>Your sell plan</b><span>Take profit near $72.40 · stop at $61.10</span></div>
          <p class="lg-example">Example screen</p>
        </div></div>
      </div></section>
      <section class="lg-sec" id="lg-markets"><div class="lg-wrap">
        <h2>Today's crypto prices</h2><p class="lg-sub">Live from Coinbase's public market data. Sign up to see the signal and the reasons for each coin.</p>
        <table class="lg-table"><thead><tr><th>Coin</th><th>Price</th><th>24h</th><th></th></tr></thead><tbody>
          ${row("BTC", "Bitcoin")}${row("ETH", "Ethereum")}${row("SOL", "Solana")}${row("XRP", "XRP")}${row("DOGE", "Dogecoin")}${row("ADA", "Cardano")}
        </tbody></table>
      </div></section>
      <section class="lg-sec alt" id="lg-features"><div class="lg-wrap">
        <h2>Everything you need to decide</h2>
        <div class="lg-cards">
          <div><i>📈</i><b>Signals with reasons</b><span>BUY, HOLD or SELL for each coin, why, and how the signal has actually done in the past.</span></div>
          <div><i>👛</i><b>Your wallet, planned</b><span>Connect a public address. Get when to take profit and when to cut a loss, coin by coin.</span></div>
          <div><i>🔮</i><b>Price predictions</b><span>What usually happened next in similar moments, with an honest score of how often it was right.</span></div>
          <div><i>✨</i><b>Ask AI</b><span>Ask about any coin or your portfolio in plain English, with a second opinion that checks the news.</span></div>
          <div><i>🔔</i><b>Alerts on your phone</b><span>A notification when a coin you own should be sold or hits its target, even with the app closed.</span></div>
          <div><i>🧪</i><b>Practice for free</b><span>A realistic trading simulator with pretend money, so you can learn without risking any.</span></div>
        </div>
      </div></section>
      <section class="lg-sec" id="lg-pricing"><div class="lg-wrap">
        <h2>Simple pricing</h2>
        <div class="lg-plans">
          <div><b>Free</b><strong>$0</strong><span>Signals, charts, alerts and the practice simulator.</span><button class="lg-btn ghost" data-auth="signup">Sign up</button></div>
          <div class="hl"><b>Pro trial</b><strong>${t.freeDays} days free</strong><span>Or ${t.depositDays} days for a $${t.depositUsd} deposit that comes off your first month.</span><button class="lg-btn blue" data-auth="signup">Start free</button></div>
          <div><b>Pro</b><strong>$${price}<small>/month</small></strong><span>Ask AI, wallet sell plans, predictions, buzz from 7 sources and more. Pay with card or crypto.</span><button class="lg-btn ghost" data-auth="signup">Get Pro</button></div>
        </div>
      </div></section>
      <section class="lg-sec alt" id="lg-faq"><div class="lg-wrap lg-faq">
        <h2>Questions</h2>
        <details><summary>Is this financial advice?</summary><p>No. Signals come from fixed rules on price data and are often wrong. Use them as one input, and never invest money you can't afford to lose.</p></details>
        <details><summary>Do you hold or trade my crypto?</summary><p>No. Signal Tips never holds your money and never places trades. Connecting a wallet only reads its public address.</p></details>
        <details><summary>How do I pay for Pro?</summary><p>With crypto (USDC, SOL, BTC or ETH) straight from your wallet, or by card where available.</p></details>
        <details><summary>Can I use it on my phone?</summary><p>Yes. Add it to your Home Screen, or use the iPhone app when it's released.</p></details>
      </div></section>
      <footer class="lg-foot"><div class="lg-wrap"><span>© ${new Date().getFullYear()} Signal Tips</span><a href="/privacy.html">Privacy</a><span>Market data: Coinbase public API. Not affiliated with Coinbase.</span></div></footer>`;
    document.body.appendChild(g);
    g.querySelector("[data-lg-signup]").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = e.target.querySelector("input").value.trim();
      openAuth("signup");
      const f = document.querySelector("#authDialog input[name=email]");
      if (f && email) { f.value = email; document.querySelector("#authDialog input[name=username]")?.focus(); }
    });
    // Live prices in the table (public market data; no account needed)
    g.querySelectorAll("[data-lsym]").forEach(async (tr) => {
      try {
        const s = await (await fetch(`/api/candles?sym=${tr.dataset.lsym}&kind=stats`)).json();
        const last = +s.last, ch = (last / +s.open - 1) * 100;
        tr.querySelector(".lg-px").textContent = "$" + last.toLocaleString("en-US", { maximumFractionDigits: last >= 1 ? 2 : 5 });
        const c = tr.querySelector(".lg-ch"); c.textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%"; c.className = "lg-ch " + (ch >= 0 ? "up" : "dn");
        const px = g.querySelector(`[data-lpx="${tr.dataset.lsym}"]`); if (px) px.textContent = "$" + last.toLocaleString("en-US", { maximumFractionDigits: last >= 1 ? 2 : 4 });
      } catch {}
    });
  }
  window.onSiteConfig = (c) => {
    cfg = c; renderPanel(); renderProBox(); renderAnnouncement(c.announcement);
    if ($("gate")) { const y = $("gate").scrollTop; $("gate").remove(); renderGate(); if ($("gate")) $("gate").scrollTop = y; } // show the sign-in options that are switched on
  };
  // Site announcement from the admin panel, until the visitor closes it
  function renderAnnouncement(a) {
    renderEmergency(a?.tone === "emergency" ? a : null);
    if (a?.tone === "emergency") a = null; // shown full screen instead of as a banner
    const el = $("announce");
    if (!el) return;
    const hidden = !a || store.get("announceClosed", "") === a.id;
    el.hidden = hidden;
    if (hidden) return;
    el.className = "announce a-" + (a.tone || "info");
    el.innerHTML = `<span>${esc(a.text)}</span><button class="x" aria-label="Close" data-announce-close="${esc(a.id)}">✕</button>`;
  }
  // Emergency: the whole screen turns red with giant text until the visitor taps "I understand"
  function renderEmergency(a) {
    let el = $("emergency");
    if (!a || store.get("emergencySeen", "") === a.id) { if (el) el.remove(); document.body.classList.remove("emergency-on"); return; }
    if (!el) { el = document.createElement("div"); el.id = "emergency"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
    if (el.dataset.id === a.id) return;
    el.dataset.id = a.id;
    el.innerHTML = `<div class="em-inner"><div class="em-tag">⚠ Important</div><h1>${esc(a.text)}</h1>
      <p class="em-time">From the Signal Tips team · ${new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      <button data-emergency-ok="${esc(a.id)}">I understand</button></div>`;
    document.body.classList.add("emergency-on");
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
  }
  // Check for announcements right away (the page's first settings load can arrive before this file is ready),
  // then every 10 seconds while the page is open, and whenever the visitor comes back to the tab
  const checkAnnouncement = () => fetch("/api/config?announce=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => c && renderAnnouncement(c.announcement)).catch(() => {});
  if (typeof siteConfig !== "undefined" && siteConfig && "announcement" in siteConfig) renderAnnouncement(siteConfig.announcement);
  checkAnnouncement();
  setInterval(() => { if (!document.hidden) checkAnnouncement(); }, 10_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAnnouncement(); });
  document.addEventListener("click", (e) => { const ok = e.target.closest("[data-emergency-ok]"); if (ok) { store.set("emergencySeen", ok.dataset.emergencyOk); renderEmergency(null); } });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-announce-close]"); if (b) { store.set("announceClosed", b.dataset.announceClose); $("announce").hidden = true; } });
  window.refreshPro = load;
  if (location.protocol !== "file:") load(); else setUser(null);

  // ── Install as an app (phone home screen) ──
  let deferred = null;
  // Inside the iPhone app (Capacitor) counts as installed too
  const nativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  if (nativeApp) document.documentElement.classList.add("native-app");
  const standalone = () => nativeApp || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; renderInstall(); });
  window.addEventListener("appinstalled", () => { deferred = null; toast("Signal Tips is on your home screen."); renderInstall(); });
  function renderInstall() {
    const el = $("installCard");
    if (el) {
      el.innerHTML = standalone() ? `<h3>${icon("check")} You're using the app</h3><p class="muted">Signal Tips is installed on this device.</p>`
        : `<h3>Get the app</h3><p>Install Signal Tips on your phone's home screen. It opens full screen like a normal app, with no app store needed.</p>
          ${deferred ? `<button class="primary pill" data-install>Install app</button>`
          : ios ? `<ol class="install-steps"><li>Open this site in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
          : `<ol class="install-steps"><li>Open this site in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li></ol>`}`;
    }
    const banner = $("installBanner");
    if (banner) banner.hidden = standalone() || store.get("installDismissed", false) || !(deferred || ios) || innerWidth > 900;
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-install]")) {
      if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; renderInstall(); }
      else { showTab("me"); $("installCard").scrollIntoView({ block: "center" }); }
    }
    if (e.target.closest("[data-install-dismiss]")) { store.set("installDismissed", true); renderInstall(); }
  });
  renderInstall();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
})();

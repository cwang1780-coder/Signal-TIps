// Accounts, Pro and the app install prompt.
// - Sign up / sign in (email + password). The session is an HttpOnly cookie the page can't read.
// - Plans: Free, 7-day Pro trial (no card), Pro (Stripe subscription), owner.
// - Pro features are unlocked with window.isPro(); window.proGate(name) shows the upgrade sheet when locked.
// - Signed-in accounts sync the watchlist, alerts, holdings and settings between devices (wallet addresses stay on the device).
// Uses globals from app.js: store, $, showTab, siteConfig. Icons from icons.js.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FREE = { coins: 10, alerts: 3 };
  const SYNCED = ["coins", "alerts", "holdings", "level", "levelChosen", "currency", "learnDone", "simBest", "trenchCB"];
  const PRO_FEATURES = [
    ["sparkle", "Ask AI", "Ask anything about a coin, your holdings or today's market, in plain English."],
    ["megaphone", "Buzz from 7 sources", "Bluesky, Mastodon, Hacker News, Lemmy and news headlines on top of StockTwits and trending searches, with a combined hype score."],
    ["flame", "The full Trench", "Every coin making a big move, not just the top 3, plus the Coinbase-only filter."],
    ["chart", "Deep coin research", "Chart patterns with years of history, similar past moments, and each coin's signal track record."],
    ["bell", "Unlimited watchlist and alerts", `Follow every coin you like and set as many alerts as you need (free: ${FREE.coins} coins, ${FREE.alerts} alerts).`],
    ["game", "Real-market simulator", "Practise on real past prices of a hidden coin, not just made-up scenarios."],
  ];

  let user = null, cfg = null, note = "", loaded = false;
  const plan = () => user?.plan || { pro: false, kind: "guest" };
  window.isPro = () => Boolean(plan().pro);
  window.account = () => user;

  async function api(action, opts = {}) {
    const init = { method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    const res = await fetch("/api/account?action=" + action, init);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(d.reason || "Something went wrong (HTTP " + res.status + ")."), { status: res.status });
    return d;
  }

  function setUser(u) {
    const wasPro = window.isPro();
    user = u;
    document.body.classList.toggle("signedIn", Boolean(u));
    document.body.classList.toggle("isPro", window.isPro());
    renderHeader(); renderPanel(); renderProBox();
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
    d.innerHTML = `<form method="dialog" class="sheet auth" novalidate>
      <button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>
      <h2>${mode === "signup" ? "Create your free account" : "Welcome back"}</h2>
      ${why ? `<p class="muted">${esc(why)}</p>` : `<p class="muted">${mode === "signup" ? `Keep your watchlist, alerts and settings on every device, and try Pro free for ${cfg?.trialDays || 7} days. No card needed.` : "Sign in to get your watchlist, alerts and Pro on this device."}</p>`}
      <label>Email or username<input name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
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
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !password) { err.textContent = "Enter your email or username and a password."; return; }
    btn.disabled = true; err.textContent = "";
    try {
      const d = await api(mode, { method: "POST", body: { email, password } });
      $("authDialog").close();
      setUser(d.user);
      toast(mode === "signup" ? "Account created. Welcome!" : "Signed in.");
      await syncAfterSignIn();
      if (afterAuth) { const f = afterAuth; afterAuth = null; f(); }
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  }
  let afterAuth = null;

  // ── upgrade sheet (paywall) ──
  function paywall(feature) {
    const d = $("authDialog"), p = plan(), price = cfg?.pro?.enabled && cfg.pro.price ? priceText(cfg.pro.price) : null;
    const cta = !user ? `<button class="primary pill lg" data-pw="signup">Create free account and start trial</button>`
      : !p.pro && !p.trialUsed && p.kind !== "lapsed" ? `<button class="primary pill lg" data-pw="trial">Start ${cfg?.trialDays || 7}-day free trial</button>`
      : cfg?.pro?.enabled ? `<button class="primary pill lg" data-pw="buy">Go Pro${price ? " · " + esc(price) : ""}</button>`
      : `<p class="muted">Pro subscriptions open soon. Your trial has ended; thanks for trying it!</p>`;
    d.innerHTML = `<div class="sheet paywall">
      <button type="button" class="x sheet-x" data-close-sheet aria-label="Close">✕</button>
      <span class="pro-badge">${icon("star")} Signal Tips Pro</span>
      <h2>${feature ? `${esc(feature)} is a Pro feature` : "Get more with Pro"}</h2>
      <ul class="pro-list">${PRO_FEATURES.map(([ic, t, s]) => `<li>${icon(ic)}<span><b>${t}</b><span class="muted">${s}</span></span></li>`).join("")}</ul>
      ${cta}
      <p class="muted small">${!user || (!p.pro && !p.trialUsed) ? `Free for ${cfg?.trialDays || 7} days, no card needed. ` : ""}${price ? `Then ${esc(price)}. ` : ""}Cancel anytime.</p>
    </div>`;
    if (!d.open) d.showModal();
  }
  window.paywall = paywall;
  window.showUpgrade = () => paywall("Ask AI");
  // Returns true if the feature can be used; otherwise shows the upgrade sheet.
  window.proGate = (feature) => { if (window.isPro()) return true; paywall(feature); return false; };
  window.freeLimits = FREE;

  async function startTrial() {
    try { const d = await api("trial", { method: "POST", body: {} }); setUser(d.user); $("authDialog").close(); toast(`Pro trial started: ${cfg?.trialDays || 7} days of everything.`); }
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
        <p>Create a free account to keep your watchlist, alerts and settings on your phone and computer, and try Pro free for ${cfg?.trialDays || 7} days.</p>
        <div class="acct-actions"><button class="primary pill" data-auth="signup">Create free account</button><button class="pill" data-auth="login">Sign in</button></div>`;
      return;
    }
    const p = plan(), price = cfg?.pro?.enabled && cfg.pro.price ? priceText(cfg.pro.price) : null;
    el.innerHTML = `<h3>Your account</h3>
      <div class="acct-row"><span class="avatar lg">${esc(user.email[0].toUpperCase())}</span><span><b>${esc(user.email)}</b><span class="muted small">Member since ${new Date(user.created).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></span></div>
      <p class="plan-line">${planLine(p)}</p>
      ${p.pro && typeof p.aiLimit === "number" ? `<p class="muted small">AI questions this month: ${user.aiUsed} of ${p.aiLimit}.</p>` : ""}
      <div class="acct-actions">
        ${!p.pro && !p.trialUsed && p.kind !== "lapsed" ? `<button class="primary pill" data-pw="trial">Start ${cfg?.trialDays || 7}-day free trial</button>` : ""}
        ${(p.kind !== "subscription" && p.kind !== "owner") && cfg?.pro?.enabled ? `<button class="${p.pro ? "pill" : "primary pill"}" data-pw="buy">Go Pro${price ? " · " + esc(price) : ""}</button>` : ""}
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
      box.innerHTML = `<div class="proRow"><span><b>${icon("star")} Ask AI is part of Pro.</b><br><span class="muted">Try it free for ${cfg?.trialDays || 7} days, no card needed.</span></span>
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
  async function handleReturn() {
    const q = new URLSearchParams(location.search), session = q.get("pro_session");
    if (!session && q.get("pro") !== "cancelled") return;
    history.replaceState(null, "", location.pathname);
    if (!session) return toast("Checkout cancelled. You have not been charged.");
    try { const d = await api("activate&session_id=" + encodeURIComponent(session)); setUser(d.user); toast("Welcome to Pro! Everything is unlocked."); }
    catch (e) { toast("Couldn't confirm your payment: " + e.message); }
  }

  async function load() {
    try { const d = await api("me"); setUser(d.user); } catch { setUser(null); }
    loaded = true;
    await handleReturn();
  }
  window.onSiteConfig = (c) => { cfg = c; renderPanel(); renderProBox(); renderAnnouncement(c.announcement); };
  // Site announcement from the admin panel, until the visitor closes it
  function renderAnnouncement(a) {
    const el = $("announce");
    if (!el) return;
    const hidden = !a || store.get("announceClosed", "") === a.id;
    el.hidden = hidden;
    if (hidden) return;
    el.className = "announce a-" + (a.tone || "info");
    el.innerHTML = `<span>${esc(a.text)}</span><button class="x" aria-label="Close" data-announce-close="${esc(a.id)}">✕</button>`;
  }
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

// Settings tab: appearance (dark/light), currency, signal timeframe, experience level, start page, motion, notifications
// and data. Theme and settings are saved in the browser and synced to the account (account.js SYNCED keys).
// Uses globals from app.js: store, $, showTab, render, Currency.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = () => store.get("settings", {});
  const setS = (k, v) => { const s = S(); s[k] = v; store.set("settings", s); };
  const theme = () => store.get("theme", "dark");
  const resolved = () => (theme() === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme());

  // The chart style that matches the page
  window.chartTheme = () => (resolved() === "dark" ? "night" : "light");
  function applyTheme() {
    const was = document.documentElement.dataset.theme, now = resolved();
    document.documentElement.dataset.theme = now;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", now === "dark" ? "#0a0b0d" : "#ffffff");
    document.documentElement.classList.toggle("reduce-motion", Boolean(S().reduceMotion));
    if (was !== now) { // charts draw their own colours: rebuild them
      window.remountChart?.();
      document.dispatchEvent(new Event("theme-changed"));
    }
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => theme() === "system" && applyTheme());

  const seg = (name, value, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, t]) => `<button role="radio" aria-checked="${v === value}" class="${v === value ? "on" : ""}" data-set="${name}" data-val="${esc(v)}">${t}</button>`).join("")}</div>`;
  const row = (title, sub, control) => `<div class="set-row"><div><b>${title}</b>${sub ? `<span class="muted small">${sub}</span>` : ""}</div><div class="set-ctl">${control}</div></div>`;
  const toggle = (name, on) => `<button class="tgl ${on ? "on" : ""}" role="switch" aria-checked="${on}" data-set="${name}" data-val="${on ? "0" : "1"}"><span></span></button>`;

  function render() {
    const el = $("settingsBody");
    if (!el) return;
    const s = S(), lvl = window.userLevel?.() || "beginner";
    const curOpts = window.Currency?.list?.() || [];
    el.innerHTML = `
      <div class="set-card"><h3>Appearance</h3>
        ${row("Theme", "Dark is easier on the eyes at night.", seg("theme", theme(), [["dark", "Dark"], ["light", "Light"], ["system", "Match device"]]))}
        ${row("Reduce motion", "Turns off animations and flashing.", toggle("reduceMotion", Boolean(s.reduceMotion)))}
      </div>
      <div class="set-card"><h3>Prices and signals</h3>
        ${row("Currency", "Prices are shown in this currency.", `<select data-set="currency">${curOpts.map((c) => `<option value="${esc(c)}"${c === window.Currency?.code ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>`)}
        ${row("Signal timeframe", "How far ahead you're thinking. Changes how the signals are worked out.", seg("tf", $("tf").value, [["86400", "Long-term"], ["21600", "Medium"], ["3600", "Short-term"]]))}
        ${row("Experience", "Beginner shows plain-English tips; experienced shows more numbers and tools.", seg("level", lvl, [["beginner", "Beginner"], ["pro", "Experienced"]]))}
      </div>
      <div class="set-card"><h3>Start-up</h3>
        ${row("Open on", "The page you see when you open the app.", `<select data-set="startTab">${[["", "Last page I used"], ["signals", "Signals"], ["coins", "My coins"], ["trench", "Trench"], ["ai", "Ask AI"], ["alerts", "Alerts"]].map(([v, t]) => `<option value="${v}"${(s.startTab || "") === v ? " selected" : ""}>${t}</option>`).join("")}</select>`)}
      </div>
      <div class="set-card"><h3>Notifications</h3>
        ${row("Phone notifications", "When to sell or take profit on coins you own, even with the app closed.", `<button class="pill" data-go="coins">Set up in My coins</button>`)}
        ${row("Price alerts", "Alerts for any price or signal change.", `<button class="pill" data-go="alerts">Manage alerts</button>`)}
      </div>
      <div class="set-card"><h3>Account and data</h3>
        ${row("Account", "Plan, password, Pro and signing out.", `<button class="pill" data-go="me">Open account</button>`)}
        ${row("Clear this device", "Removes the watchlist, coins, drawings and settings stored in this browser. Your account keeps its copy.", `<button class="pill danger" data-clear-local>Clear</button>`)}
        <p class="muted small" style="margin-top:8px"><a href="/privacy.html">Privacy policy</a></p>
      </div>`;
  }

  function set(name, val) {
    if (name === "theme") { store.set("theme", val); applyTheme(); }
    else if (name === "reduceMotion") { setS("reduceMotion", val === "1"); applyTheme(); }
    else if (name === "currency") { const c = $("curTop"); if (c) { c.value = val; c.dispatchEvent(new Event("change", { bubbles: true })); } }
    else if (name === "tf") { const t = $("tf"); t.value = val; t.dispatchEvent(new Event("change", { bubbles: true })); }
    else if (name === "level") window.chooseLevelFromSettings?.(val);
    else if (name === "startTab") setS("startTab", val);
    render();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-set]");
    if (b) return set(b.dataset.set, b.dataset.val);
    if (e.target.closest("[data-clear-local]") && confirm("Clear everything stored in this browser? You'll stay signed in, and your account keeps its copy.")) {
      const keep = ["seenSignedIn"];
      Object.keys(localStorage).filter((k) => !keep.includes(k)).forEach((k) => localStorage.removeItem(k));
      location.reload();
    }
  });
  document.addEventListener("change", (e) => { const s = e.target.closest("select[data-set]"); if (s) set(s.dataset.set, s.value); });
  window.renderSettings = render;
  window.startTabSetting = () => S().startTab || "";
  applyTheme();
  render();
})();

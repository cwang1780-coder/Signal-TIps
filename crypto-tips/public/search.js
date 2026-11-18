// Header search: find any coin trading on Coinbase in US dollars, open it, and add it to your watchlist.
// Uses globals from app.js: coins, coinIcon, coinName, addCoin, openCoin, API.
(function () {
  const input = document.getElementById("search"), list = document.getElementById("searchList");
  if (!input) return;
  let universe = null, items = [], active = -1;

  // Coins on Coinbase (USD markets), loaded once on first use; until then, the coins the app already knows.
  async function load() {
    if (universe) return;
    const known = new Set([...(typeof COIN_NAMES !== "undefined" ? Object.keys(COIN_NAMES) : []), ...coins]);
    universe = [...known];
    try {
      const r = await fetch(`${API}/products`, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      const d = await r.json();
      const live = d.filter((p) => p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled).map((p) => p.base_currency.toUpperCase());
      universe = [...new Set([...universe, ...live])].filter((s) => !["USDC", "USDT", "DAI", "PYUSD", "EURC"].includes(s));
      if (document.activeElement === input) show();
    } catch {}
  }

  function matches(q) {
    q = q.trim().toUpperCase();
    if (!q) return coins.slice(0, 8);
    const scored = [];
    for (const sym of universe || coins) {
      const name = (coinName(sym) || "").toUpperCase();
      const score = sym === q ? 0 : sym.startsWith(q) ? 1 : name.startsWith(q) ? 2 : name.includes(q) ? 3 : sym.includes(q) ? 4 : -1;
      if (score >= 0) scored.push([score, sym.length, sym]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
    const out = scored.slice(0, 8).map((x) => x[2]);
    if (!out.length && /^[A-Z0-9]{1,15}$/.test(q)) out.push(q); // let people try any ticker
    return out;
  }

  function show() {
    items = matches(input.value);
    active = items.length ? 0 : -1;
    list.innerHTML = items.length ? items.map((sym, i) => `<li role="option" id="sr-${i}" data-sym="${sym}" aria-selected="${i === active}">
        ${coinIcon(sym, 28)}<span class="s-nm"><b>${coinName(sym) || sym}</b><span>${sym}</span></span>
        <span class="s-tag">${coins.includes(sym) ? "In watchlist" : "+ Add"}</span></li>`).join("")
      : `<li class="muted" aria-disabled="true">No coins found</li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", active >= 0 ? "sr-" + active : "");
  }
  function hide() { list.hidden = true; input.setAttribute("aria-expanded", "false"); document.body.classList.remove("searchOpen"); }
  function pick(sym) {
    input.value = ""; hide(); input.blur();
    addCoin(sym);         // no-op if it's already in the watchlist
    openCoin(sym);
  }
  function move(d) {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    list.querySelectorAll("li[data-sym]").forEach((li, i) => li.setAttribute("aria-selected", i === active));
    input.setAttribute("aria-activedescendant", "sr-" + active);
  }

  input.addEventListener("focus", () => { load(); show(); });
  input.addEventListener("input", show);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) pick(items[active]); }
    else if (e.key === "Escape") { hide(); input.blur(); }
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-sym]"); if (li) { e.preventDefault(); pick(li.dataset.sym); } });
  input.addEventListener("blur", () => setTimeout(hide, 120));
  // "/" jumps to search, like many trading sites
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); document.body.classList.add("searchOpen"); input.focus(); }
  });
})();

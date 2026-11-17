// Display currency. All prices in the app are US dollars internally (Coinbase's USD markets);
// this converts them for display, and converts prices people type (alerts, what you paid) back to USD.
// Rates: Coinbase's public exchange rates via /api/config (cached), remembered in this browser.
(function () {
  const NAMES = { USD: "US dollar", CAD: "Canadian dollar", EUR: "Euro", GBP: "British pound", AUD: "Australian dollar", NZD: "New Zealand dollar",
    JPY: "Japanese yen", INR: "Indian rupee", MXN: "Mexican peso", BRL: "Brazilian real", PHP: "Philippine peso", NGN: "Nigerian naira",
    ZAR: "South African rand", CHF: "Swiss franc", SGD: "Singapore dollar", HKD: "Hong Kong dollar", KRW: "South Korean won", TRY: "Turkish lira",
    SEK: "Swedish krona", NOK: "Norwegian krone", PLN: "Polish złoty", AED: "UAE dirham" };
  // A sensible first guess from the browser's region (en-CA → CAD, fr-FR → EUR...). Changeable any time.
  const REGION = { CA: "CAD", GB: "GBP", AU: "AUD", NZ: "NZD", JP: "JPY", IN: "INR", MX: "MXN", BR: "BRL", PH: "PHP", NG: "NGN", ZA: "ZAR", CH: "CHF",
    SG: "SGD", HK: "HKD", KR: "KRW", TR: "TRY", SE: "SEK", NO: "NOK", PL: "PLN", AE: "AED" };
  const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const guess = () => {
    const region = (navigator.languages?.[0] || navigator.language || "").split("-")[1]?.toUpperCase();
    return REGION[region] || (EURO.includes(region) ? "EUR" : "USD");
  };

  let rates = read("fxRates", null);               // {USD:1, CAD:1.43, ...}
  let code = read("currency", null) || guess();
  const rate = () => (code === "USD" ? 1 : rates?.[code] || null);
  const active = () => (rate() ? code : "USD");    // until rates arrive, show USD rather than a wrong number
  const fmts = {};
  const nf = (cur, opts) => (fmts[cur + JSON.stringify(opts)] ||= new Intl.NumberFormat(undefined, { style: "currency", currency: cur, ...opts }));

  const C = {
    names: NAMES,
    get code() { return active(); },
    get chosen() { return code; },
    list: () => Object.keys(NAMES).filter((c) => c === "USD" || rates?.[c]),
    toLocal: (usd) => usd * (rate() || 1),
    toUsd: (local) => local / (rate() || 1),
    // A price: 2 decimals normally, 4 significant digits for tiny prices (e.g. SHIB).
    fmt(usd) {
      if (usd == null || !isFinite(usd)) return "—";
      const v = C.toLocal(usd), cur = active(), a = Math.abs(v);
      if (a > 0 && a < 1) return nf(cur, { minimumSignificantDigits: 2, maximumSignificantDigits: 4 }).format(v);
      return nf(cur, { maximumFractionDigits: cur === "JPY" || cur === "KRW" ? 0 : 2 }).format(v);
    },
    // Big amounts: $2.2T, $48.1M
    compact(usd) {
      if (usd == null || !isFinite(usd)) return "—";
      return nf(active(), { notation: "compact", maximumFractionDigits: 1 }).format(C.toLocal(usd));
    },
    // Short label for input placeholders: "C$", "€", "$"
    symbol() { return nf(active(), {}).formatToParts(0).find((p) => p.type === "currency")?.value || active(); },
    set(c) {
      code = c; write("currency", c);
      document.dispatchEvent(new Event("currency-changed"));
    },
  };
  window.Currency = C;

  async function loadRates() {
    let fresh = null;
    try { const r = await fetch("/api/config"); if (r.ok) fresh = (await r.json()).fx; } catch {}
    if (!fresh) {
      try { const r = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD"); const all = (await r.json()).data.rates; fresh = Object.fromEntries(Object.keys(NAMES).filter((c) => +all[c] > 0).map((c) => [c, +all[c]])); } catch {}
    }
    if (fresh?.CAD) { rates = fresh; write("fxRates", rates); document.dispatchEvent(new Event("currency-changed")); }
  }
  if (location.protocol !== "file:") { loadRates(); setInterval(loadRates, 60 * 60 * 1000); }
})();

// Site switches and prices the admin can change from the admin panel (no Vercel visit needed).
// Kept in storage at site/settings.json; read through a short cache. Values not set fall back to the defaults below.
const db = require("./storage.js");

const KEY = "site/settings.json";
const DEFAULTS = {
  maintenance: false, maintenanceMessage: "We're making some improvements. Back soon!",
  signupsOpen: true,
  aiEnabled: true,
  priceUsd: null,      // null = CRYPTO_PRO_PRICE_USD or 5
  freeTrialDays: 3,
  depositTrialDays: 7,
  depositUsd: null,    // null = TRIAL_DEPOSIT_USD or 1
};
let cache = { at: 0, value: { ...DEFAULTS } };

async function load() {
  if (Date.now() - cache.at < 15_000) return cache.value;
  try { cache = { at: Date.now(), value: { ...DEFAULTS, ...((db.available() && (await db.getJSON(KEY))) || {}) } }; }
  catch { cache.at = Date.now(); }
  return cache.value;
}
const get = () => cache.value; // the last loaded values (callers await load() first where it matters)

function clean(input = {}) {
  const out = {}, num = (v, lo, hi) => { const n = parseFloat(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined; };
  if ("maintenance" in input) out.maintenance = Boolean(input.maintenance);
  if ("maintenanceMessage" in input) out.maintenanceMessage = String(input.maintenanceMessage || "").slice(0, 200) || DEFAULTS.maintenanceMessage;
  if ("signupsOpen" in input) out.signupsOpen = Boolean(input.signupsOpen);
  if ("aiEnabled" in input) out.aiEnabled = Boolean(input.aiEnabled);
  if ("priceUsd" in input) out.priceUsd = input.priceUsd === null || input.priceUsd === "" ? null : num(input.priceUsd, 1, 1000);
  if ("freeTrialDays" in input) out.freeTrialDays = Math.round(num(input.freeTrialDays, 0, 60) ?? 3);
  if ("depositTrialDays" in input) out.depositTrialDays = Math.round(num(input.depositTrialDays, 1, 60) ?? 7);
  if ("depositUsd" in input) out.depositUsd = input.depositUsd === null || input.depositUsd === "" ? null : num(input.depositUsd, 0.5, 50);
  return out;
}
async function save(input) {
  const current = { ...((await db.getJSON(KEY).catch(() => null)) || {}) };
  const next = { ...current, ...clean(input) };
  await db.putJSON(KEY, next);
  cache = { at: Date.now(), value: { ...DEFAULTS, ...next } };
  return cache.value;
}
// For tests
const reset = () => { cache = { at: 0, value: { ...DEFAULTS } }; };

module.exports = { load, get, save, reset, DEFAULTS };

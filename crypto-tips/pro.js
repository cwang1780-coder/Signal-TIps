// Pro subscriptions via Stripe — no database and no user accounts.
//
// How it works:
// 1. "Go Pro" creates a Stripe Checkout session (monthly subscription) and sends the visitor to Stripe's hosted page.
// 2. Stripe sends them back with a session id. We confirm it with Stripe and hand the browser a Pro key:
//    the Stripe subscription id plus a signature only this server can make.
// 3. Every Pro request re-checks the subscription with Stripe (cached for a minute), so cancelling or a failed
//    payment switches Pro off without webhooks.
// 4. AI usage is counted per calendar month in the subscription's own metadata on Stripe.
//
// Settings (environment variables):
//   STRIPE_SECRET_KEY        your Stripe secret key (sk_live_... or sk_test_...)
//   STRIPE_PRICE_ID          the recurring price to sell (price_...)
//   PRO_AI_MONTHLY_LIMIT     AI questions per subscriber per month (default 150)
const crypto = require("crypto");

const API = () => process.env.STRIPE_API_BASE || "https://api.stripe.com";
const enabled = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
const monthlyLimit = () => Math.max(1, parseInt(process.env.PRO_AI_MONTHLY_LIMIT, 10) || 150);
const b64url = (buf) => buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// Stripe wants form encoding with bracketed keys: line_items[0][price]=...
function form(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object") form(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}

async function stripe(method, path, params) {
  const res = await fetch(API() + path, {
    method,
    headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? form(params).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || "Stripe error " + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Pro keys ──
const signingKey = () => crypto.createHash("sha256").update("pro-key-v1:" + process.env.STRIPE_SECRET_KEY).digest();
const sign = (subId) => b64url(crypto.createHmac("sha256", signingKey()).update(subId).digest()).slice(0, 32);
const makeKey = (subId) => `${subId}.${sign(subId)}`;

function verifyKey(key) {
  const m = /^(sub_[A-Za-z0-9]{5,60})\.([A-Za-z0-9_-]{32})$/.exec(String(key || "").trim());
  if (!m) return null;
  const good = Buffer.from(sign(m[1])), given = Buffer.from(m[2]);
  return good.length === given.length && crypto.timingSafeEqual(good, given) ? m[1] : null;
}

// ── Stripe calls ──
// With a signed-in user, the checkout is tied to their account (client_reference_id) and pre-fills their email.
async function createCheckout(origin, user) {
  const s = await stripe("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: origin + "/?pro_session={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/?pro=cancelled",
    allow_promotion_codes: true,
    ...(user ? { client_reference_id: user.id, customer_email: user.email, subscription_data: { metadata: { account: user.id } } } : {}),
  });
  return s.url;
}

// Confirm a completed checkout belongs to this account and return its subscription id.
async function subscriptionFor(sessionId, user) {
  if (!/^cs_[A-Za-z0-9_]{5,200}$/.test(sessionId || "")) throw Object.assign(new Error("Invalid checkout session"), { status: 400 });
  const s = await stripe("GET", "/v1/checkout/sessions/" + sessionId);
  const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
  if (s.status !== "complete" || !subId) throw Object.assign(new Error("That checkout was not completed"), { status: 402 });
  if (s.client_reference_id && s.client_reference_id !== user.id) throw Object.assign(new Error("That checkout belongs to a different account."), { status: 403 });
  return subId;
}

async function activate(sessionId) {
  if (!/^cs_[A-Za-z0-9_]{5,200}$/.test(sessionId || "")) throw Object.assign(new Error("Invalid checkout session"), { status: 400 });
  const s = await stripe("GET", "/v1/checkout/sessions/" + sessionId);
  const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
  if (s.status !== "complete" || !subId) throw Object.assign(new Error("That checkout was not completed"), { status: 402 });
  return makeKey(subId);
}

const subCache = new Map(); // subId -> {at, sub}
async function getSub(subId, fresh) {
  const hit = subCache.get(subId);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.sub;
  const sub = await stripe("GET", "/v1/subscriptions/" + subId);
  subCache.set(subId, { at: Date.now(), sub });
  return sub;
}

const month = () => new Date().toISOString().slice(0, 7);
const usedThisMonth = (sub) => (sub.metadata?.ai_month === month() ? parseInt(sub.metadata.ai_count, 10) || 0 : 0);

// Returns { ok, reason?, subId, used, limit, status, cancelAtPeriodEnd, periodEnd }
async function check(key, { fresh = false } = {}) {
  const subId = verifyKey(key);
  if (!subId) return { ok: false, reason: "That Pro key isn't valid." };
  return checkSub(subId, fresh);
}
async function checkSub(subId, fresh = false) {
  let sub;
  try { sub = await getSub(subId, fresh); }
  catch (e) { return { ok: false, reason: e.status === 404 ? "That subscription no longer exists." : "Couldn't check your subscription right now. Try again shortly." }; }
  const active = sub.status === "active" || sub.status === "trialing";
  return {
    ok: active,
    reason: active ? null : `Your subscription is ${String(sub.status).replace("_", " ")}.`,
    subId, status: sub.status, used: usedThisMonth(sub), limit: monthlyLimit(),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    periodEnd: sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null,
  };
}

// Count one AI question. Reads fresh so parallel requests don't share a stale count.
async function consume(subId) {
  const sub = await getSub(subId, true);
  const count = usedThisMonth(sub) + 1;
  const updated = await stripe("POST", "/v1/subscriptions/" + subId, { metadata: { ai_month: month(), ai_count: count } });
  subCache.set(subId, { at: Date.now(), sub: updated });
  return count;
}

async function portalUrl(subId, origin) {
  const sub = await getSub(subId);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const s = await stripe("POST", "/v1/billing_portal/sessions", { customer, return_url: origin + "/" });
  return s.url;
}

let priceCache = null;
async function getPrice() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60000) return priceCache.data;
  const p = await stripe("GET", "/v1/prices/" + process.env.STRIPE_PRICE_ID);
  const data = { amount: p.unit_amount / 100, currency: String(p.currency || "usd").toUpperCase(), interval: p.recurring?.interval || "month" };
  priceCache = { at: Date.now(), data };
  return data;
}

module.exports = { enabled, monthlyLimit, makeKey, verifyKey, createCheckout, subscriptionFor, activate, check, checkSub, consume, portalUrl, getPrice, form };

// Admin panel actions (owner accounts only; the checks are in handlers.js).
// Reads and changes the account records in storage; never shows password hashes, session tokens or keys.
const crypto = require("crypto");
const db = require("./storage.js");
const accounts = require("./accounts.js");
const push = require("./push.js");
const ai = require("./ai.js");
const bans = require("./bans.js");
const pro = require("./pro.js");

const err = (status, message) => Object.assign(new Error(message), { status });
const ANNOUNCE_KEY = "site/announcement.json";

async function allUsers() {
  const keys = await db.listKeys("users/");
  const users = await Promise.all(keys.slice(0, 5000).map((k) => db.getJSON(k).catch(() => null)));
  return users.filter((u) => u && u.id);
}

// What they've set up on the site (synced to their account): watchlist, holdings, wallets, alerts, settings
function summary(d) {
  if (!d) return null;
  const short = (a) => (String(a).length > 14 ? String(a).slice(0, 6) + "…" + String(a).slice(-4) : String(a));
  return {
    watchlist: Array.isArray(d.coins) ? d.coins.slice(0, 40) : [],
    holdings: Array.isArray(d.holdings) ? d.holdings.slice(0, 40).map((h) => ({ coin: h.sym, amount: h.amt, paid: h.cost || null })) : [],
    wallets: Array.isArray(d.wallets) ? d.wallets.slice(0, 20).map((w) => ({ network: w.chain, address: short(w.address), label: w.label || "" })) : [],
    paidPrices: d.paidPrices && typeof d.paidPrices === "object" ? d.paidPrices : {},
    alerts: Array.isArray(d.alerts) ? d.alerts.length : 0,
    level: d.level || null, currency: d.currency || null, theme: d.theme || null,
  };
}

// What the panel shows for one user (no password hash, no synced settings)
async function row(u) {
  const plan = await accounts.planOf(u).catch(() => ({ kind: "unknown" }));
  return {
    id: u.id, name: u.email, created: u.created || null, lastLogin: u.lastLogin || null,
    plan: plan.kind, pro: Boolean(plan.pro), trialEnds: u.trialEnds || null, comp: u.comp || null, subscription: Boolean(u.subId),
    aiUsed: accounts.aiUsed(u), suspended: accounts.isBanned(u), banUntil: accounts.isBanned(u) ? u.banned.until || null : null, banReason: accounts.isBanned(u) ? u.banned.reason || "" : "", owner: plan.kind === "owner",
    location: u.location || null, ips: (u.ips || []).map((x) => ({ mask: x.mask, at: x.at })),
    lastSeen: u.lastSeen || u.lastLogin || null, visits: u.visits || 0, logins: u.logins || 0, device: u.device || null, country: u.country || null,
    proUntil: plan.until || null, payments: (u.payments || []).slice(-10).reverse().map((p) => ({ method: p.method, amount: p.amount, usd: p.usd, at: p.at, tx: p.tx })),
    data: summary(u.prefs?.data), dataUpdated: u.prefs?.updated || null,
  };
}

async function overview() {
  const users = await allUsers();
  const rows = await Promise.all(users.map(row));
  const now = Date.now(), day = 864e5;
  const byPlan = {};
  for (const r of rows) byPlan[r.plan] = (byPlan[r.plan] || 0) + 1;
  const pushKeys = await db.listKeys("push/").catch(() => []);
  const subs = (await Promise.all(pushKeys.slice(0, 2000).map((k) => db.getJSON(k).catch(() => null)))).filter(Boolean);
  const coinCount = {};
  for (const s of subs) for (const c of s.coins || []) coinCount[c.sym] = (coinCount[c.sym] || 0) + 1;
  const lastRun = await db.getJSON("push-meta/run.json").catch(() => null);
  return {
    users: rows.length, byPlan,
    signups: { last24h: rows.filter((r) => r.created > now - day).length, last7d: rows.filter((r) => r.created > now - 7 * day).length, last30d: rows.filter((r) => r.created > now - 30 * day).length },
    activeLast7d: rows.filter((r) => (r.lastSeen || r.lastLogin) > now - 7 * day).length,
    activeToday: rows.filter((r) => (r.lastSeen || r.lastLogin) > now - day).length,
    aiQuestionsThisMonth: rows.reduce((t, r) => t + r.aiUsed, 0),
    cryptoPayments: (() => {
      const all = users.flatMap((u) => (u.payments || []).map((p) => ({ ...p, user: u.email })));
      const month = all.filter((p) => p.at > now - 30 * day);
      return { count: all.length, usdTotal: Math.round(all.reduce((t, p) => t + (p.usd || 0), 0) * 100) / 100, last30dUsd: Math.round(month.reduce((t, p) => t + (p.usd || 0), 0) * 100) / 100,
        recent: all.sort((a, b) => b.at - a.at).slice(0, 10).map((p) => ({ user: p.user, method: p.method, amount: p.amount, usd: p.usd, at: p.at, tx: p.tx })) };
    })(),
    push: { devices: subs.length, iphoneApp: subs.filter((s) => s.apns).length, browsers: subs.filter((s) => s.sub).length, lastCheck: lastRun?.at || null,
      topCoins: Object.entries(coinCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sym, n]) => ({ sym, devices: n })) },
    services: {
      storage: db.available(), ai: ai.hasCredentials(), aiProvider: ai.provider(), aiModel: ai.provider() === "gemini" ? ai.GEMINI_MODEL : ai.MODEL,
      payments: pro.enabled(), cryptoPayments: require("./cryptopay.js").enabled(), webPush: push.webConfigured(), iphonePush: push.apnsConfigured(),
    },
    announcement: await getAnnouncement(),
  };
}

async function users() {
  const rows = await Promise.all((await allUsers()).map(row));
  return rows.sort((a, b) => (b.created || 0) - (a.created || 0));
}

const DAY = 864e5;
async function userAction(id, op, arg = {}) {
  if (!/^[a-f0-9]{40}$/.test(String(id))) throw err(400, "Bad user id");
  const u = await accounts.getUser(id);
  if (!u) throw err(404, "That account no longer exists.");
  const isOwner = (await accounts.planOf(u)).kind === "owner";
  const days = Math.max(1, Math.min(3650, parseInt(arg.days, 10) || 30));
  let note = "";
  switch (op) {
    case "grantPro": u.comp = { since: Date.now(), until: arg.forever ? null : Date.now() + days * DAY }; note = arg.forever ? "Free Pro granted (no end date)." : `Free Pro granted for ${days} days.`; break;
    case "revokePro": u.comp = null; note = "Free Pro removed. (A paid subscription, if any, is managed in Stripe.)"; break;
    case "extendTrial": u.trialEnds = Math.max(u.trialEnds || 0, Date.now()) + days * DAY; note = `Trial now ends ${new Date(u.trialEnds).toDateString()}.`; break;
    case "resetAi": u.ai = null; note = "AI questions for this month reset to 0."; break;
    case "suspend": case "ban": {
      if (isOwner) throw err(400, "Owner accounts can't be banned.");
      const d = Math.max(0, Math.min(3650, parseInt(arg.days, 10) || 0)), reason = String(arg.reason || "").trim().slice(0, 200);
      u.banned = { since: Date.now(), until: d ? Date.now() + d * DAY : null, reason };
      // Also ban the internet addresses this account used recently, so a new account from there is blocked too
      const ips = (u.ips || []).filter((x) => Date.now() - x.at < 30 * DAY);
      if (arg.ip !== false && ips.length) await bans.banHashes(ips.map((x) => x.hash), { days: d, reason, user: u.id, masks: Object.fromEntries(ips.map((x) => [x.hash, x.mask])) });
      note = `Banned ${d ? "for " + d + " day" + (d === 1 ? "" : "s") : "with no end date"}${ips.length && arg.ip !== false ? `, with ${ips.length} internet address${ips.length === 1 ? "" : "es"}` : ""}. They're signed out and blocked.`;
      break;
    }
    case "unsuspend": case "unban": u.banned = null; await bans.unbanUser(u.id); note = "Unbanned (account and its addresses)."; break;
    case "resetPassword": {
      if (isOwner) throw err(400, "Change owner passwords in Vercel (OWNER_ACCOUNT / OWNER_ACCOUNTS).");
      const temp = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
      u.pw = accounts.hashPassword(temp);
      u.sessionsFrom = Date.now(); // signs them out everywhere
      await accounts.saveUser(u);
      return { ok: true, note: "New temporary password (shown once). Give it to them privately and ask them to change it under Me.", tempPassword: temp, user: await row(u) };
    }
    case "delete": if (isOwner) throw err(400, "Owner accounts can't be deleted here."); await db.delKey(`users/${u.id}.json`); return { ok: true, note: "Account deleted.", deleted: true };
    default: throw err(400, "Unknown action");
  }
  await accounts.saveUser(u);
  return { ok: true, note, user: await row(u) };
}

// Site-wide banner, shown to every visitor until they close it
async function getAnnouncement() { return (await db.getJSON(ANNOUNCE_KEY).catch(() => null)) || null; }
async function setAnnouncement({ text, tone }) {
  text = String(text || "").trim().slice(0, 280);
  if (!text) { await db.delKey(ANNOUNCE_KEY).catch(() => {}); return { ok: true, announcement: null }; }
  const a = { text, tone: ["info", "warn", "good", "emergency"].includes(tone) ? tone : "info", id: Date.now().toString(36), at: Date.now() };
  await db.putJSON(ANNOUNCE_KEY, a);
  return { ok: true, announcement: a };
}

async function banList() {
  const l = await bans.list();
  return Object.entries(l).map(([hash, b]) => ({ id: hash.slice(0, 12), mask: b.mask, until: b.until, reason: b.reason, user: b.user, at: b.at }));
}
async function unbanIp(idPrefix) {
  const l = await bans.list(), h = Object.keys(l).find((k) => k.startsWith(String(idPrefix)) && String(idPrefix).length === 12);
  if (!h) throw err(404, "That ban was already lifted.");
  await bans.unbanHash(h);
  return { ok: true };
}

module.exports = { overview, users, userAction, getAnnouncement, setAnnouncement, banList, unbanIp };

// Admin panel actions (owner accounts only; the checks are in handlers.js).
// Reads and changes the account records in storage; never shows password hashes, session tokens or keys.
const crypto = require("crypto");
const db = require("./storage.js");
const accounts = require("./accounts.js");
const push = require("./push.js");
const ai = require("./ai.js");
const pro = require("./pro.js");

const err = (status, message) => Object.assign(new Error(message), { status });
const ANNOUNCE_KEY = "site/announcement.json";

async function allUsers() {
  const keys = await db.listKeys("users/");
  const users = await Promise.all(keys.slice(0, 5000).map((k) => db.getJSON(k).catch(() => null)));
  return users.filter((u) => u && u.id);
}

// What the panel shows for one user (no password hash, no synced settings)
async function row(u) {
  const plan = await accounts.planOf(u).catch(() => ({ kind: "unknown" }));
  return {
    id: u.id, name: u.email, created: u.created || null, lastLogin: u.lastLogin || null,
    plan: plan.kind, pro: Boolean(plan.pro), trialEnds: u.trialEnds || null, comp: u.comp || null, subscription: Boolean(u.subId),
    aiUsed: accounts.aiUsed(u), suspended: Boolean(u.banned), owner: plan.kind === "owner",
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
    activeLast7d: rows.filter((r) => r.lastLogin > now - 7 * day).length,
    aiQuestionsThisMonth: rows.reduce((t, r) => t + r.aiUsed, 0),
    push: { devices: subs.length, iphoneApp: subs.filter((s) => s.apns).length, browsers: subs.filter((s) => s.sub).length, lastCheck: lastRun?.at || null,
      topCoins: Object.entries(coinCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sym, n]) => ({ sym, devices: n })) },
    services: {
      storage: db.available(), ai: ai.hasCredentials(), aiProvider: ai.provider(), aiModel: ai.provider() === "gemini" ? ai.GEMINI_MODEL : ai.MODEL,
      payments: pro.enabled(), webPush: push.webConfigured(), iphonePush: push.apnsConfigured(),
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
    case "suspend": if (isOwner) throw err(400, "Owner accounts can't be suspended."); u.banned = { since: Date.now() }; note = "Suspended: they're signed out and can't sign in."; break;
    case "unsuspend": u.banned = null; note = "Unsuspended."; break;
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
  const a = { text, tone: ["info", "warn", "good"].includes(tone) ? tone : "info", id: Date.now().toString(36), at: Date.now() };
  await db.putJSON(ANNOUNCE_KEY, a);
  return { ok: true, announcement: a };
}

module.exports = { overview, users, userAction, getAnnouncement, setAnnouncement };

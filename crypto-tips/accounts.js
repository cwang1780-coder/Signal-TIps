// Accounts: email + password, a signed session cookie, plan (free / trial / Pro), AI usage and synced settings.
// Passwords are stored only as salted scrypt hashes. Nothing else personal is collected.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./storage.js");
const pro = require("./pro.js");

const COOKIE = "st_sess";
const SESSION_DAYS = 30;
const TRIAL_DAYS = 7;
const TRIAL_AI_LIMIT = 20;
const PREFS_MAX = 60_000; // bytes of synced settings per account

// Session signing key: SESSION_SECRET if set, else derived from the (secret) storage token, else a local file.
let localSecret = null;
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.BLOB_READ_WRITE_TOKEN) return crypto.createHash("sha256").update("st-session-v1:" + process.env.BLOB_READ_WRITE_TOKEN).digest("hex");
  if (!localSecret) {
    const f = path.join(__dirname, ".data", "session-secret.txt");
    try { localSecret = fs.readFileSync(f, "utf8").trim(); } catch {}
    if (!localSecret) { localSecret = crypto.randomBytes(32).toString("hex"); try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, localSecret); } catch {} }
  }
  return localSecret;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const normEmail = (e) => String(e || "").trim().toLowerCase();
// An account name is an email address or a username (3-30 letters, numbers, dots, dashes, underscores).
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e) && e.length <= 254;
const isUsername = (e) => /^[a-z0-9][a-z0-9._-]{2,29}$/i.test(e);
const validEmail = (e) => isEmail(e) || isUsername(e);
const emailId = (e) => crypto.createHash("sha256").update("acct-v1:" + normEmail(e)).digest("hex").slice(0, 40);
const userKey = (id) => `users/${id}.json`;
const err = (status, message) => Object.assign(new Error(message), { status });

// ── passwords ──
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [kind, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashHex, "hex");
  return want.length === hash.length && crypto.timingSafeEqual(want, hash);
}
function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Use at least 8 characters for your password.";
  if (pw.length > 200) return "That password is too long.";
  return null;
}

// ── sessions (stateless, signed) ──
function makeToken(id) {
  const body = b64url(JSON.stringify({ id, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}
// When a session token was issued (0 for tokens made before this was recorded)
function tokenIssued(tok) {
  try { return JSON.parse(Buffer.from(String(tok).split(".")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).iat || 0; } catch { return 0; }
}
function readToken(tok) {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig) return null;
  const want = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return p.exp > Date.now() && /^[a-f0-9]{40}$/.test(p.id) ? p.id : null;
  } catch { return null; }
}
const cookieValue = (req) => (String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1];
function sessionCookie(token, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

// ── users ──
const getUser = (id) => db.getJSON(userKey(id));
const saveUser = (u) => db.putJSON(userKey(u.id), u);

async function signup(email, password) {
  email = normEmail(email);
  if (!validEmail(email)) throw err(400, "Enter an email address, or a username of 3 to 30 letters and numbers.");
  const bad = passwordProblem(password);
  if (bad) throw err(400, bad);
  const id = emailId(email);
  if (await getUser(id) || ownerSeed(email)) throw err(409, "That name is already taken. Sign in instead.");
  const u = { id, email, pw: hashPassword(password), created: Date.now(), lastLogin: Date.now(), trialEnds: null, subId: null, ai: null, prefs: null };
  await saveUser(u);
  return u;
}

// Owner accounts can be set up without a database write: OWNER_ACCOUNT / OWNER_ACCOUNTS = "name:scrypt$salt$hash"
// (password hashes, never passwords), several separated by ";". Each is created the first time its owner signs in.
function ownerSeeds() {
  return `${process.env.OWNER_ACCOUNT || ""};${process.env.OWNER_ACCOUNTS || ""}`.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)
    .map((x) => /^([^:]+):(scrypt\$[0-9a-f]+\$[0-9a-f]+)$/.exec(x)).filter(Boolean).map((m) => ({ name: normEmail(m[1]), pw: m[2] }));
}
const ownerSeed = (name) => ownerSeeds().find((o) => o.name === name) || null;

async function login(email, password) {
  email = normEmail(email);
  let u = validEmail(email) ? await getUser(emailId(email)) : null;
  const seed = ownerSeed(email);
  if (!u && seed && checkPassword(String(password || ""), seed.pw)) {
    u = { id: emailId(email), email, pw: seed.pw, created: Date.now(), trialEnds: null, subId: null, ai: null, prefs: null };
    await saveUser(u);
  }
  // Same message and similar timing whether or not the account exists.
  const ok = u ? checkPassword(String(password || ""), u.pw) : (checkPassword("x", hashPassword("y")), false);
  if (!ok) throw err(401, "Wrong email or password.");
  if (u.banned) throw err(403, "This account has been suspended. Contact the site owner.");
  u.lastLogin = Date.now();
  await saveUser(u).catch(() => {});
  return u;
}

async function userFromRequest(req) {
  const tok = cookieValue(req), id = readToken(tok);
  const u = id ? await getUser(id) : null;
  if (!u || u.banned) return null; // suspended accounts are signed out
  if (u.sessionsFrom && tokenIssued(tok) < u.sessionsFrom) return null; // password was reset: older sessions end
  return u;
}

const owners = () => [...String(process.env.OWNER_EMAILS || "").split(",").map(normEmail).filter(Boolean), ...ownerSeeds().map((o) => o.name)];

// What the account can use right now.
async function planOf(u) {
  if (!u) return { pro: false, kind: "guest" };
  if (owners().includes(u.email)) return { pro: true, kind: "owner", aiLimit: Infinity };
  if (u.subId && pro.enabled()) {
    const c = await pro.checkSub(u.subId);
    if (c.ok) return { pro: true, kind: "subscription", aiLimit: pro.monthlyLimit(), cancelAtPeriodEnd: c.cancelAtPeriodEnd, periodEnd: c.periodEnd, status: c.status };
    if (c.status) return { pro: false, kind: "lapsed", status: c.status, reason: c.reason, trialUsed: Boolean(u.trialEnds) };
  }
  // Pro paid for with crypto (cryptopay.js)
  if (u.cryptoUntil && u.cryptoUntil > Date.now()) return { pro: true, kind: "crypto", until: u.cryptoUntil, aiLimit: pro.monthlyLimit() };
  // Free Pro given by the owner in the admin panel
  if (u.comp && (u.comp.until == null || u.comp.until > Date.now())) return { pro: true, kind: "comp", until: u.comp.until, aiLimit: pro.monthlyLimit() };
  if (u.trialEnds && u.trialEnds > Date.now()) return { pro: true, kind: "trial", until: u.trialEnds, aiLimit: TRIAL_AI_LIMIT };
  return { pro: false, kind: "free", trialUsed: Boolean(u.trialEnds) };
}

async function startTrial(u) {
  if (u.trialEnds) throw err(409, "You've already used your free trial.");
  u.trialEnds = Date.now() + TRIAL_DAYS * 864e5;
  await saveUser(u);
  return u;
}

const month = () => new Date().toISOString().slice(0, 7);
const aiUsed = (u) => (u?.ai?.month === month() ? u.ai.count : 0);
async function countAi(u) {
  const fresh = (await getUser(u.id)) || u;
  fresh.ai = { month: month(), count: aiUsed(fresh) + 1 };
  await saveUser(fresh);
}

async function savePrefs(u, prefs) {
  const json = JSON.stringify(prefs || {});
  if (json.length > PREFS_MAX) throw err(413, "Too much data to sync.");
  u.prefs = { data: JSON.parse(json), updated: Date.now() };
  await saveUser(u);
  return u.prefs.updated;
}

async function changePassword(u, current, next) {
  if (!checkPassword(String(current || ""), u.pw)) throw err(401, "Your current password isn't right.");
  const bad = passwordProblem(next);
  if (bad) throw err(400, bad);
  u.pw = hashPassword(next);
  await saveUser(u);
}

async function deleteAccount(u, password) {
  if (!checkPassword(String(password || ""), u.pw)) throw err(401, "Enter your password to delete your account.");
  await db.delKey(userKey(u.id));
}

// Who can open the admin panel: only these accounts (ADMIN_ACCOUNTS in Vercel, comma separated; default "colin"),
// and only if they're also owners. Other owners keep everything unlocked but don't get the admin panel.
const admins = () => String(process.env.ADMIN_ACCOUNTS || "colin").split(",").map(normEmail).filter(Boolean);
const isAdmin = (u) => Boolean(u) && admins().includes(u.email) && owners().includes(u.email);
const publicUser = (u, plan) => ({ email: u.email, created: u.created, plan, aiUsed: aiUsed(u), trialDays: TRIAL_DAYS, ...(isAdmin(u) ? { admin: true } : {}) });

module.exports = {
  signup, login, userFromRequest, isAdmin, planOf, startTrial, countAi, aiUsed, savePrefs, changePassword, deleteAccount, saveUser, getUser,
  makeToken, readToken, sessionCookie, clearCookie, publicUser, hashPassword, checkPassword, emailId, TRIAL_DAYS, available: db.available,
};

// Accounts: email + password, a signed session cookie, plan (free / trial / Pro), AI usage and synced settings.
// Passwords are stored only as salted scrypt hashes. Nothing else personal is collected.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./storage.js");
const pro = require("./pro.js");

const COOKIE = "st_sess";
const SESSION_DAYS = 30;
const TRIAL_DAYS = 3;          // free trial, nothing to pay
const DEPOSIT_TRIAL_DAYS = 7;  // trial with a small deposit (paid in crypto, taken off the first month)
const freeTrialDays = () => require("./sitesettings.js").get().freeTrialDays ?? TRIAL_DAYS; // the admin can change it
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

// Usernames and added emails point at the account they belong to (so either can be used to sign in)
const usernameKey = (name) => `usernames/${emailId("user:" + normEmail(name))}.json`;
const emailKey = (email) => `emails/${emailId("mail:" + normEmail(email))}.json`;
const usernameOf = (u) => u?.username || (u && !isEmail(u.email) ? u.email : null); // old accounts used a username as their login
const emailOf = (u) => u?.contactEmail || (u && isEmail(u.email) ? u.email : null);

async function usernameTaken(name) {
  name = normEmail(name);
  return Boolean(ownerSeed(name) || (await db.getJSON(usernameKey(name))) || (await getUser(emailId(name))));
}
async function emailTaken(email) {
  email = normEmail(email);
  return Boolean((await getUser(emailId(email))) || (await db.getJSON(emailKey(email))));
}
function usernameProblem(name) {
  if (!isUsername(String(name || ""))) return "Pick a username of 3 to 30 letters, numbers, dots, dashes or underscores (starting with a letter or number).";
  return null;
}

// New accounts need an email AND a username. (Called without a username only by older internal code.)
async function signup(email, password, username) {
  email = normEmail(email);
  if (username !== undefined) {
    if (!isEmail(email)) throw err(400, "Enter your email address.");
    const ub = usernameProblem(username);
    if (ub) throw err(400, ub);
  } else if (!validEmail(email)) throw err(400, "Enter an email address, or a username of 3 to 30 letters and numbers.");
  const bad = passwordProblem(password);
  if (bad) throw err(400, bad);
  const id = emailId(email);
  if (await getUser(id) || ownerSeed(email) || (isEmail(email) && (await db.getJSON(emailKey(email))))) throw err(409, isEmail(email) ? "There's already an account with that email. Sign in instead." : "That name is already taken. Sign in instead.");
  if (username !== undefined && (await usernameTaken(username))) throw err(409, "That username is taken. Try another one.");
  const u = { id, email, ...(username !== undefined ? { username: normEmail(username) } : {}), pw: hashPassword(password), created: Date.now(), lastLogin: Date.now(), trialEnds: null, subId: null, ai: null, prefs: null };
  await saveUser(u);
  if (u.username) await db.putJSON(usernameKey(u.username), { id });
  return u;
}

// Sign in with Google or Apple: find the account with that email, or make a new one (it then needs a username)
async function oauthUser(provider, email, sub) {
  email = normEmail(email);
  if (!isEmail(email)) throw err(400, "Your " + provider + " account didn't share an email address.");
  let u = await getUser(emailId(email));
  if (!u) { const link = await db.getJSON(emailKey(email)); if (link?.id) u = await getUser(link.id); }
  if (isBanned(u)) throw err(403, banMessage(u.banned));
  if (!u && !require("./sitesettings.js").get().signupsOpen) throw err(403, "New sign-ups are paused right now. Please try again later.");
  if (!u) u = { id: emailId(email), email, pw: null, created: Date.now(), trialEnds: null, subId: null, ai: null, prefs: null };
  u.oauth = { ...(u.oauth || {}), [provider]: String(sub || "").slice(0, 200) };
  u.lastLogin = Date.now(); u.logins = (u.logins || 0) + 1;
  await saveUser(u);
  return u;
}

// Fill in what an account is missing: an email (older username-only accounts) or a username (Google/Apple sign-ups)
async function completeProfile(u, { email, username } = {}) {
  if (!usernameOf(u)) {
    const ub = usernameProblem(username);
    if (ub) throw err(400, ub);
    if (await usernameTaken(username)) throw err(409, "That username is taken. Try another one.");
    u.username = normEmail(username);
    await db.putJSON(usernameKey(u.username), { id: u.id });
  }
  if (!emailOf(u)) {
    email = normEmail(email);
    if (!isEmail(email)) throw err(400, "Enter your email address.");
    if (await emailTaken(email)) throw err(409, "That email is already used by another account.");
    u.contactEmail = email;
    await db.putJSON(emailKey(email), { id: u.id });
  }
  await saveUser(u);
  return u;
}
const needs = (u) => [...(emailOf(u) ? [] : ["email"]), ...(usernameOf(u) ? [] : ["username"])];

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
  if (!u && isEmail(email)) { const link = await db.getJSON(emailKey(email)); if (link?.id) u = await getUser(link.id); }
  if (!u && isUsername(email)) { const link = await db.getJSON(usernameKey(email)); if (link?.id) u = await getUser(link.id); }
  const seed = ownerSeed(email);
  if (!u && seed && checkPassword(String(password || ""), seed.pw)) {
    u = { id: emailId(email), email, pw: seed.pw, created: Date.now(), trialEnds: null, subId: null, ai: null, prefs: null };
    await saveUser(u);
  }
  // Same message and similar timing whether or not the account exists.
  if (u && !u.pw && u.oauth) throw err(401, `This account signs in with ${Object.keys(u.oauth).map((p) => p[0].toUpperCase() + p.slice(1)).join(" or ")}. Use that button instead.`);
  const ok = u ? checkPassword(String(password || ""), u.pw) : (checkPassword("x", hashPassword("y")), false);
  if (!ok) throw err(401, "Wrong email, username or password.");
  if (isBanned(u)) throw err(403, banMessage(u.banned));
  u.lastLogin = Date.now();
  u.logins = (u.logins || 0) + 1;
  await saveUser(u).catch(() => {});
  return u;
}

async function userFromRequest(req) {
  const tok = cookieValue(req), id = readToken(tok);
  const u = id ? await getUser(id) : null;
  if (!u || isBanned(u)) return null; // suspended accounts are signed out
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
  if (u.trialEnds && u.trialEnds > Date.now()) return { pro: true, kind: "trial", until: u.trialEnds, aiLimit: TRIAL_AI_LIMIT, deposit: Boolean(u.trialDeposit) };
  return { pro: false, kind: "free", trialUsed: Boolean(u.trialEnds) };
}

async function startTrial(u) {
  if (u.trialEnds) throw err(409, "You've already used your free trial.");
  u.trialEnds = Date.now() + freeTrialDays() * 864e5;
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
  if (u.pw && !checkPassword(String(current || ""), u.pw)) throw err(401, "Your current password isn't right.");
  const bad = passwordProblem(next);
  if (bad) throw err(400, bad);
  u.pw = hashPassword(next);
  await saveUser(u);
}

async function deleteAccount(u, password) {
  if (u.pw ? !checkPassword(String(password || ""), u.pw) : String(password || "").toLowerCase() !== "delete") throw err(401, u.pw ? "Enter your password to delete your account." : "Type DELETE to confirm.");
  await db.delKey(userKey(u.id));
  if (u.username) await db.delKey(usernameKey(u.username)).catch(() => {});
  if (u.contactEmail) await db.delKey(emailKey(u.contactEmail)).catch(() => {});
}

// Who can open the admin panel: only these accounts (ADMIN_ACCOUNTS in Vercel, comma separated; default "colin"),
// and only if they're also owners. Other owners keep everything unlocked but don't get the admin panel.
const admins = () => String(process.env.ADMIN_ACCOUNTS || "colin").split(",").map(normEmail).filter(Boolean);
const isAdmin = (u) => Boolean(u) && admins().includes(u.email) && owners().includes(u.email);
// Activity for the admin panel: last seen, visit count, device type and country (from Vercel's coarse IP lookup).
// Saved at most every 5 minutes per account so it costs little.
function deviceOf(ua) {
  ua = String(ua || "");
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const app = /Capacitor|SignalTipsApp/.test(ua) ? "app" : "web";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return `${os}${br ? " · " + br : ""}${app === "app" ? " · iPhone app" : ""}`;
}
async function touch(u, req) {
  if (u.lastSeen && Date.now() - u.lastSeen < 5 * 60e3) return;
  u.lastSeen = Date.now();
  u.visits = (u.visits || 0) + 1;
  u.device = deviceOf(req.headers["user-agent"]);
  const h = req.headers, c = String(h["x-vercel-ip-country"] || "");
  if (/^[A-Z]{2}$/.test(c)) u.country = c;
  // Approximate location from the internet address (city level, from Vercel); never GPS
  const dec = (v) => { try { return decodeURIComponent(String(v || "")).slice(0, 60); } catch { return ""; } };
  const lat = parseFloat(h["x-vercel-ip-latitude"]), lon = parseFloat(h["x-vercel-ip-longitude"]);
  if (c || h["x-vercel-ip-city"]) u.location = { city: dec(h["x-vercel-ip-city"]) || null, region: dec(h["x-vercel-ip-country-region"]) || null, country: c || null,
    lat: isFinite(lat) ? Math.round(lat * 100) / 100 : null, lon: isFinite(lon) ? Math.round(lon * 100) / 100 : null, at: Date.now() };
  // Recent internet addresses, kept only as fingerprints (so the account's addresses can be banned) plus a masked form
  const bans = require("./bans.js"), ip = bans.ipOf(req), hash = bans.ipHash(ip);
  if (hash) u.ips = [{ hash, mask: bans.maskIp(ip), at: Date.now() }, ...(u.ips || []).filter((x) => x.hash !== hash)].slice(0, 10);
  await saveUser(u);
}
// Suspended right now? (a suspension can have an end date)
const isBanned = (u) => Boolean(u?.banned && (!u.banned.until || u.banned.until > Date.now()));

function banMessage(b) {
  return `This account is banned${b?.until ? " until " + new Date(b.until).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""}.${b?.reason ? " Reason: " + b.reason : ""}`;
}
const publicUser = (u, plan) => ({ email: emailOf(u) || u.email, username: usernameOf(u), needs: needs(u), created: u.created, plan, aiUsed: aiUsed(u), trialDays: TRIAL_DAYS,
  credit: u.credit || 0, ...(isAdmin(u) ? { admin: true } : {}) });

module.exports = {
  signup, login, userFromRequest, isAdmin, touch, isBanned, banMessage, oauthUser, completeProfile, usernameOf, emailOf, needs, DEPOSIT_TRIAL_DAYS, planOf, startTrial, countAi, aiUsed, savePrefs, changePassword, deleteAccount, saveUser, getUser,
  makeToken, readToken, sessionCookie, clearCookie, publicUser, hashPassword, checkPassword, emailId, TRIAL_DAYS, available: db.available,
};

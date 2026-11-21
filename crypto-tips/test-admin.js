// Run: node test-admin.js — the owner's admin panel (offline, local storage)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "admin-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL; delete process.env.STRIPE_SECRET_KEY;
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
process.env.OWNER_EMAILS = "boss@example.com,eason@example.com";
process.env.ADMIN_ACCOUNTS = "boss@example.com"; // only this owner may use the admin panel
const { accountHandler, configHandler } = require("./handlers.js");

async function call(action, { method = "GET", body, cookie, op } = {}) {
  const req = { method, url: "/api/account?action=" + action + (op ? "&op=" + op : ""), headers: { host: "localhost:8000", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body };
  let status, hdrs, out;
  const res = { writeHead: (s, h) => { status = s; hdrs = h; }, end: (b) => { out = b; } };
  await accountHandler(req, res);
  const set = hdrs?.["Set-Cookie"];
  return { status, body: JSON.parse(out), cookie: set ? set.split(";")[0] : null };
}
const admin = (op, body) => call("admin", { op, method: body ? "POST" : "GET", body, cookie: boss });
let boss;

(async () => {
  boss = (await call("signup", { method: "POST", body: { email: "boss@example.com", password: "bosspass123" } })).cookie;
  const sam = await call("signup", { method: "POST", body: { email: "sam@example.com", password: "sampass123" } });
  await call("signup", { method: "POST", body: { email: "kim@example.com", password: "kimpass123" } });

  // Only the admin account gets in: not regular users, not other owners
  assert.strictEqual((await call("admin", { cookie: sam.cookie })).status, 403);
  const eason = (await call("signup", { method: "POST", body: { email: "eason@example.com", password: "easonpass1" } })).cookie;
  assert.strictEqual((await call("admin", { cookie: eason })).status, 403, "another owner can't open the admin panel");
  assert.strictEqual((await call("me", { cookie: eason })).body.user.admin, undefined);
  assert.strictEqual((await call("me", { cookie: boss })).body.user.admin, true);
  await call("admin", { op: "users", cookie: boss }); // still works for the admin
  assert.strictEqual((await call("admin")).status, 401);

  const ov = (await admin("overview")).body;
  assert.strictEqual(ov.users, 4);
  assert.strictEqual(ov.signups.last24h, 4);
  assert.strictEqual(ov.byPlan.owner, 2);
  assert.strictEqual(ov.services.ai, false);

  let list = (await admin("users")).body.users;
  assert.ok(!JSON.stringify(list).includes("scrypt$"), "password hashes are never sent");
  const samId = list.find((u) => u.name === "sam@example.com").id, bossId = list.find((u) => u.name === "boss@example.com").id;

  // Free Pro for 30 days
  let r = await admin("user", { id: samId, action: "grantPro", days: 30 });
  assert.strictEqual(r.body.user.plan, "comp");
  assert.strictEqual((await call("me", { cookie: sam.cookie })).body.user.plan.pro, true, "Sam now has Pro");
  r = await admin("user", { id: samId, action: "revokePro" });
  assert.strictEqual(r.body.user.plan, "free");

  // Trial extension and AI reset
  r = await admin("user", { id: samId, action: "extendTrial", days: 7 });
  assert.strictEqual(r.body.user.plan, "trial");
  r = await admin("user", { id: samId, action: "resetAi" });
  assert.strictEqual(r.body.user.aiUsed, 0);

  // Suspend: signed out, can't sign in; unsuspend restores it
  r = await admin("user", { id: samId, action: "suspend" });
  assert.strictEqual(r.body.user.suspended, true);
  assert.strictEqual((await call("me", { cookie: sam.cookie })).body.user, null, "suspended sessions end");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "sam@example.com", password: "sampass123" } })).status, 403);
  await admin("user", { id: samId, action: "unsuspend" });

  // Temporary password: old password and old sessions stop working, the new one works
  r = await admin("user", { id: samId, action: "resetPassword" });
  const temp = r.body.tempPassword;
  assert.ok(/^[A-Za-z0-9]{8,}$/.test(temp));
  assert.strictEqual((await call("me", { cookie: sam.cookie })).body.user, null, "old sessions are signed out");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "sam@example.com", password: "sampass123" } })).status, 401);
  const again = await call("login", { method: "POST", body: { email: "sam@example.com", password: temp } });
  assert.strictEqual(again.status, 200);
  assert.ok((await call("me", { cookie: again.cookie })).body.user, "a fresh session works");

  // Owners are protected, including from themselves
  assert.strictEqual((await admin("user", { id: bossId, action: "delete" })).status, 400);
  assert.strictEqual((await admin("user", { id: bossId, action: "suspend" })).status, 400);

  // Delete
  r = await admin("user", { id: samId, action: "delete" });
  assert.strictEqual(r.body.deleted, true);
  assert.strictEqual((await admin("overview")).body.users, 3);

  // Changes must be same-site JSON posts
  const forged = await call("admin", { op: "announce", method: "POST", cookie: boss, body: undefined });
  assert.strictEqual(forged.status, 403);

  // Announcement shows up in the public site settings, and can be removed
  r = await admin("announce", { text: "  New: wallet sell plans!  ", tone: "good" });
  assert.strictEqual(r.body.announcement.text, "New: wallet sell plans!");
  let cfgOut; await configHandler({ headers: {} }, { writeHead() {}, end: (b) => (cfgOut = JSON.parse(b)) });
  assert.strictEqual(cfgOut.announcement.tone, "good");
  r = await admin("announce", { text: "Scam DMs going around", tone: "emergency" });
  assert.strictEqual(r.body.announcement.tone, "emergency");
  await admin("announce", { text: "" });
  await configHandler({ headers: {} }, { writeHead() {}, end: (b) => (cfgOut = JSON.parse(b)) });
  assert.strictEqual(cfgOut.announcement, null);

  // Broadcast without push set up gives a clear message
  r = await admin("broadcast", { title: "Hi" });
  assert.strictEqual(r.status, 400);
  assert.ok(/set up/.test(r.body.reason));
  console.log("admin tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

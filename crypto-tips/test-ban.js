// Run: node test-ban.js — bans for a number of days, by account and internet address
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ban-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL;
process.env.OWNER_EMAILS = "boss@example.com"; process.env.ADMIN_ACCOUNTS = "boss@example.com";
const { accountHandler, candlesHandler } = require("./handlers.js");

async function call(handler, url, { method = "GET", body, cookie, ip = "203.0.113.7" } = {}) {
  const req = { method, url, headers: { host: "localhost:8000", "x-forwarded-for": ip, "x-vercel-ip-city": "Toronto", "x-vercel-ip-country": "CA", "x-vercel-ip-country-region": "ON", "x-vercel-ip-latitude": "43.6532", "x-vercel-ip-longitude": "-79.3832", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body };
  let status, hdrs, out;
  await handler(req, { writeHead: (s, h) => { status = s; hdrs = h; }, end: (b) => (out = b) });
  const sc = [].concat(hdrs?.["Set-Cookie"] || [])[0];
  return { status, body: out ? JSON.parse(out) : null, cookie: sc ? sc.split(";")[0] : null };
}
const acct = (action, opts) => call(accountHandler, "/api/account?action=" + action, opts);

(async () => {
  let boss = (await acct("signup", { method: "POST", body: { email: "boss@example.com", username: "boss", password: "bosspass12" }, ip: "198.51.100.1" })).cookie;
  boss += "; " + (await acct("adminTrust", { method: "POST", body: { password: "bosspass12" }, cookie: boss, ip: "198.51.100.1" })).cookie;
  const troll = (await acct("signup", { method: "POST", body: { email: "troll@example.com", username: "troll", password: "trollpass1" } })).cookie;
  let list = (await acct("admin", { cookie: boss, url: "" }));
  const users = (await call(accountHandler, "/api/account?action=admin&op=users", { cookie: boss, ip: "198.51.100.1" })).body.users;
  const t = users.find((u) => u.name === "troll@example.com");
  assert.deepStrictEqual([t.location.city, t.location.region, t.location.country], ["Toronto", "ON", "CA"], "approximate location recorded");
  assert.strictEqual(t.ips[0].mask, "203.0.113.x", "IP shown masked only");
  assert.ok(!JSON.stringify(users).includes("203.0.113.7"), "the full IP is never stored or shown");

  // Ban for 2 days, with their internet address
  let r = await call(accountHandler, "/api/account?action=admin&op=user", { method: "POST", cookie: boss, ip: "198.51.100.1", body: { id: t.id, action: "ban", days: 2, reason: "Spamming", ip: true } });
  assert.ok(/Banned for 2 days, with 1 internet address/.test(r.body.note), r.body.note);
  assert.ok(r.body.user.banUntil > Date.now() + 1.9 * 864e5 && r.body.user.banUntil < Date.now() + 2.1 * 864e5);
  // From their address, everything is refused with the date and reason
  r = await acct("me", { cookie: troll });
  assert.strictEqual(r.status, 403);
  assert.ok(r.body.banned && r.body.until && r.body.reason === "Spamming");
  r = await call(candlesHandler, "/api/candles?sym=BTC&kind=stats");
  assert.strictEqual(r.status, 403, "every API is blocked for that address");
  r = await acct("signup", { method: "POST", body: { email: "troll2@example.com", username: "troll2", password: "trollpass1" } });
  assert.strictEqual(r.status, 403, "a new account from the same address is blocked");
  // From somewhere else, the account itself is still banned
  r = await acct("login", { method: "POST", body: { email: "troll", password: "trollpass1" }, ip: "192.0.2.50" });
  assert.strictEqual(r.status, 403);
  assert.ok(/banned until/.test(r.body.reason) && /Spamming/.test(r.body.reason), r.body.reason);
  // The owner is never locked out, even from a banned address
  assert.strictEqual((await acct("me", { cookie: boss })).status, 200);
  // Bans list, and lifting it
  const bl = (await call(accountHandler, "/api/account?action=admin&op=bans", { cookie: boss, ip: "198.51.100.1" })).body.bans;
  assert.strictEqual(bl.length, 1);
  assert.strictEqual(bl[0].mask, "203.0.113.x");
  await call(accountHandler, "/api/account?action=admin&op=user", { method: "POST", cookie: boss, ip: "198.51.100.1", body: { id: t.id, action: "unban" } });
  assert.strictEqual((await call(accountHandler, "/api/account?action=admin&op=bans", { cookie: boss, ip: "198.51.100.1" })).body.bans.length, 0);
  // (the address list is cached for 30 s; a fresh check sees the lift)
  assert.strictEqual((await acct("login", { method: "POST", body: { email: "troll", password: "trollpass1" }, ip: "192.0.2.50" })).status, 200, "account unbanned");

  // A ban with an end date in the past is over
  const accounts = require("./accounts.js");
  const u = await accounts.getUser(t.id);
  u.banned = { since: Date.now() - 5 * 864e5, until: Date.now() - 1000, reason: "old" };
  await accounts.saveUser(u);
  assert.strictEqual((await acct("login", { method: "POST", body: { email: "troll", password: "trollpass1" }, ip: "192.0.2.50" })).status, 200, "expired ban no longer applies");
  console.log("ban tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

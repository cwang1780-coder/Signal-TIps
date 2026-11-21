// Run: node test-account.js — accounts: sign up, sign in, sessions, trial, sync, password, delete, request checks (offline)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "acct-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL; delete process.env.STRIPE_SECRET_KEY;
process.env.OWNER_EMAILS = "boss@example.com";
const accounts = require("./accounts.js");
const { accountHandler } = require("./handlers.js");

// Call the handler like a server would. Returns {status, body, cookie}.
async function call(action, { method = "GET", body, cookie, headers = {} } = {}) {
  const req = { method, url: "/api/account?action=" + action, headers: { host: "localhost:8000", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body };
  let status, hdrs, out;
  const res = { writeHead: (s, h) => { status = s; hdrs = h; }, end: (b) => { out = b; } };
  await accountHandler(req, res);
  const setCookie = hdrs?.["Set-Cookie"];
  return { status, body: JSON.parse(out), cookie: setCookie ? setCookie.split(";")[0] : null, setCookie };
}

(async () => {
  // Passwords are hashed, never stored as typed
  const h = accounts.hashPassword("correct horse");
  assert.ok(h.startsWith("scrypt$") && !h.includes("correct horse"));
  assert.ok(accounts.checkPassword("correct horse", h) && !accounts.checkPassword("wrong", h));

  // Sign up: an email AND a username are required
  let r = await call("signup", { method: "POST", body: { email: "Sam@Example.com ", username: "sam", password: "short" } });
  assert.strictEqual(r.status, 400, "short password refused");
  r = await call("signup", { method: "POST", body: { email: "Sam@Example.com", password: "longenough1" } });
  assert.strictEqual(r.status, 400, "no username refused");
  assert.ok(/username/.test(r.body.reason));
  r = await call("signup", { method: "POST", body: { email: "just_a_name", username: "just_a_name", password: "longenough1" } });
  assert.strictEqual(r.status, 400, "an email is required");
  r = await call("signup", { method: "POST", body: { email: "sam@example.com", username: "x", password: "longenough1" } });
  assert.strictEqual(r.status, 400, "too-short username refused");
  r = await call("signup", { method: "POST", body: { email: "Sam@Example.com ", username: "Sam_Trades", password: "longenough1" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.email, "sam@example.com");
  assert.strictEqual(r.body.user.username, "sam_trades");
  assert.deepStrictEqual(r.body.user.needs, []);
  assert.strictEqual(r.body.user.plan.kind, "free");
  assert.ok(/HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie), "session cookie is HttpOnly + SameSite");
  const sam = r.cookie;
  const stored = JSON.parse(fs.readFileSync(path.join(process.env.ACCOUNTS_DIR, "users", accounts.emailId("sam@example.com") + ".json"), "utf8"));
  assert.ok(!JSON.stringify(stored).includes("longenough1"), "password not stored in plain text");
  r = await call("signup", { method: "POST", body: { email: "sam@example.com", username: "other_sam", password: "another-pass" } });
  assert.strictEqual(r.status, 409, "duplicate email refused");
  r = await call("signup", { method: "POST", body: { email: "sam2@example.com", username: "SAM_trades", password: "another-pass" } });
  assert.strictEqual(r.status, 409, "duplicate username refused");

  // Sign in
  r = await call("login", { method: "POST", body: { email: "sam@example.com", password: "nope-nope" } });
  assert.strictEqual(r.status, 401);
  r = await call("login", { method: "POST", body: { email: "nobody@example.com", password: "whatever1" } });
  assert.strictEqual(r.status, 401, "unknown email gets the same answer");
  assert.strictEqual(r.body.reason, "Wrong email, username or password.");
  r = await call("login", { method: "POST", body: { email: "SAM@example.com", password: "longenough1" } });
  assert.strictEqual(r.status, 200);
  r = await call("login", { method: "POST", body: { email: "sam_trades", password: "longenough1" } });
  assert.strictEqual(r.status, 200, "sign in with the username too");

  // Who am I
  assert.strictEqual((await call("me")).body.user, null);
  assert.strictEqual((await call("me", { cookie: sam })).body.user.email, "sam@example.com");
  const tampered = sam.slice(0, -3) + (sam.endsWith("aaa") ? "bbb" : "aaa");
  assert.strictEqual((await call("me", { cookie: tampered })).body.user, null, "tampered cookie rejected");

  // Requests from other websites, or not JSON, are refused
  assert.strictEqual((await call("trial", { method: "POST", body: {}, cookie: sam, headers: { origin: "https://evil.example" } })).status, 403);
  assert.strictEqual((await call("trial", { method: "POST", cookie: sam, headers: { "content-type": "text/plain" } })).status, 403);

  // Free trial: once per account
  r = await call("trial", { method: "POST", body: {}, cookie: sam });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.plan.kind, "trial");
  assert.ok(r.body.user.plan.pro && r.body.user.plan.until > Date.now() + 2.9 * 864e5 && r.body.user.plan.until < Date.now() + 3.1 * 864e5, "free trial is 3 days");
  assert.strictEqual((await call("trial", { method: "POST", body: {}, cookie: sam })).status, 409);

  // Payments not configured: checkout explains instead of failing
  assert.strictEqual((await call("checkout", { method: "POST", body: {}, cookie: sam })).status, 503);

  // Settings sync
  r = await call("sync", { method: "PUT", body: { prefs: { coins: ["BTC", "SOL"], currency: "CAD" } }, cookie: sam });
  assert.strictEqual(r.status, 200);
  r = await call("sync", { cookie: sam });
  assert.deepStrictEqual(r.body.prefs, { coins: ["BTC", "SOL"], currency: "CAD" });
  assert.strictEqual((await call("sync", { method: "PUT", body: { prefs: { big: "x".repeat(70000) } }, cookie: sam })).status, 413);

  // Older username-only accounts still sign in, and are asked to add an email once
  await accounts.signup("Trader_Joe", "joe-pass-123"); // made the old way
  r = await call("login", { method: "POST", body: { email: "TRADER_JOE", password: "joe-pass-123" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.username, "trader_joe");
  assert.deepStrictEqual(r.body.user.needs, ["email"]);
  const joe = r.cookie;
  assert.strictEqual((await call("profile", { method: "POST", body: { email: "sam@example.com" }, cookie: joe })).status, 409, "email already used by Sam");
  r = await call("profile", { method: "POST", body: { email: "joe@example.com" }, cookie: joe });
  assert.deepStrictEqual(r.body.user.needs, []);
  assert.strictEqual((await call("login", { method: "POST", body: { email: "joe@example.com", password: "joe-pass-123" } })).status, 200, "and can then sign in with that email");

  // Owner account from a password hash (OWNER_ACCOUNT): created on first sign-in, gets Pro, name can't be taken
  process.env.OWNER_ACCOUNT = "Colin:" + accounts.hashPassword("owner-secret-9");
  assert.strictEqual((await call("signup", { method: "POST", body: { email: "fake@example.com", username: "colin", password: "someone-else-1" } })).status, 409, "owner name reserved");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "colin", password: "wrong-guess-1" } })).status, 401);
  r = await call("login", { method: "POST", body: { email: "Colin", password: "owner-secret-9" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.plan.kind, "owner");
  assert.ok(!JSON.stringify(r.body).includes("scrypt"), "hash never sent to the browser");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "colin", password: "owner-secret-9" } })).body.user.plan.kind, "owner", "second sign-in uses the saved account");
  // Several owners: OWNER_ACCOUNTS adds more, separated by ";"
  process.env.OWNER_ACCOUNTS = "Eason:" + accounts.hashPassword("second-owner-1") + ";Third:" + accounts.hashPassword("third-owner-1");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "eason", password: "second-owner-1" } })).body.user.plan.kind, "owner");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "third", password: "third-owner-1" } })).body.user.plan.kind, "owner");
  assert.strictEqual((await call("login", { method: "POST", body: { email: "colin", password: "owner-secret-9" } })).body.user.plan.kind, "owner", "first owner still works");
  delete process.env.OWNER_ACCOUNT; delete process.env.OWNER_ACCOUNTS;

  // Owner email gets Pro without paying
  r = await call("signup", { method: "POST", body: { email: "boss@example.com", username: "boss", password: "owner-pass-1" } });
  assert.strictEqual(r.body.user.plan.kind, "owner");

  // Change password, then delete the account
  assert.strictEqual((await call("password", { method: "POST", body: { current: "wrong", next: "newpass-123" }, cookie: sam })).status, 401);
  assert.strictEqual((await call("password", { method: "POST", body: { current: "longenough1", next: "newpass-123" }, cookie: sam })).status, 200);
  assert.strictEqual((await call("login", { method: "POST", body: { email: "sam@example.com", password: "newpass-123" } })).status, 200);
  assert.strictEqual((await call("delete", { method: "POST", body: { password: "nope" }, cookie: sam })).status, 401);
  r = await call("delete", { method: "POST", body: { password: "newpass-123" }, cookie: sam });
  assert.strictEqual(r.status, 200);
  assert.ok(/Max-Age=0/.test(r.setCookie), "signed out after delete");
  assert.strictEqual((await call("me", { cookie: sam })).body.user, null, "deleted account is gone");

  // Google sign-in creates an account without a password; it must pick a username before using the app
  const g = await accounts.oauthUser("google", "Gina@Example.com", "g-123");
  assert.deepStrictEqual(accounts.needs(g), ["username"]);
  assert.strictEqual((await call("login", { method: "POST", body: { email: "gina@example.com", password: "anything1" } })).status, 401, "no password: use Google");
  const gc = "st_sess=" + accounts.makeToken(g.id);
  assert.strictEqual((await call("profile", { method: "POST", body: { username: "Boss" }, cookie: gc })).status, 409, "username taken");
  r = await call("profile", { method: "POST", body: { username: "gina" }, cookie: gc });
  assert.deepStrictEqual(r.body.user.needs, []);
  assert.strictEqual((await accounts.oauthUser("google", "gina@example.com", "g-123")).id, g.id, "signing in with Google again finds the same account");
  // Signing in with Apple using an email another account already added links to that account
  assert.strictEqual((await accounts.oauthUser("apple", "joe@example.com", "a-9")).id, accounts.emailId("trader_joe"));

  fs.rmSync(process.env.ACCOUNTS_DIR, { recursive: true, force: true });
  console.log("account tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

// Run: node test-oauth.js — Sign in with Google / Apple (offline: a fake Google/Apple token server)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL;

const jwt = (claims) => "x." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".sig";
let lastToken = null, claims = null;
const fake = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  lastToken = Object.fromEntries(new URLSearchParams(body));
  res.writeHead(lastToken.code === "bad" ? 400 : 200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(lastToken.code === "bad" ? { error: "invalid_grant" } : { id_token: jwt(claims) }));
});

(async () => {
  await new Promise((r) => fake.listen(0, r));
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "gid.apps", GOOGLE_CLIENT_SECRET: "gsecret", GOOGLE_TOKEN_URL: `http://localhost:${fake.address().port}/token`,
    APPLE_SIGNIN_CLIENT_ID: "app.signaltips.web", APPLE_SIGNIN_TEAM_ID: "TEAM123456", APPLE_SIGNIN_KEY_ID: "KEY1234567",
    APPLE_SIGNIN_KEY_P8: privateKey.export({ type: "pkcs8", format: "pem" }), APPLE_TOKEN_URL: `http://localhost:${fake.address().port}/token`,
  });
  const { accountHandler, configHandler } = require("./handlers.js");
  const accounts = require("./accounts.js");
  const call = async (url, { method = "GET", cookie, body, headers = {} } = {}) => {
    const req = { method, url, headers: { host: "localhost:8000", ...(cookie ? { cookie } : {}), ...headers }, body };
    let status, hdrs, out;
    await accountHandler(req, { writeHead: (s, h) => { status = s; hdrs = h; }, end: (b) => (out = b) });
    const sc = [].concat(hdrs?.["Set-Cookie"] || []);
    return { status, location: hdrs?.Location, cookies: sc, body: out && JSON.parse(out) };
  };
  let cfg; await configHandler({ url: "/api/config", headers: {} }, { writeHead() {}, end: (b) => (cfg = JSON.parse(b)) });
  assert.deepStrictEqual(cfg.oauth, { google: true, apple: true });

  // Step 1: off to Google with a random state, remembered in a cookie
  let r = await call("/api/account?action=oauth&provider=google");
  assert.strictEqual(r.status, 302);
  const loc = new URL(r.location);
  assert.strictEqual(loc.host, "accounts.google.com");
  assert.strictEqual(loc.searchParams.get("client_id"), "gid.apps");
  assert.strictEqual(loc.searchParams.get("redirect_uri"), "http://localhost:8000/api/account?action=oauthCallback&provider=google");
  const state = loc.searchParams.get("state"), stateCookie = r.cookies[0].split(";")[0];
  assert.ok(state.length > 16 && stateCookie.includes(state));

  // A forged callback (wrong state) is refused
  claims = { iss: "https://accounts.google.com", aud: "gid.apps", sub: "g1", email: "Mia@Gmail.com", email_verified: true, exp: Date.now() / 1000 + 600 };
  r = await call(`/api/account?action=oauthCallback&provider=google&state=wrong${"x".repeat(state.length - 5)}&code=c1`, { cookie: stateCookie });
  assert.ok(r.location.startsWith("/?authError="), r.location);
  // A token meant for another app is refused
  claims.aud = "someone-else";
  r = await call(`/api/account?action=oauthCallback&provider=google&state=${state}&code=c1`, { cookie: stateCookie });
  assert.ok(/couldn/.test(decodeURIComponent(r.location)), r.location);
  claims.aud = "gid.apps";

  // Step 2: back from Google: signed in, new account that still needs a username
  r = await call(`/api/account?action=oauthCallback&provider=google&state=${state}&code=c1`, { cookie: stateCookie });
  assert.strictEqual(r.location, "/?signedIn=google");
  assert.strictEqual(lastToken.client_secret, "gsecret");
  const sess = r.cookies.find((c) => c.startsWith("st_sess=")).split(";")[0];
  assert.ok(r.cookies.some((c) => c.startsWith("st_oauth=;")), "state cookie cleared");
  let me = (await call("/api/account?action=me", { cookie: sess })).body.user;
  assert.strictEqual(me.email, "mia@gmail.com");
  assert.deepStrictEqual(me.needs, ["username"]);

  // Apple: comes back as a form POST (allowed without JSON, checked by state instead); signs its own client secret
  r = await call("/api/account?action=oauth&provider=apple");
  const aloc = new URL(r.location), astate = aloc.searchParams.get("state");
  assert.strictEqual(aloc.searchParams.get("response_mode"), "form_post");
  claims = { iss: "https://appleid.apple.com", aud: "app.signaltips.web", sub: "a1", email: "mia@gmail.com", email_verified: "true", exp: Date.now() / 1000 + 600 };
  r = await call("/api/account?action=oauthCallback&provider=apple", { method: "POST", cookie: r.cookies[0].split(";")[0],
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" }, body: `state=${astate}&code=c2` });
  assert.strictEqual(r.location, "/?signedIn=apple");
  const [h, c] = lastToken.client_secret.split(".");
  assert.deepStrictEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY1234567" });
  assert.strictEqual(JSON.parse(Buffer.from(c, "base64url")).sub, "app.signaltips.web");
  const sess2 = r.cookies.find((x) => x.startsWith("st_sess=")).split(";")[0];
  assert.strictEqual((await call("/api/account?action=me", { cookie: sess2 })).body.user.email, "mia@gmail.com", "same person via Apple: same account");

  // Cancelled at Google
  r = await call(`/api/account?action=oauthCallback&provider=google&error=access_denied&state=${state}`, { cookie: stateCookie });
  assert.ok(/cancelled/.test(decodeURIComponent(r.location)));
  // Not set up: the buttons say so
  delete process.env.GOOGLE_CLIENT_ID;
  r = await call("/api/account?action=oauth&provider=google");
  assert.ok(r.location.startsWith("/?authError="));
  fake.close();
  console.log("oauth tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

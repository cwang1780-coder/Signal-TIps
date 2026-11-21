// Sign in with Google / Sign in with Apple (standard OAuth "authorization code" flow, done on the server).
// 1. /api/account?action=oauth&provider=google|apple sends the visitor to Google/Apple with a random "state",
//    which is also kept in a short-lived cookie.
// 2. Google/Apple send them back to /api/account?action=oauthCallback&provider=... with a one-time code.
//    We check the state matches, swap the code for an ID token directly with Google/Apple (over HTTPS, using our
//    secret), read the verified email from it, and sign them in (making the account if it's new).
// Setup (Vercel environment variables):
//   Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Google Cloud console → APIs & Services → Credentials → OAuth client ID, Web)
//   Apple:  APPLE_SIGNIN_CLIENT_ID (a Services ID), APPLE_SIGNIN_TEAM_ID, APPLE_SIGNIN_KEY_ID, APPLE_SIGNIN_KEY_P8 (a "Sign in with Apple" key)
//   Redirect URL to register with both: https://<your site>/api/account?action=oauthCallback&provider=google (or apple)
const crypto = require("crypto");

const COOKIE = "st_oauth";
const err = (status, message) => Object.assign(new Error(message), { status });
const b64url = (b) => Buffer.from(b).toString("base64url");

const PROVIDERS = {
  google: {
    on: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: (redirect, state) => "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }),
    token: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    tokenBody: (code, redirect) => ({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
    check: (c) => ["accounts.google.com", "https://accounts.google.com"].includes(c.iss) && c.aud === process.env.GOOGLE_CLIENT_ID && c.email_verified !== false && c.email_verified !== "false",
  },
  apple: {
    on: () => Boolean(process.env.APPLE_SIGNIN_CLIENT_ID && process.env.APPLE_SIGNIN_TEAM_ID && process.env.APPLE_SIGNIN_KEY_ID && process.env.APPLE_SIGNIN_KEY_P8),
    // Apple sends the code back as a form POST
    authUrl: (redirect, state) => "https://appleid.apple.com/auth/authorize?" + new URLSearchParams({
      client_id: process.env.APPLE_SIGNIN_CLIENT_ID, redirect_uri: redirect, response_type: "code", response_mode: "form_post", scope: "name email", state }),
    token: process.env.APPLE_TOKEN_URL || "https://appleid.apple.com/auth/token",
    tokenBody: (code, redirect) => ({ code, client_id: process.env.APPLE_SIGNIN_CLIENT_ID, client_secret: appleClientSecret(), redirect_uri: redirect, grant_type: "authorization_code" }),
    check: (c) => c.iss === "https://appleid.apple.com" && c.aud === process.env.APPLE_SIGNIN_CLIENT_ID && c.email_verified !== false && c.email_verified !== "false",
  },
};

// Apple's "client secret" is a short JWT we sign with the Sign in with Apple key (ES256)
function appleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const data = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_SIGNIN_KEY_ID })) + "." +
    b64url(JSON.stringify({ iss: process.env.APPLE_SIGNIN_TEAM_ID, iat: now, exp: now + 600, aud: "https://appleid.apple.com", sub: process.env.APPLE_SIGNIN_CLIENT_ID }));
  const key = String(process.env.APPLE_SIGNIN_KEY_P8).replace(/\\n/g, "\n");
  return data + "." + crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

const enabled = () => Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.on()]));
const redirectUri = (origin, provider) => `${origin}/api/account?action=oauthCallback&provider=${provider}`;
const stateCookie = (value, secure, maxAge = 600) =>
  // Apple comes back with a cross-site form POST, so on https the cookie must allow that (SameSite=None; Secure)
  `${COOKIE}=${value}; Path=/api/account; HttpOnly; Max-Age=${maxAge}; ${secure ? "SameSite=None; Secure" : "SameSite=Lax"}`;

function start(provider, origin, secure) {
  const p = PROVIDERS[provider];
  if (!p?.on()) throw err(400, "That sign-in option isn't set up on this site yet.");
  const state = crypto.randomBytes(18).toString("base64url");
  return { location: p.authUrl(redirectUri(origin, provider), state), cookie: stateCookie(`${provider}.${state}`, secure) };
}

// Returns { email, sub, name } after checking everything; the caller signs the person in
async function finish(provider, params, cookieHeader, origin) {
  const p = PROVIDERS[provider];
  if (!p?.on()) throw err(400, "That sign-in option isn't set up on this site yet.");
  if (params.error) throw err(400, params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "Sign-in was cancelled." : "Sign-in didn't complete. Try again.");
  const saved = (String(cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1] || "";
  const [sp, ss] = saved.split(".");
  const st = String(params.state || "");
  if (sp !== provider || !ss || ss.length !== st.length || !crypto.timingSafeEqual(Buffer.from(ss), Buffer.from(st))) throw err(400, "That sign-in link expired or didn't come from this site. Try again.");
  if (!params.code) throw err(400, "Sign-in didn't complete. Try again.");
  const r = await fetch(p.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(p.tokenBody(String(params.code), redirectUri(origin, provider))), signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id_token) throw err(400, "Couldn't finish signing in with " + (provider === "google" ? "Google" : "Apple") + ". Try again.");
  // The ID token came straight from Google/Apple over HTTPS in exchange for our secret, so its contents can be trusted
  const claims = JSON.parse(Buffer.from(String(d.id_token).split(".")[1] || "", "base64url").toString() || "{}");
  if (!p.check(claims) || !(claims.exp * 1000 > Date.now())) throw err(400, "Sign-in couldn't be verified. Try again.");
  if (!claims.email) throw err(400, "Your " + (provider === "google" ? "Google" : "Apple") + " account didn't share an email address.");
  return { email: claims.email, sub: claims.sub, clearCookie: stateCookie("", origin.startsWith("https"), 0) };
}

module.exports = { enabled, start, finish, COOKIE };

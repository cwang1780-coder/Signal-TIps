// "Trust this computer" for the admin panel. After signing in on the admin address, the admin re-enters their
// password once and the browser gets a long-lived, signed, HttpOnly cookie for that device. Admin actions need the
// admin account AND a trusted device, so a stolen password alone isn't enough. Devices can be renamed or removed.
const crypto = require("crypto");

const COOKIE = "st_adev";
const secret = () => crypto.createHash("sha256").update("admin-device-v1:" + (process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "local-admin-device")).digest();
const sign = (s) => crypto.createHmac("sha256", secret()).update(s).digest("base64url");

function deviceName(ua) {
  ua = String(ua || "");
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "Computer";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

// Make a new trusted device for this admin; returns { device, cookie }
function trust(u, req, name, secure) {
  const id = crypto.randomBytes(12).toString("hex");
  const device = { id, name: String(name || "").trim().slice(0, 40) || deviceName(req.headers["user-agent"]), added: Date.now(), lastUsed: Date.now() };
  u.adminDevices = [...(u.adminDevices || []), device].slice(-10);
  const body = `${u.id}.${id}`;
  const cookie = `${COOKIE}=${body}.${sign(body)}; Path=/api/account; HttpOnly; SameSite=Strict; Max-Age=${400 * 86400}${secure ? "; Secure" : ""}`;
  return { device, cookie };
}

// Is this request from one of the admin's trusted devices? Returns the device or null.
function check(u, req) {
  const raw = (String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)) || [])[1] || "";
  const [uid, did, sig] = raw.split(".");
  if (!uid || !did || !sig || uid !== u?.id) return null;
  const want = sign(`${uid}.${did}`);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return (u.adminDevices || []).find((d) => d.id === did) || null;
}
const forget = (secure) => `${COOKIE}=; Path=/api/account; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;

module.exports = { trust, check, forget, deviceName, COOKIE };

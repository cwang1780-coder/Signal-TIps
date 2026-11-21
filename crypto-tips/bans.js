// Bans by internet address (IP), for a set number of days or for good.
// IPs are never stored as typed: each one is turned into a keyed hash (a fingerprint that can't be turned back into
// the address). The admin panel only ever shows a shortened, masked IP (e.g. 203.0.113.x).
const crypto = require("crypto");
const db = require("./storage.js");

const KEY = "bans/ips.json";
let cache = { at: 0, list: null };

function ipOf(req) {
  const xf = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(req.headers?.["x-real-ip"] || "") || req.socket?.remoteAddress || "";
}
const secret = () => process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "local-ban-secret";
const ipHash = (ip) => (ip ? crypto.createHmac("sha256", secret()).update("ip:" + ip).digest("hex").slice(0, 32) : null);
// Shown to the admin: the network part only (IPv4: first three numbers; IPv6: first three groups)
function maskIp(ip) {
  ip = String(ip || "").replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split(".").slice(0, 3).join(".") + ".x";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":…";
  return ip ? "hidden" : null;
}

async function list() {
  if (cache.list && Date.now() - cache.at < 30_000) return cache.list;
  const all = (await db.getJSON(KEY).catch(() => null)) || {};
  const now = Date.now(), live = Object.fromEntries(Object.entries(all).filter(([, b]) => !b.until || b.until > now));
  cache = { at: Date.now(), list: live };
  return live;
}
async function save(listObj) { await db.putJSON(KEY, listObj); cache = { at: Date.now(), list: listObj }; }

// Is this request's IP banned? Returns the ban or null.
async function check(req) {
  if (!db.available()) return null;
  const h = ipHash(ipOf(req));
  if (!h) return null;
  return (await list())[h] || null;
}
async function banHashes(hashes, { days, reason, user, masks = {} }) {
  const l = { ...(await list()) }, until = days > 0 ? Date.now() + days * 864e5 : null;
  for (const h of hashes.filter(Boolean)) l[h] = { until, reason: String(reason || "").slice(0, 200), user: user || null, mask: masks[h] || null, at: Date.now() };
  await save(l);
  return until;
}
async function unbanUser(userId) {
  const l = { ...(await list()) };
  for (const [h, b] of Object.entries(l)) if (b.user === userId) delete l[h];
  await save(l);
}
async function unbanHash(h) { const l = { ...(await list()) }; delete l[h]; await save(l); }

module.exports = { ipOf, ipHash, maskIp, check, list, banHashes, unbanUser, unbanHash };

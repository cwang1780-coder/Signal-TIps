// Tiny key-value store for accounts.
// Online (Vercel): a PRIVATE Vercel Blob store (BLOB_READ_WRITE_TOKEN is set when the store is connected to the project).
// On your computer: JSON files in ./.data (never committed or deployed).
const fs = require("fs");
const path = require("path");

const LOCAL = process.env.ACCOUNTS_DIR || path.join(__dirname, ".data");
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const available = () => useBlob() || !process.env.VERCEL;
const okKey = (key) => /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.json$/.test(key);

async function getJSON(key) {
  if (!okKey(key)) throw new Error("bad key");
  if (useBlob()) {
    const { get } = require("@vercel/blob");
    const g = await get(key, { access: "private", useCache: false });
    if (!g || g.statusCode !== 200) return null;
    return JSON.parse(await new Response(g.stream).text());
  }
  try { return JSON.parse(fs.readFileSync(path.join(LOCAL, key), "utf8")); } catch { return null; }
}

async function putJSON(key, value) {
  if (!okKey(key)) throw new Error("bad key");
  const body = JSON.stringify(value);
  if (useBlob()) {
    const { put } = require("@vercel/blob");
    await put(key, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
    return;
  }
  const file = path.join(LOCAL, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

async function delKey(key) {
  if (!okKey(key)) throw new Error("bad key");
  if (useBlob()) { const { del } = require("@vercel/blob"); await del(key); return; }
  try { fs.unlinkSync(path.join(LOCAL, key)); } catch {}
}

module.exports = { getJSON, putJSON, delKey, available };

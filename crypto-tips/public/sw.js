// Service worker: makes Signal Tips installable and quick to open.
// - App files: network first (always the latest version), cached copy when offline.
// - The page itself: network first, cached copy if offline.
// - /api/* and anything from other sites: never cached here (always live).
const CACHE = "signal-tips-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icons.js", "/currency.js", "/coins/list.js",
  "/indicators.js", "/draw.js", "/app.js", "/extras.js", "/research.js", "/account.js", "/ai-chat.js", "/learn.js", "/wallets.js", "/trench-ui.js", "/sim.js", "/search.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
      .catch(() => caches.match("/").then((r) => r || caches.match("/index.html"))));
    return;
  }
  // Network first so a new version is never mixed with old files; the cache is the offline fallback.
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req)));
});

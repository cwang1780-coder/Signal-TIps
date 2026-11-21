// Service worker: makes Signal Tips installable and quick to open.
// - App files: network first (always the latest version), cached copy when offline.
// - The page itself: network first, cached copy if offline.
// - /api/* and anything from other sites: never cached here (always live).
const CACHE = "signal-tips-v6";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icons.js", "/currency.js", "/coins/list.js",
  "/indicators.js", "/draw.js", "/app.js", "/extras.js", "/research.js", "/account.js", "/ai-chat.js", "/learn.js", "/wallets.js", "/trench-ui.js", "/sim.js", "/search.js", "/prochart.js", "/pcdraw.js", "/exodus.js", "/sellplan.js", "/position.js", "/review.js", "/vendor/lightweight-charts.js"];

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

// Push notifications for coins you own (sent by the server, push.js)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Signal Tips", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Signal Tips", {
    body: d.body || "", tag: d.tag || undefined, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "navigate" in c) return c.navigate(url).then((w) => (w || c).focus());
    return self.clients.openWindow(url);
  }));
});

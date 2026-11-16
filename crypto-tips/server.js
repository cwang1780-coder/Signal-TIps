// Local server: serves the app, a read-only /api/coinbase/holdings endpoint, and /api/ask (AI chat).
// Run: node server.js   then open http://localhost:8000
// Binds to 127.0.0.1 only, so your Coinbase data is never exposed to your network.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadKey, getHoldings } = require("./coinbase.js");
const ai = require("./ai.js");

const PORT = +process.env.PORT || 8000;
const STATIC = new Set(["index.html", "app.js", "indicators.js", "ai-chat.js"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

let cache = { at: 0, data: null };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

  if (url.pathname === "/api/coinbase/holdings") {
    const creds = loadKey();
    if (!creds) return json(200, { connected: false, reason: "No API key configured. See README → Connect Coinbase." });
    try {
      if (!cache.data || Date.now() - cache.at > 30000 || url.searchParams.has("force")) {
        cache = { at: Date.now(), data: await getHoldings(creds) };
      }
      return json(200, { connected: true, ...cache.data, updated: cache.at });
    } catch (e) {
      console.error("[coinbase]", e.message);
      return json(200, { connected: false, reason: e.message });
    }
  }

  if (url.pathname === "/api/ask" && req.method === "POST") {
    // Block other websites (CSRF / DNS rebinding) from using your AI key through this local server.
    const host = (req.headers.host || "").split(":")[0];
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://${req.headers.host}`;
    if (!["localhost", "127.0.0.1"].includes(host) || !sameOrigin || !(req.headers["content-type"] || "").startsWith("application/json")) {
      res.writeHead(403); return res.end("Forbidden");
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 300_000) { res.writeHead(413); return res.end("Too much data"); }
    }
    let input;
    try { input = JSON.parse(body); } catch { res.writeHead(400); return res.end("Bad JSON"); }
    if (!input.question || typeof input.question !== "string") { res.writeHead(400); return res.end("Missing question"); }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    try {
      await ai.ask(input, (text) => res.write(text));
    } catch (e) {
      console.error("[ai]", e.message);
      res.write("\n\n⚠️ " + ai.friendlyError(e));
    }
    return res.end();
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!STATIC.has(file)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] });
  fs.createReadStream(path.join(__dirname, file)).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Crypto Signal Tips running at http://localhost:${PORT}`);
  console.log(ai.hasCredentials() ? `Ask AI enabled (${ai.MODEL}).` : "Ask AI: set ANTHROPIC_API_KEY to enable (see README).");
  console.log(loadKey() ? "Coinbase API key found — holdings will sync." : "No Coinbase API key — manual holdings only. See README.");
});

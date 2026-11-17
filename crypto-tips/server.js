// Local server: serves the app (public/), a read-only /api/coinbase/holdings endpoint, and /api/ask (AI chat).
// Run: node server.js   then open http://localhost:8000
// Binds to 127.0.0.1 only, so your data is never exposed to your network.
// Online, the same handlers run as Vercel functions (see api/).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadKey } = require("./coinbase.js");
const ai = require("./ai.js");
const { holdingsHandler, askHandler, socialHandler, configHandler, proHandler, researchHandler } = require("./handlers.js");

const PORT = +process.env.PORT || 8000;
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/coinbase/holdings") return holdingsHandler(req, res);
  if (url.pathname === "/api/ask") return askHandler(req, res);
  if (url.pathname === "/api/social") return socialHandler(req, res);
  if (url.pathname === "/api/config") return configHandler(req, res);
  if (url.pathname === "/api/pro") return proHandler(req, res);
  if (url.pathname === "/api/research") return researchHandler(req, res);

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^((coins|art)\/)?[\w-]+\.(html|js|svg|webmanifest|json)$/.test(file) || !fs.existsSync(path.join(PUBLIC, file))) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] });
  fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Crypto Signal Tips running at http://localhost:${PORT}`);
  console.log(ai.hasCredentials() ? `Ask AI enabled (${ai.MODEL}).` : "Ask AI: set ANTHROPIC_API_KEY to enable (see README).");
  console.log(loadKey() ? "Coinbase API key found — holdings will sync." : "No Coinbase API key — manual holdings only. See README.");
});

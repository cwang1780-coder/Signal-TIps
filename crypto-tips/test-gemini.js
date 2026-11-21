// Run: node test-gemini.js  (no real key needed: a mock Gemini API server)
const assert = require("assert");
const http = require("http");

let captured = null, mode = "ok";
const mock = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  if (req.method === "GET") { // list models
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-9.1-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-9.9-flash-tts", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-12-flash", supportedGenerationMethods: ["embedContent"] } ] }));
  }
  captured = { url: req.url, headers: req.headers, body: JSON.parse(body) };
  if (mode === "404" && req.url.includes("gemini-3.8-flash")) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 404, message: "models/gemini-3.8-flash is not found", status: "NOT_FOUND" } })); }
  if (mode === "429") { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } })); }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (mode === "slow") return; // never answers: the app must give up by itself
  const chunk = (text, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;
  res.end(chunk("BTC looks ") + chunk("**weak**.", mode === "safety" ? "SAFETY" : "STOP"));
});

(async () => {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { GEMINI_API_KEY: "test-gemini-key", GEMINI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, ANTHROPIC_API_KEY: "unused" });
  const ai = require("./ai.js");
  assert.strictEqual(ai.provider(), "gemini", "Gemini is used when its key is set");
  assert.ok(ai.hasCredentials());

  let out = "";
  await ai.ask({ question: "Sell BTC?", history: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }], snapshot: { coins: { BTC: { rsi: 30 } } } }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **weak**.");
  assert.ok(captured.url.includes("gemini-3.8-flash:streamGenerateContent"), captured.url);
  assert.strictEqual(captured.headers["x-goog-api-key"], "test-gemini-key");
  const b = captured.body;
  assert.deepStrictEqual(b.contents.map((c) => c.role), ["user", "model", "user"], "assistant turns become model turns");
  assert.ok(b.contents[2].parts[0].text.includes("Question: Sell BTC?") && b.contents[2].parts[0].text.includes('"rsi":30'));
  assert.ok(JSON.stringify(b.systemInstruction || b.system_instruction).includes("Crypto Signal Tips"), "system prompt sent");

  assert.strictEqual(b.generationConfig?.thinkingConfig?.thinkingLevel || b.generation_config?.thinking_config?.thinking_level, "LOW", "light thinking for quick answers");

  mode = "slow"; out = ""; process.env.GEMINI_TIMEOUT_MS = "300";
  const t0 = Date.now();
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.ok(Date.now() - t0 < 5000 && /took too long/.test(out), "a stuck answer is cut off: " + out);
  delete process.env.GEMINI_TIMEOUT_MS;

  mode = "safety"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.ok(out.includes("declined"));

  mode = "429";
  await assert.rejects(ai.ask({ question: "x", snapshot: {} }, () => {}), (e) => /free Gemini limit/.test(ai.friendlyError(e)));

  // Model renamed or retired: the app looks up the newest Flash model this key can use, and remembers it
  mode = "404"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **weak**.");
  assert.ok(captured.url.includes("gemini-9.1-flash:streamGenerateContent"), captured.url);

  process.env.AI_PROVIDER = "anthropic";
  assert.strictEqual(ai.provider(), "anthropic", "AI_PROVIDER=anthropic switches back to Claude");
  mock.close();
  console.log("gemini tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

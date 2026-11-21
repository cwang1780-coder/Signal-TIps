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
  if ((mode === "busy" && req.url.includes("gemini-3.8-flash")) || mode === "allbusy") { res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } })); }
  if (mode === "404" && req.url.includes("gemini-3.8-flash")) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 404, message: "models/gemini-3.8-flash is not found", status: "NOT_FOUND" } })); }
  if (mode === "429") { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } })); }
  if (req.url.includes(":generateContent") && body.includes("second opinion")) {
    const withSearch = Boolean(captured.body.tools?.length);
    if (mode === "nosearch" && withSearch) { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 429, message: "Search quota", status: "RESOURCE_EXHAUSTED" } })); }
    const review = { verdict: "hold", agreesWithSignal: false, confidence: "medium", summary: "Trend is up but news is shaky.", reasons: ["RSI 30", "ETF outflows"], risks: ["Breaks support"], news: ["Exchange hack rumour"] };
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Here you go:\n```json\n" + JSON.stringify(review) + "\n```" }] }, finishReason: "STOP",
      ...(withSearch ? { groundingMetadata: { groundingChunks: [{ web: { uri: "https://news.example/btc", title: "BTC news" } }] } } : {}) }] }));
  }
  if (req.url.includes(":generateContent")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }] })); }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (mode === "slow" || (mode === "slowfirst" && req.url.includes("gemini-3.8-flash"))) return; // never answers: the app must move on by itself
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

  assert.strictEqual(b.generationConfig?.thinkingConfig?.thinkingLevel || b.generation_config?.thinking_config?.thinking_level, "MINIMAL", "minimal thinking for quick answers");

  mode = "slow"; out = ""; process.env.GEMINI_TIMEOUT_MS = "300";
  const t0 = Date.now();
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.ok(Date.now() - t0 < 5000 && /quick answer/.test(out), "a stuck answer falls back to a quick answer: " + out);
  delete process.env.GEMINI_TIMEOUT_MS;

  // The first model hangs: after the first-word limit it moves to another model, which answers
  mode = "slowfirst"; out = ""; process.env.GEMINI_FIRST_MS = "300";
  const t1 = Date.now();
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **weak**.", out);
  assert.ok(Date.now() - t1 < 5000 && !captured.url.includes("gemini-3.8-flash"), captured.url);
  delete process.env.GEMINI_FIRST_MS;

  mode = "safety"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.ok(out.includes("declined"));

  // Google busy (503): retries, then answers from another Flash model
  mode = "busy"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **weak**.");
  assert.ok(captured.url.includes("gemini-9.1-flash:streamGenerateContent"), captured.url);
  // Everything busy: a clear message, not "error 503"
  mode = "allbusy"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.ok(/quick answer from the app/.test(out), out); // never "busy, try again": a quick answer from the app's data

  mode = "429";
  await assert.rejects(ai.ask({ question: "x", snapshot: {} }, () => {}), (e) => /free Gemini limit/.test(ai.friendlyError(e)));

  // Model renamed or retired: the app looks up the newest Flash model this key can use, and remembers it
  mode = "404"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **weak**.");
  assert.ok(captured.url.includes("gemini-9.1-flash:streamGenerateContent"), captured.url);

  // AI second opinion: structured verdict, live search requested, sources returned
  mode = "ok";
  const snap = { timeframe: "1d", coins: { BTC: { action: "BUY", score: 2.5 } } };
  let rv = await ai.review({ coin: "BTC", snapshot: snap });
  assert.strictEqual(rv.verdict, "HOLD");
  assert.strictEqual(rv.agreesWithSignal, false);
  assert.strictEqual(rv.searched, true);
  assert.deepStrictEqual(rv.sources, [{ title: "BTC news", url: "https://news.example/btc" }]);
  assert.ok(JSON.stringify(captured.body.tools).includes("googleSearch") || JSON.stringify(captured.body.tools).includes("google_search"), JSON.stringify(captured.body.tools));
  // Search not allowed (quota): still reviews, without search
  mode = "nosearch";
  rv = await ai.review({ coin: "BTC", snapshot: snap });
  assert.strictEqual(rv.searched, false);
  assert.strictEqual(rv.verdict, "HOLD");
  await assert.rejects(ai.review({ coin: "ETH", snapshot: snap }), /No signal/);
  // Ask AI is told not to contradict the signal silently
  assert.ok(/Never contradict the app's signal silently/.test(ai.SYSTEM));

  // Diagnostics page: each step reported with timings, key never shown
  mode = "ok";
  const d = await ai.diagnose();
  assert.strictEqual(d.provider, "gemini");
  assert.deepStrictEqual(d.steps.map((x) => x.ok), [true, true, true, true], JSON.stringify(d.steps));
  assert.ok(!JSON.stringify(d).includes("test-gemini-key"), "the key is never shown");

  process.env.AI_PROVIDER = "anthropic";
  assert.strictEqual(ai.provider(), "anthropic", "AI_PROVIDER=anthropic switches back to Claude");
  mock.close();
  console.log("gemini tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

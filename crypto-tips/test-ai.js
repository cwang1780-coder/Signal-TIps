// Run: node test-ai.js  (no real API key needed — uses a mock Anthropic API server)
const assert = require("assert");
const http = require("http");

let captured = null;
let mode = "ok";
const sse = (events) => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join("");

const mock = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  captured = { headers: req.headers, body: JSON.parse(body) };
  if (mode === "401") {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const msg = { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } };
  res.end(sse([
    ["message_start", { message: msg }],
    ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "BTC looks " } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "**oversold**." } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: mode === "refusal" ? "refusal" : "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } }],
    ["message_stop", {}],
  ]));
});

(async () => {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const ai = require("./ai.js");

  // buildMessages: alternation, history trimming, snapshot in final user turn
  const m = ai.buildMessages({
    question: "Buy BTC?",
    history: [{ role: "assistant", content: "hi" }, { role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "dangling" }],
    snapshot: { coins: { BTC: { rsi: 24 } } },
  });
  assert.deepStrictEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert(m[2].content.includes('"rsi":24') && m[2].content.endsWith("Question: Buy BTC?"));

  // Streaming answer + request shape
  let out = "";
  const r = await ai.ask({ question: "Buy BTC?", history: [], snapshot: { coins: {} } }, (t) => (out += t));
  assert.strictEqual(out, "BTC looks **oversold**.");
  assert.strictEqual(r.stopReason, "end_turn");
  assert.strictEqual(captured.body.model, "claude-opus-5-5");
  assert.strictEqual(captured.body.fallbacks, "default");
  assert.deepStrictEqual(captured.body.thinking, { type: "adaptive" });
  assert.strictEqual(captured.body.output_config.effort, "medium");
  assert(captured.headers["anthropic-beta"].includes("server-side-fallback-2026-07-01"));
  assert(captured.body.stream === true);

  // Refusal is surfaced to the user
  mode = "refusal"; out = "";
  await ai.ask({ question: "x", snapshot: {} }, (t) => (out += t));
  assert(out.includes("declined"));

  // Bad key -> friendly message
  mode = "401";
  await assert.rejects(ai.ask({ question: "x", snapshot: {} }, () => {}), (e) => /rejected/.test(ai.friendlyError(e)));

  // Server endpoint: streams answer, blocks cross-site requests
  mode = "ok";
  process.env.PORT = "8123";
  require("./server.js");
  await new Promise((r) => setTimeout(r, 200));
  const post = (headers, body = JSON.stringify({ question: "Buy?", snapshot: {} })) =>
    fetch("http://localhost:8123/api/ask", { method: "POST", headers, body }).then(async (res) => ({ status: res.status, text: await res.text() }));
  const good = await post({ "Content-Type": "application/json", Origin: "http://localhost:8123" });
  assert.strictEqual(good.status, 200);
  assert.strictEqual(good.text, "BTC looks **oversold**.");
  assert.strictEqual((await post({ "Content-Type": "application/json", Origin: "https://evil.example" })).status, 403);
  assert.strictEqual((await post({ "Content-Type": "text/plain" })).status, 403);
  assert.strictEqual((await post({ "Content-Type": "application/json" }, "{}")).status, 400);

  console.log("ai tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

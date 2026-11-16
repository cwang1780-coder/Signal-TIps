// Run: node test-pro.js — Pro subscriptions end to end against mock Stripe + mock Anthropic servers (offline).
const assert = require("assert");
const http = require("http");

const listen = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => r(s)); });
const readBody = async (req) => { let b = ""; for await (const c of req) b += c; return b; };

(async () => {
  // ── mock Stripe ──
  const subs = {
    sub_ACTIVE1: { id: "sub_ACTIVE1", status: "active", customer: "cus_1", metadata: {}, current_period_end: 1800000000, cancel_at_period_end: false },
    sub_CANCEL1: { id: "sub_CANCEL1", status: "canceled", customer: "cus_2", metadata: {} },
  };
  const seen = [];
  const stripeMock = await listen(async (req, res) => {
    const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
    seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    let m;
    if (req.url === "/v1/checkout/sessions" && req.method === "POST") return send(200, { id: "cs_test_new1", url: "https://checkout.stripe.test/c/cs_test_new1" });
    if (req.url === "/v1/checkout/sessions/cs_test_paid1") return send(200, { status: "complete", subscription: "sub_ACTIVE1" });
    if (req.url === "/v1/checkout/sessions/cs_test_open1") return send(200, { status: "open", subscription: null });
    if ((m = /^\/v1\/subscriptions\/(\w+)$/.exec(req.url))) {
      const sub = subs[m[1]];
      if (!sub) return send(404, { error: { message: "No such subscription" } });
      if (req.method === "POST") for (const [k, v] of Object.entries(body)) { const mm = /^metadata\[(\w+)\]$/.exec(k); if (mm) sub.metadata[mm[1]] = v; }
      return send(200, sub);
    }
    if (req.url === "/v1/billing_portal/sessions") return send(200, { url: "https://billing.stripe.test/p/" + body.customer });
    if (req.url === "/v1/prices/price_TEST1") return send(200, { unit_amount: 900, currency: "usd", recurring: { interval: "month" } });
    send(404, { error: { message: "not mocked: " + req.url } });
  });

  // ── mock Anthropic (streams a short answer) ──
  const aiMock = await listen(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;
    res.end(ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
      + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
      + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "answer" } })
      + ev("content_block_stop", { index: 0 })
      + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } })
      + ev("message_stop", {}));
  });

  Object.assign(process.env, {
    VERCEL: "1", APP_PASSWORD: "owner-pass", PRO_AI_MONTHLY_LIMIT: "2",
    STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PRICE_ID: "price_TEST1", STRIPE_API_BASE: `http://127.0.0.1:${stripeMock.address().port}`,
    ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiMock.address().port}`,
  });
  const pro = require("./pro.js");
  const h = require("./handlers.js");

  // ── units ──
  assert.strictEqual(pro.form({ a: 1, line_items: [{ price: "p", quantity: 1 }], metadata: { x: "y" } }).toString(),
    "a=1&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bx%5D=y");
  const key = pro.makeKey("sub_ACTIVE1");
  assert.strictEqual(pro.verifyKey(key), "sub_ACTIVE1");
  assert.strictEqual(pro.verifyKey(key.replace("sub_ACTIVE1", "sub_ACTIVE2")), null, "can't reuse a signature for another subscription");
  assert.strictEqual(pro.verifyKey("sub_ACTIVE1." + "A".repeat(32)), null);
  assert.strictEqual(pro.verifyKey("garbage"), null);

  // ── endpoints ──
  const app = await listen((req, res) => (req.url.startsWith("/api/pro") ? h.proHandler : req.url.startsWith("/api/config") ? h.configHandler : h.askHandler)(req, res));
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = async (path, headers = {}, method = "GET") => { const r = await fetch(base + path, { method, headers }); return { status: r.status, ...(await r.json()) }; };
  const ask = async (headers) => { const r = await fetch(base + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ question: "hi", snapshot: {} }) }); return { status: r.status, text: await r.text() }; };

  const cfg = await get("/api/config");
  assert.deepStrictEqual(cfg.pro, { enabled: true, price: { amount: 9, currency: "USD", interval: "month" }, monthlyLimit: 2 });

  const co = await get("/api/pro?action=checkout", {}, "POST");
  assert.strictEqual(co.url, "https://checkout.stripe.test/c/cs_test_new1");
  const sent = seen.find((s) => s.url === "/v1/checkout/sessions").body;
  assert.strictEqual(sent.mode, "subscription");
  assert.strictEqual(sent["line_items[0][price]"], "price_TEST1");
  assert(sent.success_url.startsWith("https://127.0.0.1") && sent.success_url.endsWith("/?pro_session={CHECKOUT_SESSION_ID}"));
  assert.strictEqual(seen[0].auth, "Bearer sk_test_abc");

  assert.strictEqual((await get("/api/pro?action=activate&session_id=cs_test_open1")).status, 402, "unpaid checkout gives no key");
  assert.strictEqual((await get("/api/pro?action=activate&session_id=../../etc")).status, 400);
  const act = await get("/api/pro?action=activate&session_id=cs_test_paid1");
  assert.strictEqual(act.key, key);

  // Ask AI: no key / forged key / cancelled subscription are refused; a subscriber gets exactly their monthly limit
  assert.strictEqual((await ask({})).status, 402);
  assert.strictEqual((await ask({ "X-Pro-Key": "sub_ACTIVE1." + "B".repeat(32) })).status, 402);
  assert.strictEqual((await ask({ "X-Pro-Key": pro.makeKey("sub_CANCEL1") })).status, 402);
  const a1 = await ask({ "X-Pro-Key": key });
  assert.deepStrictEqual([a1.status, a1.text], [200, "answer"]);
  assert.strictEqual((await ask({ "X-Pro-Key": key })).status, 200);
  const a3 = await ask({ "X-Pro-Key": key });
  assert.strictEqual(a3.status, 429, "third question is over the limit of 2");
  assert(a3.text.includes("used all 2"));
  assert.strictEqual(subs.sub_ACTIVE1.metadata.ai_count, "2");

  const st = await get("/api/pro?action=status", { "X-Pro-Key": key });
  assert.deepStrictEqual([st.pro, st.used, st.limit, st.periodEnd], [true, 2, 2, 1800000000]);
  assert.strictEqual((await get("/api/pro?action=status", { "X-Pro-Key": "nope" })).status, 401);
  assert.strictEqual((await get("/api/pro?action=status", { "X-Pro-Key": pro.makeKey("sub_CANCEL1") })).pro, false);

  // A new month resets the count
  subs.sub_ACTIVE1.metadata.ai_month = "2020-01";
  assert.strictEqual((await get("/api/pro?action=status", { "X-Pro-Key": key })).used, 0);

  // The owner still gets in with the password, without paying
  assert.strictEqual((await ask({ "X-App-Password": "owner-pass" })).status, 200);

  const portal = await get("/api/pro?action=portal", { "X-Pro-Key": key }, "POST");
  assert.strictEqual(portal.url, "https://billing.stripe.test/p/cus_1");

  console.log("pro tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

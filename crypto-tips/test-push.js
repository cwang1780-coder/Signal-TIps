// Tests for the sell plan rules (public/sellplan.js) and push subscriptions (push.js).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "push-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN;
const SellPlan = require("./public/sellplan.js");

// Daily candles following a path of closes
const series = (closes) => closes.map((c, i) => ({ time: 1.7e9 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 100 }));
const wave = (n, start, drift) => Array.from({ length: n }, (_, i) => start * (1 + drift) ** i * (1 + 0.02 * Math.sin(i / 3)));

(async () => {
  assert.strictEqual(SellPlan.plan(series([1, 2, 3])), null, "too little history: no plan");

  const upTrend = series(wave(250, 100, 0.004));
  const p = SellPlan.plan(upTrend, { cost: 120 });
  assert.ok(p.target > p.stop && p.stop < p.price, "stop below the price, target above the stop");
  assert.ok(p.stop >= p.price * 0.7 || p.stop === 120, "stop within limits");
  assert.ok(p.gain > 0 && p.insights.length >= 4, "gain and insights");
  assert.ok(["hold", "target", "watch"].includes(p.state), "uptrend is not a sell: " + p.state);

  const downTrend = series(wave(250, 300, -0.004));
  const d = SellPlan.plan(downTrend, { cost: 250 });
  assert.ok(["sell", "stop"].includes(d.state), "downtrend says sell: " + d.state);
  assert.ok(/sell/i.test(d.verdict));

  // A crash through the stop
  const crash = series([...wave(249, 100, 0.002), 60]);
  assert.strictEqual(SellPlan.plan(crash, { cost: 100 }).state, "stop", "crash hits the stop");

  // Notifications only on changes, never for the same state
  assert.strictEqual(SellPlan.message("BTC", d, d.state), null);
  assert.ok(SellPlan.message("BTC", d, "hold").title.startsWith("BTC"));
  assert.strictEqual(SellPlan.message("BTC", { ...p, state: "watch" }, "hold"), null, "no ping for hold -> watch");
  assert.ok(SellPlan.message("BTC", { ...p, state: "hold" }, "sell"), "ping when the trend comes back");

  // Subscriptions
  const push = require("./push.js");
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BNc".padEnd(87, "x"), auth: "tBH".padEnd(22, "y") } };
  await assert.rejects(push.subscribe({ subscription: { endpoint: "http://evil/" , keys: sub.keys }, coins: [] }), /Bad subscription/);
  const r = await push.subscribe({ subscription: sub, coins: [{ sym: "btc", cost: 60000, state: "hold" }, { sym: "bad sym!" }, { sym: "ETH", amt: 5 }] });
  assert.strictEqual(r.coins, 2);
  const storage = require("./storage.js");
  const keys = await storage.listKeys("push/");
  assert.strictEqual(keys.length, 1);
  const rec = await storage.getJSON(keys[0]);
  assert.deepStrictEqual(rec.coins, [{ sym: "BTC", cost: 60000 }, { sym: "ETH", cost: 0 }], "only symbols and prices paid are stored, never amounts");
  assert.strictEqual(rec.states.BTC, "hold");
  await push.unsubscribe({ endpoint: sub.endpoint });
  assert.strictEqual((await storage.listKeys("push/")).length, 0, "unsubscribe deletes the record");
  assert.deepStrictEqual(await push.run(), { ok: false, reason: "not configured" }, "no keys: run does nothing");
  console.log("push tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

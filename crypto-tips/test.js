// Run: node crypto-tips/test.js
const assert = require("assert");
const I = require("./public/indicators.js");

assert.deepStrictEqual(I.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
assert.strictEqual(I.ema([1, 2, 3], 3)[2], 2);

const up = Array.from({ length: 30 }, (_, i) => 100 + i);
assert.strictEqual(I.rsi(up, 14)[29], 100, "steady rise = RSI 100");

const mk = (closes) => closes.map((c, i) => ({ time: i, low: c, high: c, open: c, close: c, volume: 1 }));

// Long uptrend then sharp drop -> oversold signals present
const dip = [...Array.from({ length: 220 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 15 }, (_, i) => 210 - i * 6)];
const a = I.analyze(mk(dip));
assert(a.rsi < 30, "dip should be oversold");
assert(a.reasons.some((r) => r.text.includes("oversold")));

// Steady downtrend -> sell side
const down = Array.from({ length: 250 }, (_, i) => 500 - i + Math.sin(i) * 3);
const d = I.analyze(mk(down));
assert(d.score < 0, "downtrend should score negative, got " + d.score);

console.log("all tests passed", { dip: a.action, down: d.action });

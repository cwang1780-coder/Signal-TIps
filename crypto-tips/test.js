// Run: node crypto-tips/test.js
const assert = require("assert");
const I = require("./public/indicators.js");

assert.deepStrictEqual(I.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
assert.strictEqual(I.ema([1, 2, 3], 3)[2], 2);

const up = Array.from({ length: 30 }, (_, i) => 100 + i);
assert.strictEqual(I.rsi(up, 14)[29], 100, "steady rise = RSI 100");

const mk = (closes) => closes.map((c, i) => ({ time: i, low: c, high: c, open: c, close: c, volume: 1 }));

// Long uptrend then a crash below the long-term average: oversold, but NOT a buy (the lesson from the backtests)
const dip = [...Array.from({ length: 220 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 15 }, (_, i) => 210 - i * 6)];
const a = I.analyze(mk(dip));
assert(a.rsi < 30, "dip should be oversold");
assert(a.reasons.some((r) => r.text.includes("oversold") && r.pts === 0), "oversold in a downtrend earns no points");
assert(!a.action.includes("BUY"), "never buy a falling knife, got " + a.action);

// Mild pullback inside a healthy uptrend: buy the dip
const pull = [...Array.from({ length: 260 }, (_, i) => 100 + i + Math.sin(i / 4) * 4), ...[352, 345, 338, 333, 329, 326]];
const pb = I.analyze(mk(pull));
assert(pb.price > pb.sma200 && pb.score > 0, "dip in uptrend should score positive, got " + pb.score);

// Steady downtrend -> sell side
const down = Array.from({ length: 250 }, (_, i) => 500 - i + Math.sin(i) * 3);
const d = I.analyze(mk(down));
assert(d.action.includes("SELL"), "downtrend should be SELL, got " + d.action);

// Steady uptrend -> buy side
const rise = Array.from({ length: 250 }, (_, i) => 100 + i + Math.sin(i / 3) * 15); // wobbling uptrend
assert(I.analyze(mk(rise)).action.includes("BUY"));

// Too little history -> HOLD, no crash
assert.strictEqual(I.analyze(mk([1, 2, 3])).action, "HOLD");

// Backtest: no look-ahead, fees applied, sane accounting
const wave = Array.from({ length: 700 }, (_, i) => 100 + 30 * Math.sin(i / 40) + 6 * Math.sin(i / 5) + i * 0.05);
const bt = I.backtest(mk(wave));
assert(bt && bt.bars === 500 && bt.trades >= 1, "wave should produce trades");
assert(bt.markers.every((m, i, a) => i === 0 || m.side !== a[i - 1].side), "buys and sells alternate");
assert.strictEqual(bt.markers[0].side, "buy");
assert(Math.abs(bt.holdReturn - (wave[699] / wave[200] - 1)) < 1e-9);
assert(bt.maxDrawdown >= 0 && bt.maxDrawdown < 1);
// Signals at step i must not change when future candles are appended
const early = I.backtest(mk(wave.slice(0, 450))), full = I.backtest(mk(wave));
const upTo = mk(wave)[449].time;
assert.deepStrictEqual(full.markers.filter((m) => m.time <= upTo), early.markers, "no peeking ahead");
// Fees make results worse, never better
assert(I.backtest(mk(wave), { fee: 0.02 }).strategyReturn < I.backtest(mk(wave), { fee: 0 }).strategyReturn);
assert.strictEqual(I.backtest(mk(wave.slice(0, 220))), null);

console.log("all tests passed", { dip: a.action, down: d.action });

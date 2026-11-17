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

// ── Research helpers ──
// A repeating shape: the pattern finder should find the earlier repeats, and never use candles after "now"
const cyc = Array.from({ length: 600 }, (_, i) => 100 + 20 * Math.sin((i / 60) * 2 * Math.PI) + i * 0.02);
const sim = I.findSimilar(mk(cyc), { window: 30, horizons: [7, 30], k: 5 });
assert.strictEqual(sim.matches.length, 5);
assert(sim.matches[0].similarity > 0.95, "a repeating wave has near-identical past matches");
assert(sim.matches.every((m) => m.time <= 600 - 30 - 1), "every match has a known 'what happened next'");
assert(sim.matches.every((m, i, a) => a.every((o, j) => i === j || Math.abs(o.time - m.time) >= 30)), "matches come from different periods");
assert.strictEqual(sim.matches[0].path.length, 60);
assert.strictEqual(sim.summary[30].total, 5);
assert.strictEqual(I.findSimilar(mk(cyc.slice(0, 100))), null, "not enough history");
// The same phase of the wave always leads the same way, so all matches should agree on direction
assert([0, 5].includes(sim.summary[7].up));

const sh = I.setupHistory(mk(wave));
assert(sh && sh.up.n + sh.down.n === 700 - 199 - 30 && ["up", "down"].includes(sh.now));
assert.strictEqual(I.setupHistory(mk(wave.slice(0, 220))), null);

const lv = I.levels(mk(cyc));
assert(lv.support < cyc[599] && lv.resistance > cyc[599], "floor below and ceiling above the price");
assert(Math.abs(I.typicalMove(mk([100, 101, 100, 101, 100])) - 0.0099) < 0.001);
assert.strictEqual(I.median([3, 1, 2]), 2);

// ── Chart patterns: textbook shapes are named correctly, and detection never looks ahead ──
const zig = (n, start, slope, amp, per = 12) => Array.from({ length: n }, (_, i) => start * Math.exp(slope * i) * (1 + amp * Math.sin((i / per) * 2 * Math.PI)));
const mkHL = (cl) => cl.map((c, i) => ({ time: i, open: c, high: c * 1.003, low: c * 0.997, close: c, volume: 1 }));
assert.strictEqual(I.detectPattern(mkHL(zig(120, 100, 0.004, 0.03))).id, "rising-channel");
assert.strictEqual(I.detectPattern(mkHL(zig(120, 100, -0.004, 0.03))).id, "falling-channel");
assert.strictEqual(I.detectPattern(mkHL(zig(120, 100, 0, 0.02))).id, "range"); // a 4% swing is too small to be a double top
// Double bottom: down to 80, up to 92, back to 80, then rising away
const db = [...Array.from({ length: 50 }, (_, i) => 110 - i * 0.6), ...Array.from({ length: 15 }, (_, i) => 80 + i * 0.8), ...Array.from({ length: 15 }, (_, i) => 92 - i * 0.8), ...Array.from({ length: 12 }, (_, i) => 80 + i * 0.6)];
assert.strictEqual(I.detectPattern(mkHL(db)).id, "double-bottom");
// Bull flag: a steep rise, then a short gentle drift down
const bf = [...Array.from({ length: 70 }, () => 100), ...Array.from({ length: 22 }, (_, i) => 100 + i * 1.5), ...Array.from({ length: 8 }, (_, i) => 131 - i * 0.3)];
assert.strictEqual(I.detectPattern(mkHL(bf)).id, "bull-flag");
assert.strictEqual(I.detectPattern(mkHL(zig(40, 100, 0, 0.03))).id, "none", "too little history");
// History replay: events never use candles after their own time, and repeats of the same pattern count once
const longZ = mkHL([...zig(200, 100, 0.004, 0.03), ...zig(200, 220, -0.004, 0.03)]);
const ev = I.patternHistory(longZ, { horizon: 30 });
assert(ev.length >= 2 && ev.every((e, k) => k === 0 || e.id !== ev[k - 1].id || e.t - ev[k - 1].t > 1));
assert(ev.every((e) => I.detectPattern(longZ.slice(0, e.t + 1)).id === e.id), "no look-ahead");
const ps = I.patternStats(ev, ev[0].id);
assert(ps.n >= 1 && ps.up >= 0 && ps.up <= 1);
assert.strictEqual(I.patternStats(ev, "head-shoulders").n, 0);
assert(Object.keys(I.PATTERNS).length === 17 && Object.values(I.PATTERNS).every((p) => p.name && ["up", "down", "neutral"].includes(p.bias)));

console.log("all tests passed", { dip: a.action, down: d.action });

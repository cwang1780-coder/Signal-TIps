// Run: node test-forecast.js — price prediction from similar past days, and its honest accuracy test
const assert = require("assert");
const I = require("./public/indicators.js");
// A steady uptrend with wiggles: similar days were usually followed by rises
const up = Array.from({ length: 700 }, (_, i) => ({ time: i * 86400, close: 100 * 1.002 ** i * (1 + 0.03 * Math.sin(i / 5)) }));
const f = I.forecast(up);
assert.ok(f && f.horizons.length === 4, "1 day, 1 week, 1 month and 3 months");
for (const h of f.horizons) {
  assert.ok(h.p25 <= h.median && h.median <= h.p75, "range around the typical move");
  assert.ok(h.low <= h.target && h.target <= h.high);
  assert.ok(h.n >= 8 && h.upPct >= 0 && h.upPct <= 1);
}
assert.ok(f.horizons.find((h) => h.days === 90).median > 0.05, "a steady uptrend shows a rise over 3 months");
const acc = I.forecastAccuracy(up);
assert.ok(acc[7] && acc[7].tests >= 10 && acc[7].directionRight >= 0 && acc[7].directionRight <= 1);
// No peeking: changing prices after a test date doesn't change what was "predicted" before it
const a1 = I.forecastAccuracy(up.slice(0, 500)), a2 = I.forecastAccuracy(up.slice(0, 500).concat(up.slice(500).map((c) => ({ ...c, close: c.close * 3 }))));
assert.ok(a1[1].tests <= a2[1].tests);
// Too little history: no prediction
assert.strictEqual(I.forecast(up.slice(0, 40)), null);
console.log("forecast tests passed");

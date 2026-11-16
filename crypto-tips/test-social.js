// Run: node test-social.js — social summary + hype scoring (offline)
const assert = require("assert");
const { summarizeStream, hypeLevel } = require("./social.js");

const now = Date.parse("2026-11-16T12:00:00Z");
const msg = (i, sentiment, minsAgo) => ({
  id: 100 + i, body: `  post   ${i} <script>x</script> ` + "y".repeat(400), created_at: new Date(now - minsAgo * 60000).toISOString(),
  user: { username: "trader_" + i, followers: 10 }, entities: sentiment ? { sentiment: { basic: sentiment } } : {}, likes: { total: i },
});
const s = summarizeStream({
  symbol: { symbol: "BTC.X", watchlist_count: 5 },
  messages: [msg(1, "Bullish", 1), msg(2, "Bullish", 10), msg(3, "Bearish", 20), msg(4, null, 30), msg(5, "Bullish", 60)],
}, now);
assert.deepStrictEqual([s.bullish, s.bearish, s.tagged, s.bullishPct], [3, 1, 4, 75]);
assert.strictEqual(s.postsPerHour, 5);                 // 5 posts over the last hour
assert.strictEqual(s.posts[0].text.length, 280);       // trimmed, whitespace collapsed
assert(s.posts[0].text.startsWith("post 1 <script>"));  // raw text kept; the page escapes it when rendering
assert.strictEqual(s.posts[0].url, "https://stocktwits.com/trader_1/message/101");
assert.strictEqual(s.url, "https://stocktwits.com/symbol/BTC.X");

assert.strictEqual(summarizeStream({ messages: [] }).bullishPct, null);
assert.strictEqual(hypeLevel({ postsPerHour: 2, bullishPct: 60, tagged: 10 }, null), "low");
assert.strictEqual(hypeLevel({ postsPerHour: 20, bullishPct: 60, tagged: 10 }, null), "moderate");
assert.strictEqual(hypeLevel({ postsPerHour: 70, bullishPct: 95, tagged: 20 }, 3), "very high");
assert.strictEqual(hypeLevel(null, 8), "moderate");
console.log("social tests passed");

// Run: node test-wallet.js — read-only wallet lookups (offline, mocked blockchain APIs)
const assert = require("assert");
const http = require("http");
const w = require("./wallet.js");
const { walletHandler } = require("./handlers.js");

// Address detection, most specific network first
assert.deepStrictEqual(w.detectChains("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), ["eth"]);
assert.deepStrictEqual(w.detectChains("bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h"), ["btc"]);
assert.strictEqual(w.detectChains("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")[0], "btc");
assert.strictEqual(w.detectChains("rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh")[0], "xrp");
assert.deepStrictEqual(w.detectChains("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L").slice(0, 1), ["doge"]);
assert.deepStrictEqual(w.detectChains("hello"), []);

// Mock the blockchain APIs
const realFetch = global.fetch;
const seen = [];
global.fetch = async (url, opts = {}) => {
  seen.push(String(url));
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  if (String(url).includes("mempool.space")) return json({ chain_stats: { funded_txo_sum: 250000000, spent_txo_sum: 50000000 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } });
  if (String(url).includes("ethereum-rpc")) {
    const calls = JSON.parse(opts.body);
    return json(calls.map((c) => ({ id: c.id, result: c.id === 0 ? "0xde0b6b3a7640000" /* 1 ETH */ : c.id === 1 ? "0x" + (2500000n).toString(16) /* 2.5 USDC */ : "0x0" })));
  }
  if (String(url).includes("base-rpc")) {
    const calls = JSON.parse(opts.body);
    return json(calls.map((c) => ({ id: c.id, result: c.id === 0 ? "0x6f05b59d3b20000" /* 0.5 ETH */ : "0x" + (10000000n).toString(16) /* 10 USDC */ })));
  }
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (body.method === "getBalance" && String(url).includes("solana-rpc.publicnode")) return json({ result: { value: 3e9 } });
  if (body.method === "getTokenAccountsByOwner" && String(url).includes("publicnode")) return json({ error: { code: -32602, message: "Request blocked" } });
  if (body.method === "getTokenAccountsByOwner" && String(url).includes("mainnet-beta")) {
    const acc = (mint, ui) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmountString: ui } } } } } });
    return json({ result: { value: body.params[1].programId.startsWith("Tokenkeg")
      ? [acc("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "1500000"), acc("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "42.5"), acc("So1MysteryMint111111111111111111111111111", "9"), acc("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "0")]
      : [] } });
  }
  return { ok: false, status: 500, json: async () => ({}) };
};

(async () => {
  const btc = await w.getWallet("btc", "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h");
  assert.deepStrictEqual(btc.balances, [{ sym: "BTC", amt: 2 }]);
  const eth = await w.getWallet("eth", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  // Mainnet plus Base (Arbitrum and Optimism are down in this mock and are simply skipped); same coins are added up
  assert.deepStrictEqual(eth.balances, [{ sym: "ETH", amt: 1.5, where: "Ethereum + Base" }, { sym: "USDC", amt: 12.5, token: "USDC", where: "Ethereum + Base" }]);
  // Solana: SOL plus tracked tokens; the RPC that refuses token lookups is skipped; unknown tokens are listed
  const sol = await w.getWallet("sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  assert.deepStrictEqual(sol.balances.map((b) => [b.sym, b.amt]), [["SOL", 3], ["BONK", 1500000], ["WIF", 42.5]]);
  assert.deepStrictEqual(sol.untracked, [{ mint: "So1MysteryMint111111111111111111111111111", amt: 9 }]);
  await assert.rejects(w.getWallet("eth", "0x123"), /an Ethereum address/);

  // HTTP endpoint
  const srv = http.createServer(walletHandler); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/api/wallet`;
  const get = async (q) => { const r = await fetch(base + q); return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() }; };
  global.fetch = (async (orig) => async (url, o) => (String(url).startsWith("http://127.0.0.1") ? realFetch(url, o) : orig(url, o)))(global.fetch);
  global.fetch = await global.fetch;
  const ok = await get("?chain=auto&address=bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h");
  assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.chain, "btc"); assert.strictEqual(ok.cache, "private, no-store");
  const phrase = await get("?address=" + encodeURIComponent("abandon ability able about above absent absorb abstract absurd abuse access accident"));
  assert.strictEqual(phrase.status, 400); assert(/recovery phrase/.test(phrase.body.reason), "recovery phrases are refused");
  assert.strictEqual((await get("?address=nonsense")).status, 400);
  assert.strictEqual((await get("?chain=eth&address=bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h")).status, 400);
  assert.strictEqual((await get("")).status, 400);
  srv.close();
  console.log("wallet tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

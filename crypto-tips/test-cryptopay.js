// Run: node test-cryptopay.js — paying for Pro with crypto (offline: mocked prices and blockchains)
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.ACCOUNTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cp-test-"));
delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL;
const SOL_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", ETH_ADDR = "0x1111111111111111111111111111111111111111", BTC_ADDR = "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h";
Object.assign(process.env, { CRYPTO_SOL_ADDRESS: SOL_ADDR, CRYPTO_ETH_ADDRESS: ETH_ADDR, CRYPTO_BTC_ADDRESS: BTC_ADDR, CRYPTO_PRO_PRICE_USD: "5" });

// The fake blockchains: txs[hash] describes what each transaction did
const txs = {};
const now = () => Math.floor(Date.now() / 1000);
global.fetch = async (url, opts = {}) => {
  url = String(url);
  const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
  if (url.includes("/prices/")) return json({ data: { amount: url.includes("BTC") ? "60000" : url.includes("ETH") ? "2000" : "100" } });
  if (url.includes("/tx/")) { const t = txs[url.split("/tx/")[1]]; return t ? json(t) : json({}, 404); }
  const body = JSON.parse(opts.body || "{}"), [h] = body.params || [];
  const t = txs[h];
  if (body.method === "eth_getTransactionByHash") return json({ result: t ? t.tx : null });
  if (body.method === "eth_getTransactionReceipt") return json({ result: t ? t.receipt : null });
  if (body.method === "eth_getBlockByNumber") return json({ result: { timestamp: "0x" + now().toString(16) } });
  if (body.method === "getTransaction") return json({ result: t || null });
  return json({}, 500);
};
const accounts = require("./accounts.js");
const cp = require("./cryptopay.js");
const hex = (n) => "0x" + BigInt(n).toString(16);
const pad = (a) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");

(async () => {
  assert.ok(cp.enabled());
  assert.deepStrictEqual(cp.publicConfig().methods.map((m) => m.id), ["usdc-sol", "sol", "btc", "eth", "usdc-eth"]);
  const alice = await accounts.signup("alice@example.com", "alicepass1"), bob = await accounts.signup("bob@example.com", "bobpass12");

  // USDC on Solana: exact unique amount around $5
  const q1 = await cp.quote(alice, "usdc-sol"), q1b = await cp.quote(alice, "usdc-sol");
  assert.ok(/^5\.00\d{2,4}$/.test(q1.amount), q1.amount);
  assert.strictEqual(q1.address, SOL_ADDR);
  const units = (amt, d) => BigInt(Math.round(parseFloat(amt) * 10 ** Math.min(d, 9))) * 10n ** BigInt(Math.max(0, d - 9));
  const solUsdc = (owner, amount) => ({ blockTime: now(), meta: { err: null,
    preTokenBalances: [{ owner, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", uiTokenAmount: { amount: "1000000" } }],
    postTokenBalances: [{ owner, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", uiTokenAmount: { amount: String(1000000n + amount) } }] }, transaction: { message: { accountKeys: [] } } });
  const sig1 = "5".repeat(88), sig2 = "6".repeat(88), sig3 = "7".repeat(88);
  txs[sig1] = solUsdc(SOL_ADDR, units(q1.amount, 6));
  txs[sig2] = solUsdc(SOL_ADDR, units(q1.amount, 6) + 1000n); // a bit more than asked
  txs[sig3] = solUsdc("SomeoneElse111111111111111111111111111111111", units(q1.amount, 6));

  await assert.rejects(cp.verify(bob, q1.invoice, sig1, accounts.saveUser), /wasn't found/, "Bob can't use Alice's order");
  await assert.rejects(cp.verify(alice, q1.invoice, sig3, accounts.saveUser), /didn't send USDC to our Solana address/);
  await assert.rejects(cp.verify(alice, q1.invoice, sig2, accounts.saveUser), /more than/);
  await assert.rejects(cp.verify(alice, q1.invoice, "not-a-tx", accounts.saveUser), /doesn't look like a Solana transaction/);
  await assert.rejects(cp.verify(alice, q1.invoice, "8".repeat(88), accounts.saveUser), /can't see that transaction yet/);
  const ok = await cp.verify(alice, q1.invoice, "https://solscan.io/tx/" + sig1, accounts.saveUser); // pasted as an explorer link
  assert.ok(ok.ok && ok.until > Date.now() + 29 * 864e5);
  assert.strictEqual((await accounts.planOf(alice)).kind, "crypto");
  // The same transaction can't pay for a second order
  await assert.rejects(cp.verify(alice, q1b.invoice, sig1, accounts.saveUser), /already been used/);

  // Paying again adds 30 more days on top
  const q2 = await cp.quote(alice, "sol");
  assert.strictEqual(q2.asset, "SOL");
  assert.ok(Math.abs(parseFloat(q2.amount) - 0.05) < 0.001, q2.amount); // $5 at $100/SOL
  const lam = units(q2.amount, 9), sig4 = "9".repeat(88);
  txs[sig4] = { blockTime: now(), meta: { err: null, preBalances: [5e9, 0], postBalances: [5e9 - Number(lam) - 5000, Number(lam)] }, transaction: { message: { accountKeys: [{ pubkey: "Payer1111111111111111111111111111111111111" }, { pubkey: SOL_ADDR }] } } };
  const before = (await accounts.getUser(alice.id)).cryptoUntil;
  const r2 = await cp.verify(await accounts.getUser(alice.id), q2.invoice, sig4, accounts.saveUser);
  assert.ok(r2.until - before > 29 * 864e5, "30 more days added");

  // Bitcoin: must be confirmed, and the exact amount in sats
  const q3 = await cp.quote(bob, "btc");
  const sats = Number(units(q3.amount, 8)), btcTx = "a".repeat(64), btcTx2 = "b".repeat(64);
  txs[btcTx] = { status: { confirmed: false }, vout: [{ scriptpubkey_address: BTC_ADDR, value: sats }] };
  await assert.rejects(cp.verify(bob, q3.invoice, btcTx, accounts.saveUser), /not confirmed yet/);
  txs[btcTx] = { status: { confirmed: true, block_time: now() }, vout: [{ scriptpubkey_address: "bc1qother", value: 5 }, { scriptpubkey_address: BTC_ADDR, value: sats }] };
  txs[btcTx2] = { status: { confirmed: true, block_time: now() - 86400 }, vout: [{ scriptpubkey_address: BTC_ADDR, value: sats }] };
  await assert.rejects(cp.verify(bob, q3.invoice, btcTx2, accounts.saveUser), /sent before this payment order/);
  assert.ok((await cp.verify(bob, q3.invoice, btcTx.toUpperCase(), accounts.saveUser)).ok);

  // ETH, and USDC on Ethereum (a token transfer in the receipt logs)
  const bob2 = await accounts.getUser(bob.id);
  const q4 = await cp.quote(bob2, "eth"), wei = units(q4.amount, 18), ethTx = "0x" + "c".repeat(64), failTx = "0x" + "e".repeat(64);
  txs[ethTx] = { tx: { to: ETH_ADDR, value: hex(wei) }, receipt: { status: "0x1", blockNumber: "0x10", logs: [] } };
  txs[failTx] = { tx: { to: ETH_ADDR, value: hex(wei) }, receipt: { status: "0x0", blockNumber: "0x10", logs: [] } };
  await assert.rejects(cp.verify(bob2, q4.invoice, failTx, accounts.saveUser), /failed/);
  assert.ok((await cp.verify(bob2, q4.invoice, ethTx, accounts.saveUser)).ok);
  const q5 = await cp.quote(await accounts.getUser(bob.id), "usdc-eth"), tokTx = "0x" + "d".repeat(64);
  txs[tokTx] = { tx: { to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", value: "0x0" }, receipt: { status: "0x1", blockNumber: "0x10", logs: [
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", pad("0x2222222222222222222222222222222222222222"), pad(ETH_ADDR)], data: hex(units(q5.amount, 6)) }] } };
  assert.ok((await cp.verify(await accounts.getUser(bob.id), q5.invoice, tokTx, accounts.saveUser)).ok);
  assert.strictEqual((await accounts.getUser(bob.id)).payments.length, 3);

  // Off when no address is set
  delete process.env.CRYPTO_SOL_ADDRESS; delete process.env.CRYPTO_ETH_ADDRESS; delete process.env.CRYPTO_BTC_ADDRESS;
  assert.strictEqual(cp.publicConfig(), null);
  console.log("cryptopay tests passed");
})().catch((e) => { console.error(e); process.exit(1); });

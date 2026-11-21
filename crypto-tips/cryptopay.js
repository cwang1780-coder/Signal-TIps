// Pay for Pro with crypto, straight to the owner's own wallets (no payment company in between).
// 1. quote(): the user picks a coin; we lock an EXACT amount for 3 hours. A few random last digits make every order
//    unique, so a payment can only match the order it was made for (nobody can claim someone else's payment).
// 2. verify(): the user pastes their transaction ID; we read the public blockchain and check: sent to our address,
//    exactly that amount, successful/confirmed, sent after the order was made, and not used before. Then Pro is added.
// Setup (Vercel environment variables; addresses are public receive addresses, not secrets):
//   CRYPTO_SOL_ADDRESS  Solana address  -> USDC on Solana (recommended) and SOL
//   CRYPTO_ETH_ADDRESS  Ethereum address -> ETH and USDC on Ethereum
//   CRYPTO_BTC_ADDRESS  Bitcoin address  -> BTC
//   CRYPTO_PRO_PRICE_USD (default 5) and CRYPTO_PRO_DAYS (default 30)
const crypto = require("crypto");
const db = require("./storage.js");

const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC = { eth: process.env.CRYPTO_ETH_RPC || "https://ethereum-rpc.publicnode.com", sol: [process.env.CRYPTO_SOL_RPC, "https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"].filter(Boolean) };
const MEMPOOL = process.env.CRYPTO_BTC_API || "https://mempool.space/api";
const COINBASE = process.env.CRYPTO_PRICE_API || "https://api.coinbase.com/v2/prices";

const METHODS = {
  "usdc-sol": { label: "USDC on Solana", short: "USDC", network: "Solana", env: "CRYPTO_SOL_ADDRESS", decimals: 6, stable: true, note: "Recommended: always $1 per USDC and fees under a cent." },
  sol: { label: "SOL", short: "SOL", network: "Solana", env: "CRYPTO_SOL_ADDRESS", decimals: 9, spot: "SOL" },
  btc: { label: "Bitcoin", short: "BTC", network: "Bitcoin", env: "CRYPTO_BTC_ADDRESS", decimals: 8, spot: "BTC", note: "Needs 1 confirmation (about 10 minutes) before it can be checked." },
  eth: { label: "Ether", short: "ETH", network: "Ethereum", env: "CRYPTO_ETH_ADDRESS", decimals: 18, spot: "ETH", note: "Ethereum network fees can be a few dollars." },
  "usdc-eth": { label: "USDC on Ethereum", short: "USDC", network: "Ethereum", env: "CRYPTO_ETH_ADDRESS", decimals: 6, stable: true, note: "Ethereum network fees can be a few dollars." },
};
const ADDR_RE = { CRYPTO_SOL_ADDRESS: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, CRYPTO_ETH_ADDRESS: /^0x[a-fA-F0-9]{40}$/, CRYPTO_BTC_ADDRESS: /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ };
const addressFor = (m) => { const a = String(process.env[METHODS[m].env] || "").trim(); return ADDR_RE[METHODS[m].env].test(a) ? a : null; };
const priceUsd = () => Math.max(1, Math.min(1000, parseFloat(process.env.CRYPTO_PRO_PRICE_USD) || 5));
const days = () => Math.max(1, Math.min(366, parseInt(process.env.CRYPTO_PRO_DAYS, 10) || 30));
const enabled = () => db.available() && Object.keys(METHODS).some(addressFor);
const err = (status, message) => Object.assign(new Error(message), { status });
const hashKey = (chain, tx) => "cryptopay/used/" + crypto.createHash("sha256").update(chain + ":" + tx).digest("hex").slice(0, 40) + ".json";

function publicConfig() {
  if (!enabled()) return null;
  return { priceUsd: priceUsd(), days: days(), methods: Object.entries(METHODS).filter(([id]) => addressFor(id)).map(([id, m]) => ({ id, label: m.label, network: m.network, note: m.note || null })) };
}

// Base units (BigInt) -> decimal string, e.g. 5004321n, 6 -> "5.004321"
function fmtUnits(units, decimals) {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0", frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function spotUsd(sym) {
  const r = await fetch(`${COINBASE}/${sym}-USD/spot`, { signal: AbortSignal.timeout(8000) });
  const v = parseFloat((await r.json())?.data?.amount);
  if (!r.ok || !(v > 0)) throw err(502, "Couldn't get the current price. Try again in a minute.");
  return v;
}

async function quote(user, method) {
  const m = METHODS[method], address = m && addressFor(method);
  if (!address) throw err(400, "That coin isn't available for payment.");
  const usd = priceUsd();
  // The unique tail is always worth well under a dollar: up to 999 sats for BTC, otherwise up to 9999 of the last digits
  const tail = BigInt(crypto.randomInt(1, m.spot === "BTC" ? 999 : 9999));
  let units;
  if (m.stable) units = BigInt(Math.round(usd * 1e6)) * 10n ** BigInt(m.decimals - 6) + tail; // e.g. 5.004321 USDC
  else {
    const px = await spotUsd(m.spot);
    // Round to a sensible precision, then add the unique tail in the last kept digits
    const keep = { BTC: 8, ETH: 8, SOL: 7 }[m.spot], scale = 10n ** BigInt(m.decimals - keep);
    units = (BigInt(Math.ceil((usd / px) * 10 ** keep)) + tail) * scale;
  }
  const id = crypto.randomBytes(12).toString("hex");
  const inv = { id, user: user.id, method, address, units: units.toString(), amount: fmtUnits(units, m.decimals), usd, created: Date.now(), expires: Date.now() + 3 * 3600e3 };
  await db.putJSON(`cryptopay/invoices/${id}.json`, inv);
  return { invoice: id, method, label: m.label, network: m.network, asset: m.short, address, amount: inv.amount, usd, days: days(), expires: inv.expires, note: m.note || null };
}

const rpc = async (url, method, params) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw err(502, "Couldn't reach the blockchain right now. Try again in a minute.");
  const d = await r.json();
  if (d.error) throw err(502, "The blockchain lookup failed: " + String(d.error.message || "").slice(0, 120));
  return d.result;
};

// Each returns { received: BigInt base units to our address, time: ms, final: bool } or null if the tx isn't found yet
const CHECK = {
  async btc(tx, inv) {
    const r = await fetch(`${MEMPOOL}/tx/${tx}`, { signal: AbortSignal.timeout(12000) });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw err(502, "Couldn't reach the Bitcoin network right now. Try again in a minute.");
    const d = await r.json();
    const received = (d.vout || []).filter((o) => o.scriptpubkey_address === inv.address).reduce((t, o) => t + BigInt(o.value), 0n);
    return { received, time: d.status?.block_time ? d.status.block_time * 1000 : Date.now(), final: Boolean(d.status?.confirmed) };
  },
  async eth(tx, inv, token) {
    const [t, rc] = await Promise.all([rpc(RPC.eth, "eth_getTransactionByHash", [tx]), rpc(RPC.eth, "eth_getTransactionReceipt", [tx])]);
    if (!t || !rc) return null;
    const blk = await rpc(RPC.eth, "eth_getBlockByNumber", [rc.blockNumber, false]);
    const time = blk?.timestamp ? parseInt(blk.timestamp, 16) * 1000 : Date.now(), ok = rc.status === "0x1";
    const to = inv.address.toLowerCase();
    let received = 0n;
    if (!token) { if (String(t.to).toLowerCase() === to) received = BigInt(t.value); }
    else for (const l of rc.logs || []) {
      if (String(l.address).toLowerCase() === token && l.topics?.[0] === TRANSFER && ("0x" + String(l.topics[2]).slice(-40)).toLowerCase() === to) received += BigInt(l.data);
    }
    return { received: ok ? received : 0n, time, final: ok };
  },
  async sol(tx, inv, mint) {
    let d;
    for (const url of RPC.sol) {
      try { d = await rpc(url, "getTransaction", [tx, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]); break; }
      catch (e) { d = undefined; if (url === RPC.sol[RPC.sol.length - 1]) throw e; }
    }
    if (!d) return null;
    const meta = d.meta || {}, ok = !meta.err;
    let received = 0n;
    if (!mint) {
      const keys = (d.transaction?.message?.accountKeys || []).map((k) => (typeof k === "string" ? k : k.pubkey));
      const i = keys.indexOf(inv.address);
      if (i >= 0) received = BigInt(meta.postBalances?.[i] ?? 0) - BigInt(meta.preBalances?.[i] ?? 0);
    } else {
      const bal = (list) => (list || []).filter((b) => b.owner === inv.address && b.mint === mint).reduce((t, b) => t + BigInt(b.uiTokenAmount?.amount || "0"), 0n);
      received = bal(meta.postTokenBalances) - bal(meta.preTokenBalances);
    }
    return { received: ok && received > 0n ? received : 0n, time: d.blockTime ? d.blockTime * 1000 : Date.now(), final: ok };
  },
};
const TX_RE = { btc: /^[a-f0-9]{64}$/i, eth: /^0x[a-f0-9]{64}$/i, sol: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/ };

async function verify(user, invoiceId, txRaw, saveUser) {
  if (!/^[a-f0-9]{24}$/.test(String(invoiceId))) throw err(400, "Start a new payment first.");
  const inv = await db.getJSON(`cryptopay/invoices/${invoiceId}.json`);
  if (!inv || inv.user !== user.id) throw err(404, "That payment order wasn't found. Start a new one.");
  if (inv.paid) return { already: true, until: user.cryptoUntil };
  const m = METHODS[inv.method], chain = inv.method === "btc" ? "btc" : inv.method.endsWith("sol") || inv.method === "sol" ? "sol" : "eth";
  // Accept the ID on its own, or pasted inside an explorer link
  let tx = String(txRaw || "").trim();
  const fromLink = tx.match(chain === "sol" ? /[1-9A-HJ-NP-Za-km-z]{64,90}/ : chain === "eth" ? /0x[a-fA-F0-9]{64}/ : /[a-fA-F0-9]{64}/);
  if (fromLink) tx = fromLink[0];
  if (!TX_RE[chain].test(tx)) throw err(400, `That doesn't look like a ${m.network} transaction ID. Copy it from your wallet's transaction details.`);
  if (chain !== "sol") tx = tx.toLowerCase();
  if (await db.getJSON(hashKey(chain, tx))) throw err(409, "That transaction has already been used for a payment.");

  const res = await (chain === "btc" ? CHECK.btc(tx, inv) : chain === "eth" ? CHECK.eth(tx, inv, inv.method === "usdc-eth" ? USDC_ETH : null) : CHECK.sol(tx, inv, inv.method === "usdc-sol" ? USDC_SOL : null));
  if (!res) throw err(404, chain === "btc" ? "We can't see that transaction yet. Bitcoin can take about 10 minutes; try again then." : "We can't see that transaction yet. Wait a minute and try again, and check you copied the whole ID.");
  if (!res.final) throw err(409, chain === "btc" ? "Seen, but not confirmed yet. Bitcoin needs 1 confirmation (about 10 minutes); try again then." : "That transaction failed on the blockchain, so no money arrived.");
  if (res.time < inv.created - 10 * 60e3) throw err(400, "That transaction was sent before this payment order was made, so it can't be used for it.");
  const want = BigInt(inv.units);
  if (res.received === 0n) throw err(400, `That transaction didn't send ${m.short} to our ${m.network} address. Check you used the address shown.`);
  if (res.received !== want) {
    const got = fmtUnits(res.received, m.decimals);
    if (res.received < want) throw err(400, `It sent ${got} ${m.short}, but this order needs exactly ${inv.amount} ${m.short}. Contact the site owner about the difference.`);
    // More than asked: still yours, but only the exact amount ties a payment to an order. The owner can sort it out.
    throw err(400, `It sent ${got} ${m.short}, more than the ${inv.amount} ${m.short} this order needs. Contact the site owner and they'll add your Pro by hand.`);
  }
  // Paid: claim the transaction first (so it can't be used twice), then add the time
  await db.putJSON(hashKey(chain, tx), { invoice: inv.id, user: user.id, at: Date.now() });
  inv.paid = { tx, at: Date.now() };
  await db.putJSON(`cryptopay/invoices/${inv.id}.json`, inv);
  user.cryptoUntil = Math.max(user.cryptoUntil || 0, Date.now()) + days() * 864e5;
  user.payments = [...(user.payments || []), { method: inv.method, amount: inv.amount, usd: inv.usd, tx, at: Date.now() }].slice(-50);
  await saveUser(user);
  return { ok: true, until: user.cryptoUntil, amount: inv.amount, asset: m.short };
}

module.exports = { enabled, publicConfig, quote, verify, METHODS, fmtUnits };

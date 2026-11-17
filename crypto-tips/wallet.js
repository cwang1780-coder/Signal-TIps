// Read-only wallet balances from a PUBLIC address. No usernames, passwords, emails or recovery phrases, ever.
// A public ("receive") address is already visible to anyone on the blockchain; it can't be used to move funds.
// Nothing here stores or logs addresses: results live in a short in-memory cache (60s) and are then forgotten.
const UA = { "User-Agent": "signal-tips/1.0", Accept: "application/json" };
const TTL = 60 * 1000;
const cache = new Map(); // key -> {at, data}; holds balances only briefly, never written anywhere

const CHAINS = {
  btc: { name: "Bitcoin", sym: "BTC", re: /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ },
  eth: { name: "Ethereum", sym: "ETH", re: /^0x[a-fA-F0-9]{40}$/ },
  sol: { name: "Solana", sym: "SOL", re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
  ltc: { name: "Litecoin", sym: "LTC", re: /^(ltc1[a-z0-9]{25,87}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/ },
  doge: { name: "Dogecoin", sym: "DOGE", re: /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/ },
  xrp: { name: "XRP Ledger", sym: "XRP", re: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/ },
};

// Popular Ethereum tokens checked for every ETH address (symbol as priced on Coinbase, decimals).
const ERC20 = [
  ["USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], ["USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6],
  ["DAI", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18], ["LINK", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18],
  ["UNI", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18], ["SHIB", "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", 18],
  ["PEPE", "0x6982508145454Ce325dDbE47a25d4ec3d2311933", 18], ["AAVE", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18],
  ["BTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "WBTC"], ["POL", "0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6", 18],
  ["POL", "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0", 18, "MATIC"], ["ARB", "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", 18],
];

// Which chains an address could belong to, most specific first (Solana's format overlaps others, so it goes last).
function detectChains(address) {
  return ["eth", "btc", "ltc", "doge", "xrp", "sol"].filter((id) => CHAINS[id].re.test(address));
}

const get = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(12000) });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error("Lookup service returned " + r.status), { status: 502 });
  return r.json();
};
const rpc = (url, body) => get(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Integer string in base units -> decimal number (accurate enough for display).
const units = (big, decimals) => Number(BigInt(big)) / 10 ** decimals;

const FETCHERS = {
  async btc(a) {
    const d = await get(`https://mempool.space/api/address/${a}`);
    if (!d) return [{ sym: "BTC", amt: 0 }];
    const s = d.chain_stats, m = d.mempool_stats;
    return [{ sym: "BTC", amt: (s.funded_txo_sum - s.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum) / 1e8 }];
  },
  async eth(a) {
    const url = "https://ethereum-rpc.publicnode.com", pad = a.slice(2).toLowerCase().padStart(64, "0");
    const calls = [{ jsonrpc: "2.0", id: 0, method: "eth_getBalance", params: [a, "latest"] },
      ...ERC20.map(([, c], i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [{ to: c, data: "0x70a08231" + pad }, "latest"] }))];
    const res = await rpc(url, calls);
    const byId = Object.fromEntries((res || []).map((r) => [r.id, r.result]));
    const out = [{ sym: "ETH", amt: byId[0] ? units(byId[0], 18) : 0 }];
    ERC20.forEach(([sym, , dec, label], i) => {
      const v = byId[i + 1];
      if (v && v !== "0x" && BigInt(v) > 0n) out.push({ sym, amt: units(v, dec), token: label || sym });
    });
    return out;
  },
  async sol(a) {
    const d = await rpc("https://solana-rpc.publicnode.com", { jsonrpc: "2.0", id: 1, method: "getBalance", params: [a] });
    if (d?.error) throw Object.assign(new Error("That doesn't look like a Solana address."), { status: 400 });
    return [{ sym: "SOL", amt: (d?.result?.value || 0) / 1e9 }];
  },
  async ltc(a) {
    const d = await get(`https://api.blockcypher.com/v1/ltc/main/addrs/${a}/balance`);
    return [{ sym: "LTC", amt: (d?.final_balance || 0) / 1e8 }];
  },
  async doge(a) {
    const d = await get(`https://api.blockcypher.com/v1/doge/main/addrs/${a}/balance`);
    return [{ sym: "DOGE", amt: (d?.final_balance || 0) / 1e8 }];
  },
  async xrp(a) {
    const d = await rpc("https://xrplcluster.com", { method: "account_info", params: [{ account: a, ledger_index: "validated" }] });
    const bal = d?.result?.account_data?.Balance;
    return [{ sym: "XRP", amt: bal ? Number(bal) / 1e6 : 0 }];
  },
};

// Combine same-symbol rows (e.g. POL and old MATIC tokens)
function merge(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.sym, { ...r, amt: (m.get(r.sym)?.amt || 0) + r.amt });
  return [...m.values()];
}

async function getWallet(chain, address) {
  const c = CHAINS[chain];
  if (!c) throw Object.assign(new Error("Unsupported network."), { status: 400 });
  if (!c.re.test(address)) throw Object.assign(new Error(`That doesn't look like ${/^[AEIOU]/.test(c.name) ? "an" : "a"} ${c.name} address.`), { status: 400 });
  const key = chain + ":" + address, hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = { chain, network: c.name, balances: merge(await FETCHERS[chain](address)), checked: Date.now() };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { getWallet, detectChains, CHAINS, ERC20 };

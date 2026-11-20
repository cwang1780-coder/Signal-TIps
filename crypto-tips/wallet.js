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

// Popular Solana tokens (mint address -> symbol as priced on Coinbase). Amounts come with their decimals applied.
const SPL = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC", Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK", EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIF",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": "TRUMP",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTH", jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "JTO",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY", orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "ORCA",
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: "RENDER", "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "W",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": "POPCAT", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": "PENGU",
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump": "FARTCOIN",
};
const SPL_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]; // classic + Token-2022
// Solana RPCs that answer token lookups (the first one refuses them, so it's only used for the plain balance)
const SOL_TOKEN_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

// The same 0x address also works on these Ethereum "layer 2" networks, where ETH and USDC are common
// (Coinbase Wallet uses Base). Each is optional: if one is down, the rest still show.
const L2 = [
  ["Base", "https://base-rpc.publicnode.com", [["USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6]]],
  ["Arbitrum", "https://arbitrum-one-rpc.publicnode.com", [["USDC", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6], ["ARB", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18]]],
  ["Optimism", "https://optimism-rpc.publicnode.com", [["USDC", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6], ["OP", "0x4200000000000000000000000000000000000042", 18]]],
];

// ETH plus ERC-20 balances on one EVM network, in a single batched request
async function evmBalances(url, a, tokens, where) {
  const pad = a.slice(2).toLowerCase().padStart(64, "0");
  const calls = [{ jsonrpc: "2.0", id: 0, method: "eth_getBalance", params: [a, "latest"] },
    ...tokens.map(([, c], i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [{ to: c, data: "0x70a08231" + pad }, "latest"] }))];
  const res = await rpc(url, calls);
  const byId = Object.fromEntries((Array.isArray(res) ? res : []).map((r) => [r.id, r.result]));
  const out = [];
  if (byId[0] && BigInt(byId[0]) > 0n) out.push({ sym: "ETH", amt: units(byId[0], 18), ...(where ? { where } : {}) });
  tokens.forEach(([sym, , dec, label], i) => {
    const v = byId[i + 1];
    if (v && v !== "0x" && BigInt(v) > 0n) out.push({ sym, amt: units(v, dec), token: label || sym, ...(where ? { where } : {}) });
  });
  return out;
}

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
    const main = await evmBalances("https://ethereum-rpc.publicnode.com", a, ERC20);
    const l2 = await Promise.all(L2.map(([where, url, tokens]) => evmBalances(url, a, tokens, where).catch(() => [])));
    const out = [...main, ...l2.flat()];
    return out.length ? out : [{ sym: "ETH", amt: 0 }];
  },
  async sol(a) {
    const d = await rpc("https://solana-rpc.publicnode.com", { jsonrpc: "2.0", id: 1, method: "getBalance", params: [a] });
    if (d?.error) throw Object.assign(new Error("That doesn't look like a Solana address."), { status: 400 });
    const out = [{ sym: "SOL", amt: (d?.result?.value || 0) / 1e9 }];
    // Tokens (BONK, WIF, JUP…). Optional: if no RPC answers, the SOL balance still shows.
    const others = new Map();
    for (const program of SPL_PROGRAMS) {
      let accounts = null;
      for (const url of SOL_TOKEN_RPCS) {
        try {
          const t = await rpc(url, { jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [a, { programId: program }, { encoding: "jsonParsed" }] });
          if (Array.isArray(t?.result?.value)) { accounts = t.result.value; break; }
        } catch {}
      }
      for (const acc of accounts || []) {
        const info = acc?.account?.data?.parsed?.info, amt = +info?.tokenAmount?.uiAmountString || 0;
        if (!info?.mint || !(amt > 0)) continue;
        if (SPL[info.mint]) out.push({ sym: SPL[info.mint], amt, token: SPL[info.mint], mint: info.mint });
        else others.set(info.mint, (others.get(info.mint) || 0) + amt);
      }
    }
    // Tokens we don't track (mostly new or small coins): listed so you know we saw them
    out.untracked = [...others].slice(0, 30).map(([mint, amt]) => ({ mint, amt }));
    return out;
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
  // Same coin on several networks (ETH on Ethereum and Base): add the amounts, and say where it is
  for (const r of rows) {
    const prev = m.get(r.sym), where = [...new Set([prev ? prev.where || "Ethereum" : null, r.where || (prev ? "Ethereum" : null)].filter(Boolean))].join(" + ");
    const row = { ...(prev || r), amt: (prev?.amt || 0) + r.amt };
    if (where) row.where = prev ? where : r.where; else delete row.where;
    if (!row.where) delete row.where;
    m.set(r.sym, row);
  }
  return [...m.values()];
}

async function getWallet(chain, address) {
  const c = CHAINS[chain];
  if (!c) throw Object.assign(new Error("Unsupported network."), { status: 400 });
  if (!c.re.test(address)) throw Object.assign(new Error(`That doesn't look like ${/^[AEIOU]/.test(c.name) ? "an" : "a"} ${c.name} address.`), { status: 400 });
  const key = chain + ":" + address, hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const rows = await FETCHERS[chain](address);
  const data = { chain, network: c.name, balances: merge(rows), untracked: rows.untracked || [], checked: Date.now() };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { getWallet, detectChains, CHAINS, ERC20, SPL };

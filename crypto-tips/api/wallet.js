// Vercel function: GET /api/wallet?chain=btc&address=... (read-only balances for a public address)
module.exports = require("../handlers.js").walletHandler;

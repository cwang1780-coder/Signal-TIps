# Crypto Signal Tips

A browser app that pulls live market data from Coinbase's public API and turns standard
technical indicators into simple BUY / SELL / HOLD tips, each with the reasons behind it.
You can sync your Coinbase balances and ask an AI questions about the signals and your holdings.

**Not financial advice.** The tips come from indicators that are often wrong.

## Run it
You need [Node.js](https://nodejs.org) 18 or newer.

    cd crypto-tips
    npm install           # first time only
    node server.js        # then open http://localhost:8000

Without a Coinbase key the app still works on public market data, and you can type holdings in manually.

## Connect Coinbase (read-only)
1. Sign in at https://portal.cdp.coinbase.com/ and go to **API Keys → Create API key**.
2. Under permissions, tick **View** only. Do **not** enable Trade or Transfer: this app only reads balances.
3. Download the key file. Save it as `crypto-tips/coinbase-key.json` (git ignores it, so it won't be committed).
   - Or set the environment variables `COINBASE_API_KEY_NAME` and `COINBASE_API_PRIVATE_KEY` instead.
4. Restart `node server.js`. It should print "Coinbase API key found", and the holdings table will show
   your Coinbase balances, cash, average buy price, profit/loss and a tip for each coin.

Both key types Coinbase offers (ECDSA and Ed25519) work.

How the key is kept safe:
- It stays on your computer. The server reads it and signs each request with a JWT that expires after 2 minutes.
- The browser never sees the key. It only gets back your balances.
- The server listens only on `127.0.0.1`, so other devices on your network can't reach it.
- Never paste your private key into chat, email, or a commit.

Exodus has no public API, so add Exodus holdings by typing them into the table.

## Ask AI
The "Ask AI" panel lets you ask questions in plain English, such as "Should I buy more ETH or wait?"
or "Review my holdings". Each question is sent with the data on the page: every coin's signals and
reasons, plus your holdings and cash. The answer streams back from Claude (`claude-opus-5-5`).

To turn it on:
1. Create an API key at https://console.anthropic.com/ (API usage is billed by Anthropic, separately from any Claude subscription).
2. Start the server with the key set:

       ANTHROPIC_API_KEY=sk-ant-...  node server.js          # macOS / Linux
       $env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js   # Windows PowerShell

   The server prints "Ask AI enabled" when it finds the key.

Notes:
- The key stays in the server process. The browser never sees it.
- The endpoint only accepts requests from the app's own page, so other websites can't use your key through it.
- If Claude declines a question for safety reasons, the request is automatically retried on a fallback model.
- To use a different model, set `AI_MODEL` (for example `AI_MODEL=claude-sonnet-5-5`, which is cheaper).

## How tips are scored
Each indicator adds or removes points:

| Signal | Bullish | Bearish |
|---|---|---|
| RSI(14) | < 30 (+2), < 40 (+1) | > 70 (−2), > 60 (−1) |
| MACD(12,26,9) | fresh cross up (+2), above signal (+0.5/+1) | fresh cross down (−2), below signal (−0.5/−1) |
| Price vs 50 avg | above (+1) | below (−1) |
| 50 avg vs 200 avg | above (+1) | below (−1) |
| Bollinger(20,2) | at lower band (+1) | at upper band (−1) |
| Volume spike > 1.5× | on up move (+0.5) | on down move (−0.5) |

Total ≥ 4 = STRONG BUY, ≥ 1.5 = BUY, ≤ −1.5 = SELL, ≤ −4 = STRONG SELL, otherwise HOLD.

## Holdings
Type in what you hold on Coinbase, Exodus or any other wallet. The app shows the value,
profit or loss, and the current tip for each coin. This data stays in your browser's localStorage.

## Tests
    npm test   # indicators, Coinbase auth/parsing, AI request + endpoint (all offline, mocked APIs)

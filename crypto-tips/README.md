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

## Price alerts
Set alerts for any coin you track:
- the price goes above or drops below a level
- the price moves more than a set % in 24h
- the signal turns BUY or SELL
- social hype gets high

When an alert fires it shows a pop-up on the page and, if you allow it, a phone or desktop notification.
Alerts are checked every minute while the page is open (a background tab is fine) and are saved in your browser.
Each alert fires once; press **Re-arm** to use it again.

## Social buzz
Shows what people are posting about each coin, so you can see the hype as well as the chart:
- **StockTwits** posts. Many are tagged Bullish or Bearish by their authors, so you see the crowd's mood (% bullish) and how fast people are posting.
- **CoinGecko trending:** the coins people are searching for most right now.
- **Hype level** (low → very high) combines how fast people are posting, how one-sided the mood is, and trending rank.
- **Warnings** when the crowd and the chart disagree, or when everyone is bullish (often a sign of a top).
- Tap a coin to read the latest posts with links to the originals. The coin's detail view shows them too.
- Ask AI sees this data, so you can ask things like "Is the BTC hype real?"

Posts are strangers' opinions, not facts, and hype is often used for pump-and-dumps.
Reddit, X/Twitter and CryptoPanic need paid or approved API access, so they aren't included yet.

## Put it online (Vercel)
The app deploys to Vercel as-is: `public/` is the page, and `api/` holds the two serverless
functions (Coinbase sync and Ask AI).

1. Deploy: `npx vercel deploy` from this folder. Or import the GitHub repo in Vercel and set **Root Directory** to `crypto-tips`.
2. In the Vercel project go to **Settings → Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `APP_PASSWORD` | A long password you choose. **Required.** Without it, Coinbase sync and Ask AI stay switched off online. |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key (for Ask AI) |
   | `COINBASE_API_KEY_NAME` | The key's `name` from your Coinbase key file |
   | `COINBASE_API_PRIVATE_KEY` | The key's `privateKey` from the same file (paste it as-is, including the BEGIN/END lines) |

3. Redeploy so the variables take effect. Open the site, enter the password once, and the browser remembers it.

Security notes:
- Prices and tips are public data, so anyone with the link can see those.
- Your balances and the AI need the password. Wrong guesses are slowed down.
- Use a password you don't use anywhere else, and keep the Coinbase key **View-only**.

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

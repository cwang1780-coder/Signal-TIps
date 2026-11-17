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

## Images
- **Coin logos:** `public/coins/` holds the [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) set (v0.18.1, CC0 public domain, 483 coins). A coin with no logo there shows its initials on a coloured circle instead.
- **Section pictures:** `public/art/` holds original illustrations made for this app (signals, buzz, alerts, AI, coins, experience).

## Beginner or experienced
On a first visit the app asks whether you're new to trading or an experienced trader, and you can switch any time in the **👤 Me** tab.
It changes presentation only; both see the same signals and data.

| | 🌱 New to trading | 📊 Experienced |
|---|---|---|
| Learn to trade | 7 short lessons with quick checks, a "Start here" card, and "How to use this" tips on each page | Hidden |
| Timeframe | Long-term only | Long, medium or short-term |
| Alerts | Price levels and BUY/SELL changes | Also 24h moves and social hype |
| Coin research | Reasons for and against, news, a one-line track record | Everything, including pattern history and full track record stats |
| Coin cards | Plain-English sentence | RSI, score, distance from the 200 average; denser grid |
| Technical details | Collapsed, with a "what it means" note per number | Open, compact |
| Drawing tools | Behind a "Draw on the chart" button | Always showing |
| Help and glossary | Open, plus a short how-to | Hidden |
| Ask AI | Simple words, terms explained, beginner question buttons | Concise and technical, trader question buttons |

## Research
Each coin's detail view adds context that does **not** change the score:
- **More to weigh:** other reasons people buy or sell (Bitcoin's trend, strength versus Bitcoin, distance from the high, support and resistance, how much it swings, crowd mood, market mood, whether the signals have worked on this coin).
- **What history says:** how the coin did over the next 30 candles when it was above versus below its 200-period average, and the 8 most similar past price shapes with what followed.
- **Latest news** that mentions the coin, plus top crypto headlines on the Buzz tab, and the Fear & Greed index and whole-market numbers on the Signals tab.

What testing showed: similar-pattern matches called the next move's direction right about half the time (no better than chance), and
"buy on extreme fear" was barely better than any ordinary day for Bitcoin from 2018 to 2026. The app says this next to those sections.

## Track record
Each coin's detail view replays the app's own signals over the chart's history: buy when the signal turns BUY,
sell when it turns SELL, with a 0.5% fee per trade, over roughly the last 700 candles of the chart. It shows the result next to simply holding the coin,
how many trades won, and the biggest drop along the way. ▲ and ▼ on the chart mark each buy and sell.
Each step only uses data available at that moment. The numbers are shown as they are, including when the signals lose to holding.

## Earning from it

### Pro subscriptions (Stripe)
Visitors pay a monthly subscription to unlock Ask AI. There is no database and no user accounts:
Stripe holds the subscriptions, and the app checks with Stripe on every Pro request.

Set up (about 15 minutes):
1. Create a Stripe account at https://stripe.com and finish its business details so you can take live payments.
2. In Stripe: **Product catalog → Add product**. Name it (for example "Crypto Signal Tips Pro"), choose **Recurring**, monthly, and set your price. Copy the **price ID** (starts with `price_`).
3. In Stripe: **Settings → Billing → Customer portal**, switch it on so subscribers can cancel or update their card themselves.
4. In Stripe: **Developers → API keys**, copy the **secret key**. Start with the test key (`sk_test_...`) and Stripe's test card `4242 4242 4242 4242`.
5. In Vercel → **Settings → Environment Variables**, add the values below, then redeploy.

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key |
| `STRIPE_PRICE_ID` | The price ID from step 2 |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (it pays for subscribers' questions) |
| `APP_PASSWORD` | Your owner password (you keep free access through "Owner login") |
| `PRO_AI_MONTHLY_LIMIT` | Optional. AI questions per subscriber per month. Default 150. |
| `AI_MODEL` | Optional. Which Claude model answers. Default `claude-opus-5-5`. |

How it works for a subscriber:
- **Go Pro** opens Stripe's hosted checkout. Card details never touch this app.
- After paying they come back and the browser stores a **Pro key** (the subscription ID plus a signature only this server can make).
- **Copy my Pro key** lets them unlock Pro on another device. **Manage subscription** opens Stripe's portal to cancel or change card.
- If they cancel or a payment fails, Pro switches off within about a minute. No webhooks are needed.
- Their monthly question count is stored on their Stripe subscription and resets each calendar month.

What a subscriber costs you: a typical question is roughly 4,000 tokens in and under 1,000 out. On `claude-opus-5-5`
($4 / $20 per million tokens) that is about 3 to 4 cents, so a subscriber who uses all 150 questions costs about $5 to $6 a month.
`claude-sonnet-5-5` is about half that. Stripe's fee comes on top (see Stripe's pricing for your country).
Set the price and `PRO_AI_MONTHLY_LIMIT` so the worst case still leaves you a margin.

Before taking real payments: publish terms of service, a privacy policy and a refund policy; check the commercial-use terms
of the data sources (CoinGecko, StockTwits); and get legal advice on whether paid signals count as investment advice where you live.

### Referral link
Set `COINBASE_REFERRAL_URL` (an https coinbase.com affiliate link) in the environment. The "Trade on Coinbase"
button becomes a labelled referral link.

## Install on a phone
Open the site in the phone's browser and choose **Add to Home Screen**. It opens full-screen like an app.

## Draw on the chart
Open any coin to see its chart with a drawing toolbar:
- 👆 **Look**: no drawing. On a phone this lets the page scroll normally.
- ✏️ **Pen**: draw freely.
- ╱ **Trend line**: drag between two points.
- ― **Price level**: tap to mark support or resistance. The price shows on the right.
- ➚ **Arrow**: drag to point at something.
- **T Note**: tap and type a label.
- 🧽 **Eraser**: tap a drawing to delete it.
- **6 colours, Undo, and Clear** (tap Clear twice to confirm).

Drawings are pinned to a price and date, so they stay in the right place when prices update or you switch timeframe.
They're saved per coin in your browser. Every price level you draw shows a **🔔 Alert** button that turns it into a price alert.

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
The signals are **trend-aware**: the long-term trend decides how everything else is read.

| Signal | Bullish | Bearish |
|---|---|---|
| Price vs 200-period average (long-term trend) | above (+2) | below (−2) |
| Price vs 50-period average | above (+1) | below (−1) |
| MACD(12,26,9) | fresh cross up (+1.5), above signal (+0.5) | fresh cross down (−1.5), below signal (−0.5) |
| RSI(14) in an **uptrend** | dip under 35 (+1.5), under 45 (+0.5) | — |
| RSI(14) in a **downtrend** | oversold earns **nothing** | bounce over 65 (−1) |
| RSI over 80 (either trend) | — | extremely stretched (−1) |

Total ≥ 2 = BUY, ≥ 4.5 = STRONG BUY, ≤ −2 = SELL, ≤ −4.5 = STRONG SELL, otherwise HOLD.
Bollinger bands and volume spikes are shown as context but earn no points.

### Why these rules
The first version bought every "oversold" dip. Tested on about 4 years of daily data for 10 coins
(buy on BUY, sell on SELL, 0.5% fee per trade), it did no better than holding and often worse, because in a
falling market oversold coins keep falling. The trend-aware rules were then checked on a period they were not
tuned on, on 6-hour candles, and with their settings nudged up and down:

| Test (median of 10 coins) | These signals | Just holding | Beat holding |
|---|---|---|---|
| Daily, ~4 years | +23% | −15% | 6 of 10 |
| Daily, most recent 2 years (falling market, not used for tuning) | −25% | −57% | 10 of 10 |
| Daily, first ~1.5 years (rising market) | +44% | +49% | 5 of 10 |
| 6-hour, most recent ~600 days | about −10% | −30% to −43% | 9–10 of 10 |

What that means in plain terms: the signals mostly help by **stepping aside in downtrends**. They lost about half as
much as holding when the market fell, and roughly kept up when it rose. They still lost money in falling markets,
they trail the strongest bull runs (BTC and SOL beat them over 4 years), and worst drops of 50%+ still happened.
Ten coins over four years is a small sample, and past results do not predict future results.

## Holdings
Type in what you hold on Coinbase, Exodus or any other wallet. The app shows the value,
profit or loss, and the current tip for each coin. This data stays in your browser's localStorage.

## Tests
    npm test   # indicators, Coinbase auth/parsing, AI request + endpoint (all offline, mocked APIs)

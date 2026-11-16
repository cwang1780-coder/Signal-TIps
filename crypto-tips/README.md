# Crypto Signal Tips

A browser app that pulls live market data from Coinbase's public API and turns standard
technical indicators into simple BUY / SELL / HOLD tips, each with the reasons behind it.

**Not financial advice.** The tips come from indicators that are often wrong.

## Run it
Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000   # then visit http://localhost:8000

You don't need an API key or account. The app only reads public market data.

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
    node test.js

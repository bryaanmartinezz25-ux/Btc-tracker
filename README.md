# BTC Pulse — Kalshi 15M Live Tracker

A mobile-friendly, read-only Bitcoin trading activity dashboard with **reversible UP / DOWN locks** for Kalshi's Bitcoin 15-minute markets. It has no ability to place orders and does not need your exchange credentials.

## IMPORTANT: the ZIP is the website source, not an iPhone application

The included files are meant to be **published together** on Netlify. Opening `index.html` from the iPhone Files app will not make the Netlify API endpoints available. The project has two small serverless functions in `netlify/functions/`. Once deployed, the site has a normal URL you can open in Safari and add to your iPhone Home Screen.

## What's inside

- **Kalshi** current Bitcoin 15-minute YES/UP and NO/DOWN quote midpoints in **percent** — sourced from Kalshi's public Trade API via a Netlify Function, refreshed about every 8 seconds. Midpoint values do **not** measure the percentage of people betting on each side; they are **market prices**, not calibrated winning probabilities.
- **Coinbase Exchange BTC/USD** individual trades from the public WebSocket **matches** channel; each execution reports exact BTC size and price. The BUY / SELL label describes the **initiating taker** and is inverted from the Coinbase maker `side`. Not one person's identity or total order; not all exchanges.
- **2-minute rolling executed volume pressure** as a BTC-weighted share. 30-second / 5-minute display options are included. The first complete two-minute sample requires 120 seconds of continuous feed after page load; reconnects reset the coverage.
- **Large-trade tape** with filter from 0.1 to 20 BTC, optional alert sound (after user interaction), exact executions and CSV export. A large executed trade is **not** necessarily one customer's whole order.
- **1-minute candlestick chart** with EMA9, EMA21, 15-minute separators, large-trade dots and fresh BTC spot price.
- **Window countdown**, optional reference price/strike and Coinbase-versus-strike comparison. **Settlement is based on CF Benchmarks BRTI, not Coinbase spot.**
- **Dynamic lock + flip warnings** based on fresh Kalshi odds, two-minute Coinbase taker pressure and short-term trade-price change; saved history of locks and reversals on the device.
- **Health checks and stale-data safeguards.** If either feed goes stale, the app stops verifying new signals. Prior locks can remain visible, marked UNVERIFIED.

## How the reversible lock works

These are **user-interface heuristics, not calibrated forecasts**, and their accuracy is not established. The rule is deliberately strict rather than forcing a direction. Quotes and Coinbase trades must both be fresh.

| Rule | Initial lock | Opposite-side reversal after lock |
|---|---:|---:|
| Kalshi midpoint toward candidate side | ≥60% | ≥53% |
| Coinbase taker volume toward candidate side, last 120 seconds | ≥57% | ≥63% |
| BTC trade-price movement toward candidate side, last 120 seconds | ≥0.020% | ≥0.035% |
| Complete continuous 2m sample | Yes | Yes |
| Minimum observed Coinbase trades | 25 | 25 |
| Minimum BTC trading volume in sample | 0.5 BTC | 0.5 BTC |
| Maximum Kalshi YES bid/ask spread | 8 percentage points | 8 percentage points |
| Persistence | 3 consecutive Kalshi polls, ≥12 seconds | 3 consecutive Kalshi polls, ≥12 seconds |

Countertrend warning: when the opposing BTC taker share reaches ≥57% and the 2-minute price moves ≥0.015% in that direction, show a **FLIP WARNING** even if the opposing Kalshi odds have not confirmed. The current lock remains in place until the strict reversal rule also passes. After each reversal there is a 20-second cooldown. There are no new locks or reversals in the final 15 seconds. By default, the first lock can occur **after the first 2 minutes of a market**, assuming there is a complete continuous two-minute sample. The user can select stricter **final-two-minutes-only** timing in the app. A new market ticker always starts a new lock state.

A **LOCKED** direction is *not permanent*; it can flip on stronger opposing evidence. It is also **not guaranteed** to predict settlement. Severe volatility can change the market faster than a confirmation process.

## Publish on Netlify (recommended: Git-connected deployment)

This app includes Netlify Functions, so **do not upload only the HTML file**. A static-only upload can display the page but leave Kalshi and chart feeds unavailable.

1. Create a GitHub repository and add **all the files and folders from the extracted project**. The repository root must contain `netlify.toml`, `package.json`, the `public/` folder, and `netlify/functions/`.
2. In [Netlify](https://app.netlify.com/), choose **Add new project → Import an existing project → GitHub** and select the repository. Authorize Netlify's access to the selected repository if prompted.
3. Deploy with the project configuration in `netlify.toml`:
   - **Base directory:** repository root
   - **Build command:** none required
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. When deployment finishes, open your `*.netlify.app` URL in Safari. Wait for the Kalshi and Coinbase feed badges to show live and for the complete two-minute sample. If any feed is unavailable, the site will say so and will not invent a signal.
5. On iPhone, in Safari tap **Share → Add to Home Screen**.

You can alternatively use Netlify CLI from a computer by running `npx netlify-cli deploy --prod` from the project root while signed into Netlify. Check your deployment's function logs if Kalshi requests are rejected or rate-limited.

**Netlify Drop:** The drag-and-drop product is easiest for static-only sites, but do not assume it deployed your serverless functions. For the full product, **use Git deployment** as above (or Netlify CLI) and verify the `/api/kalshi` and `/api/candles` URLs on the published site.

## Test locally (optional)

Install Node.js 20+ and run `npm test` in the project root. Tests validate API quote conversion, active-window filtering, BTC aggressor-side interpretation, pressure calculations, lock persistence, both flip directions, spike resistance, stale-data fail-safes and market reset. No external API calls are used by the tests.

For an end-to-end local preview with real API functions, use `npx netlify-cli dev` (requires Node.js and a live internet connection). Opening a file directly from Finder or Files will not run serverless functions.

## Network / reliability / privacy

- No authentication, trades, wallet access, browser microphone, or precise location is used.
- Public APIs: `https://external-api.kalshi.com/trade-api/v2/markets`, `https://api.exchange.coinbase.com/products/BTC-USD/candles`, and `wss://ws-feed.exchange.coinbase.com`.
- Netlify Functions return read-only market data. Browsers poll Kalshi every ~8 seconds and Coinbase candles every ~35 seconds. Live BTC executions appear as the exchange WebSocket delivers them. Actual timing depends on the provider, connectivity and hosting. **Polling can miss short-lived Kalshi quote moves; streaming can skip executions on network interruption.** Reconnects reset the sample.
- The trade history and lock history are held in your current browser only. The app can keep the most recent signal on refresh, but it will **not** treat a persisted old signal as a fresh market signal without verifying the market ticker.
- Price and contract data can be stale, unavailable, or rate-limited. The developer environment used for preparing this project could not reach public HTTPS APIs directly, so **production API connections are not yet end-to-end verified**. JavaScript unit tests and a rendered browser preview using **mock feed data** were completed.

## Files

```
netlify.toml
package.json
public/
    index.html
    styles.css
    logic.js
    app.js
    icon.svg
    manifest.webmanifest
netlify/
    functions/
        kalshi.js
        candles.js
tests/
    logic.test.js
    kalshi.test.js
```

**Disclaimer:** This monitor is for market research and education. Its signal thresholds are illustrative and have **not** been backtested or validated for predictive accuracy. Kalshi trading has financial risk, including total loss of stakes; automated-looking signals do not remove that risk.


## Diagnostics update (November 23, 2026)

The signal card now explicitly displays when the two-minute Coinbase sample is incomplete,
including a seconds-covered counter and the fact that the sample timer starts at the
webpage's Coinbase connection time, **not** when the Kalshi market opens.

Once the sample is ready, it explains whether the initial-lock timing mode, Kalshi
spread, activity threshold, or lack of agreement between Kalshi percentages, Coinbase
volume pressure, and price momentum is preventing a lock. A green live-feed indicator
means only that the feed is connected—not that a signal has been confirmed.

**Do not use this experimental signal to make real-money decisions.** It has not been
validated against historical Kalshi settlement outcomes and can remain WAITING for an
entire market. The website does not promise or force an UP/DOWN lock.

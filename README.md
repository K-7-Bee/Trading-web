# Disciplined Trading Assistant (prototype v1)

Paper trading only. One market (EUR/USD, daily), one strategy (v1.0 Close Breakout With Trend Filter), no real-money connection.

## Run it
- Quick look: open `index.html` in Chrome/Edge. It starts on clearly labelled demonstration data.
- Installable PWA (Windows and iPhone): host this folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages). On iPhone use Safari > Share > Add to Home Screen. On Windows use Chrome/Edge > Install app.
- Real data: Settings > "Fetch free EUR/USD rates" (ECB reference rates via Frankfurter, works when hosted) or Settings > Import CSV (Date and Close columns).
- Engine tests: `node test.js`.

## What is real and what is not
- Signals, sizing, risk limits, stop rules and statistics are ordinary code in `engine.js`. No AI is involved in v1.
- Demonstration data is synthetic. Results on it mean nothing.
- Daily data has one price per day, so intraday stop hits are not modelled. Overnight financing is a placeholder (0.3 pip/day).
- Not built yet: strategy-notes/book import, learning from history, trader profile, setup screenshots, logging your own trades, live execution.

## Validation plan: does this strategy have an edge?
1. Data. Get 10+ years of daily EUR/USD from a source you trust. Check for gaps and obvious errors.
2. Freeze the rules. Strategy v1.0 as written in the Rules tab. No tuning on this data. If you change any rule, it becomes v1.1 with its own track record.
3. Walk-forward test. Run the Test tab once. Read the out-of-sample (last 40%) and the year-by-year table, not only the total.
4. Pass criteria, set before looking: at least 30 out-of-sample trades; profit factor above 1.2 after costs; max drawdown you could live with at real size; no single year producing most of the profit.
5. Stress the costs. Double spread and slippage. If the edge disappears, it was not an edge.
6. Compare with buy-and-hold and with doing nothing. Drawdown and losing streaks get the same attention as return.
7. Forward paper test. Run live for at least 3 months and 30 trades on the latest data. Compare win rate, average R and drawdown with the backtest. Large gaps mean the backtest was flattering.
8. Only if 1-7 pass: consider a separate, opt-in phase with tiny real size. Never before.
Fail at any step: write down why, change one thing as a new version, and restart from step 3 on fresh data.
No result from this process promises future profit.

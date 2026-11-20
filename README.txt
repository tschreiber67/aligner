Portfolio Planner baseline

The planner currently:
- Builds monthly total-return series for SPY, QQQ, AGG, BND, TLT, IEF, SHY and a 3-month T-bill cash asset from frozen public data in data/s1 (gzip CSV plus manifest.json).
- ETF series come from daily closes plus cash distributions. DRIP on: each distribution buys shares at the ex-date close. DRIP off: it is paid to cash. A price-only index is kept for comparison.
- Extends each ETF back in time with a long-history proxy, spliced at the fund's first month: SPY from Shiller S&P data (monthly price plus Dividend/12, from 1871), IEF from a 10-year par bond repriced from the Fed H.15 10-year yield (from 1953), AGG/BND, SHY and TLT from 5-, 2- and 20-year par bonds on the Treasury curve (from 1990/1993). QQQ has no proxy (history from 2016-12). Cash is the previous month-end 3M yield / 12.
- Bond proxies use par-bond math: buy at par at last month's yield, reprice one month later at the new yield with maturity minus one month. Unchanged yield gives exactly coupon / 12.
- Reports splice overlap stats per ETF (months of overlap, correlation, annualised tracking difference, tracking error) so the reliability of each proxy is visible.
- Simulates a portfolio with every variable as an input: assets and weights, start value, monthly contribution, DRIP on/off, expense ratio per asset, rebalance frequency (none / annual / quarterly) and month, cash rule, nominal or inflation-adjusted (CPI-U).
- Cash rule: at the start and at every rebalance the cash sleeve is reset to the cash target (default 10% of the portfolio); the other assets share the rest by their weights. Cash earns the 3M bill (or 0% if set to NONE).
- Outputs the monthly value path, contributions, cash flows, time-weighted CAGR, money-weighted IRR, volatility, and max drawdown with peak, trough and recovery months.
- Lookback: runs the portfolio over every historical start month with a full horizon T (overlapping rolling windows, step one month) and reports min / p10 / median / p90 / max of final value, CAGR and worst drawdown, with the depth used (first and last start month, number of windows, which asset limits the depth).
- Month-end alignment uses the last trading day of each month. A blank value is forward-filled only within 7 calendar days; longer gaps are left empty and reported. An unfinished final month is dropped.
- No network calls, no accounts, no personal data. Same inputs give the same outputs on every OS.

REQUIREMENTS
- Node.js 22 or newer. No npm dependencies, nothing to install.

RUN (Windows PowerShell or macOS terminal, from the repo root)
  npm start                 web UI at http://127.0.0.1:8113
  npm run data:verify       checks every data/s<n>/ pack against its manifest (prints OK/FAIL per file, exits 1 on a mismatch)

TESTS
  npm test
  Uses node:test and node:assert (built in). Expected: 67 tests, 67 pass, 0 fail, no warnings.

API (local use, no auth)
  GET  /                    planner page (form, results table, SVG value chart, lookback table)
  GET  /api/assets          assets, date ranges, proxy and splice stats, data packs found
  POST /api/simulate        body {"assets":[{"id":"SPY","weight":0.6},{"id":"IEF","weight":0.4}],"start":"2000-01","months":240,
                                  "startValue":10000,"monthlyContribution":0,"drip":true,"rebalance":{"frequency":"annual","month":12},
                                  "cash":{"target":0.1,"asset":"CASH"},"inflationAdjusted":false}
  POST /api/lookback        same portfolio fields plus "horizonMonths" (and optional "from" / "to" start months)
  GET  /api/health
  Bad input returns 400 {"error": ..., "field": ...} naming the field. Weights must sum to 1. Body limit 1 MB.

DATA
  data/s1/manifest.json lists every file with source, url, license note, columns, rows, first/last date, bytes and sha256.
  Files: etf/<T>.daily.csv.gz and etf/<T>.distributions.csv.gz (7 ETFs, prices 2016-11-09 to 2026-11-09), nav/SPY.nav.daily.csv.gz,
  rates/ust-par-yield-curve.daily.csv.gz (1990 on), long/shiller-sp500.monthly.csv.gz (1871 on), long/ust10y.monthly.csv.gz (1953 on),
  macro/cpi-u-nsa.monthly.csv.gz (1913 on).
  The loader discovers every data/s<n>/ folder that has a manifest.json and verifies it before use. Later data drops go in their own data/s<n>/ folder.

LAYOUT
  src/data/months.js         month keys and UTC date math
  src/data/csv.js            CSV and gzip CSV parsing
  src/data/manifest.js       pack discovery, manifest loading, sha256 / row / column verification
  src/data/calendar.js       month-end alignment, gap and fill reporting
  src/returns/totalReturn.js DRIP / no-DRIP / price-only fund indexes and monthly returns
  src/returns/bond.js        par-bond pricing and bond / cash returns from yields
  src/returns/proxies.js     Shiller equity proxy, CPI inflation, real conversion
  src/returns/splice.js      proxy-to-fund splice and overlap statistics
  src/returns/universe.js    builds all asset series from data/s1
  src/portfolio/simulate.js  portfolio simulator (weights, contributions, DRIP, fees, rebalance, cash rule)
  src/portfolio/metrics.js   drawdown, volatility, IRR, percentiles
  src/lookback/lookback.js   rolling-window lookback and outcome distributions
  src/api/validate.js        request validation (400 with field name)
  src/api/app.js             node:http request handler
  src/server.js              npm start entry (port 8113)
  scripts/verify-data.js     npm run data:verify entry
  public/                    planner page (index.html, app.js)
  tests/                     node:test suite (*.test.js) and fixtures.js

LIMITATIONS (current)
- No probability of reaching an objective (target value or target real CAGR within a horizon), no hit-time profile, no reliability band for overlapping windows.
- No Monte Carlo forecast and no side-by-side comparison of two portfolios.
- Proxies are approximations: Shiller prices are monthly averages and H.15 yields are monthly averages, so their correlation with month-end fund returns is lower (see splice stats).
- Taxes, bid/ask spreads and intra-month cash flows are not modelled. Contributions are added at month end.

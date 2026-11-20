[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Lolod17/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Lolod17/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

An entry for make.fun's `token-radar-01` bounty. It reads a sealed DefiLlama snapshot and ranks protocols that record no token by what their launch would be worth if their record stayed as it is. Each protocol gets a farm plan with a cost and a time for every step.

## What it does

- **Board.** Ranks 177 protocols on the sealed snapshot: all 40 watchlist protocols plus 137 below the $50M floor that record no token and pass a product-pattern test. Sort any column, search, and filter by category, chain, minimum TVL, watchlist and 7-day growth. The row count updates as you filter and says which filters are active.
- **Value model** (`dashboard/model.js`): `implied value = TVL × category multiple × growth × maturity`.
  - **Multiple.** The median market-cap/TVL ratio of the snapshot's tokenized protocols in the same category, when at least 5 of them trade a token; otherwise the median over all 128 tokenized protocols. A category's P25 and P75 multiples produce the interval shown on every row.
  - **Growth.** `1 + clamp(change_7d, -60, 120)/100 × 0.35`.
  - **Maturity.** `0.55 + min(age_days, 1095)/1095 × 0.45`. When `listed_at` is null the age is assumed to be 365 days and the row labels it.
  - No protocol name is special-cased. `main.ts` writes `data.js` from the same `buildRadar` the page renders, so `board.json` and every screenshot come from one object.
- **Validation.** For each of the 128 tokenized protocols, the multiple is refit with that protocol removed and its market cap predicted from its TVL. The median miss is ×4.76 (a single global multiple misses by ×5.07); 23.4% land within 2× and the held-out P25–P75 band covers 39.8%. The Method tab reports these numbers and the width of the interval instead of inventing a walk-forward or Brier score the one-day snapshot cannot support.
- **Separation.** 416 protocols record a token, 128 of them with a positive market cap and TVL (the fitting sample); 342 record no token. The board holds the candidates; 165 tokenless protocols are set aside with a reason: bridge/staking/CEX/stablecoin-wrapper categories, version markers, wrapped or staked names, exchange products, and above-floor protocols the watchlist left out as child products. Zero protocols had missing TVL.
- **Detail view.** Every row opens a dossier: model inputs, the multiple and the peers behind it, the P25–P75 interval, assumptions for missing fields, and the farm plan with a cost and a time on every step.
- **Tabs.** Board, the 128 tokenized comparables, the 165 set-aside protocols with their reasons, and the full Method & validation page.

The implied values are this dashboard's own estimate. They don't forecast whether or when any token launches. The farm plans' gas costs, category minimums and $1,000 position size are stated assumptions, not snapshot data.

## Run it locally

Needs Node.js 22.18 or later. Nothing to install.

```sh
MAKEFUN_OUTPUT_DIR=/tmp/tokenradar-out node main.ts --input path/to/input/snapshot.json
cd /tmp/tokenradar-out && python3 -m http.server 8000
# open http://localhost:8000/dashboard/
```

`main.ts` writes `board.json`, `data.js` (the whole radar the page renders), `dashboard/`, `screenshots/` and `dossier.json` to the output directory. The page loads `model.js` as an ES module, so serve the output over HTTP instead of opening it from `file://`.

## License

MIT, see `LICENSE`.

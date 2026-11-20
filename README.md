[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Lolod17/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Lolod17/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

An entry for make.fun's `token-radar-01` bounty. It reads a sealed DefiLlama snapshot and ranks protocols that record no token by what their launch would be worth if their record stayed as it is. Each protocol gets a farm plan with a cost and a time for every step.

## What it does

- **Board.** Ranks 177 protocols: all 40 watchlist protocols plus 137 below the $50M floor that record no token and pass a product-pattern test. Sort any column, search, and filter by category, chain, minimum TVL, watchlist and 7-day growth. The row count updates as you filter and says which filters are active.
- **Value model** (`dashboard/model.js`): the tokenized protocols give a log-log comps curve, `mcap ≈ 10^a · TVL^b`, fitted by OLS on log10 mcap against log10 TVL. The point estimate is `curve(TVL) × growth × maturity`; the interval is that value multiplied by the p25/p75 of actual mcap ÷ predicted implied from the leave-one-out refits.
  - **Curve.** Fitted on the 128 protocols with positive mcap and TVL. Seven ratios outside [0.005, 50] are flagged and excluded from the held-out band and scoring sample (121 of 128). The fitted constants are computed every run: a ≈ 3.025, b ≈ 0.522.
  - **Growth.** `1 + clamp(change_7d, -60, 120)/100 × 0.35`; **maturity** `0.55 + min(age_days, 1095)/1095 × 0.45`. `listed_at` null → 365 days, labelled as assumed.
  - **Economics.** Drop / $1k = `implied × 7% × $1,000 ÷ TVL`; net if launch subtracts plan gas and a $2 fee; net $/h divides that by the hold.
- **Validation.** Leave-one-out over the clean set: the curve misses by ×3.17, the global median multiple by ×5.07 and the house model by ×5.11; 33.1% within 2×, 47.9% within 3×, Spearman 0.518, band coverage 48.8%. A walk-forward fit on the older 54 dated protocols predicts the newer 36 with a ×3.04 median miss. The Method tab lists the seven flagged ratios and keeps the category-median table as a cross-check.
- **Separation.** 416 protocols record a token, 128 of them with a positive market cap and TVL; 342 record no token. The board holds 177 candidates; 165 tokenless protocols are set aside with a reason: wrapper categories, version markers, wrapped/staked names, exchange products, and above-floor child products. Zero protocols had missing TVL.
- **Detail view.** Every row opens a dossier: curve inputs, the held-out interval, the out-of-sample card, assumptions for missing fields, drop / $1k, net if launch, net $/h, and the farm plan with a cost and a time on every step.
- **Tabs.** Board (with the right-hand out-of-sample card and log-log chart), the 128 tokenized comparables, the 165 set-aside protocols, and the full Method & validation page.

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

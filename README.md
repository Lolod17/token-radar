[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Lolod17/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Lolod17/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

An entry for make.fun's `token-radar-01` bounty. It reads a sealed DefiLlama snapshot and ranks protocols that record no token by what their launch would be worth if their record stayed as it is. Each protocol gets a farm plan with a cost and a time for every step.

## What it does

- **Board.** Ranks 178 protocols: all 40 on the snapshot's watchlist, plus 138 below the $50M floor that record no token and pass the watchlist's product tests. You can sort by any column, search, and filter by scope (all, watchlist, below floor), category, chain, and 7-day growth.
- **Value model** (`dashboard/model.js`): `implied value = TVL × category multiple × growth factor × tokenless-run factor`.
  - **Category multiple.** The median market-cap/TVL ratio of the snapshot's protocols in the same category that already trade a token, blended in log space toward the median over all 128 of them. Thin categories lean on the overall median.
  - **Growth factor.** `1 + 1.5 × change_7d / 100`, with the 7-day change capped at ±20%.
  - **Tokenless-run factor.** Rises from 0.75 for a new listing to 1.0 after two years listed.
  - No protocol name is special-cased. `main.ts` and the page both use the same module, so `board.json` matches what the page shows.
- **Detail view.** Shows the formula with the protocol's own numbers, the live-token peers behind its multiple, and any fields the snapshot lacks (marked as missing, never filled in). It also shows the farm plan.
- **Live tokens and Set aside tabs.** These list the protocols that already trade a token (the comparables) and the tokenless wrapped, staked, bridged or child products left off the board, each with the reason.

The implied values are this dashboard's own estimate. They don't forecast whether or when any token launches. The farm plans' gas costs and $1,000 position size are stated assumptions, not snapshot data.

## Run it locally

Needs Node.js 22.18 or later. Nothing to install.

```sh
MAKEFUN_OUTPUT_DIR=/tmp/tokenradar-out node main.ts --input path/to/input/snapshot.json
cd /tmp/tokenradar-out && python3 -m http.server 8000
# open http://localhost:8000/dashboard/
```

`main.ts` writes `board.json`, `data.js` (the snapshot for the page), `dashboard/`, `screenshots/` and `dossier.json` to the output directory. The page loads `model.js` as an ES module, so serve it over HTTP instead of opening it from `file://`.

## License

MIT, see `LICENSE`.

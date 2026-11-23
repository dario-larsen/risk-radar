# Risk Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dario-larsen/risk-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dario-larsen/risk-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks pre-token protocols by **risk-adjusted implied value**, not by size alone. Most radars sort by TVL; this one prices each protocol the way a buyer would — what the market already pays for live tokens in the same category — then cuts that value for the protocol's own risks: wild 7-day moves, a short track record, chain concentration, thin TVL, and noisy comparables. Rank 1 is the best risk-adjusted claim on the board, and every row shows its risk score, its band, and the five parts that built it.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node.js 22.18 or later. No dependencies, no network: `main.ts` reads the sealed snapshot, scores the board, writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into the output directory, and `dossier.json` with the vendored make.fun library.

## The model

```
raw           = TVL × median(mcap / TVL of live tokens in the category)
                    × growth (7-day TVL change, clamped −60%…+120%, half-weighted)
                    × maturity (0.60 new → 1.00 after 3 years)
risk-adjusted = raw × (1 − 0.55 × risk / 100)
```

Risk is five parts out of 100: 7-day move (25), track record (20), chain concentration (20), thin TVL (15), noisy comparables (20). The board covers the whole 40-protocol watchlist plus the 160 largest pre-token protocols below the floor, 200 rows in all. Every row carries a six-step farm plan sized to its risk band — a LOW-band protocol gets a $250 position, an EXTREME-band one $40 — with costs and times on every step.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board (search, category, chain, risk band, watchlist-only), a detail view for every protocol with its value derivation and risk breakdown, an "Already trading" view of the live tokens whose market caps set the multiples, and a "How it scores" view that publishes the category multiples the board used.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

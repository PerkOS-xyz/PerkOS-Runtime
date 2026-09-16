---
title: "Desk method: how to analyze a tokenized stock"
kind: app
updated: "2026-09-16T12:00:00.000Z"
source: PerkOS
sources: https://docs.chain.link/data-feeds, https://docs.base.org/base-chain/tokenized-stocks
---

# Desk method: how to analyze a tokenized stock

How the desk analyzes a tokenized stock, in order:
1. Underlying driver: what moved the stock in the last day and week (earnings, guidance, product news, macro rates, sector rotation) and what the next known catalyst is (earnings date, product event, index rebalance). A one-month horizon is driven by catalysts and valuation, not by intraday noise.
2. Price context: last price, 24h move and range, distance from the 30-day range, and the premium or discount of the pool price versus the Chainlink reference. Off hours the reference is frozen; say so and compare to the last close.
3. Onchain layer: best venue and pool depth for the intended size, venue spread, Bankr second quote, recent swap count as a liquidity health check.
4. Position rules: never exceed 0.5 percent of pool depth per order without splitting; prefer limit-like behaviour (small clips) when the spread is wide; do not average down into an issuer pause or a frozen feed with a large gap.
5. Decision: GO or BLOCK with the single strongest reason, then the second reason. A GO must name the size, the venue and the exit condition (take profit level, stop, or time). A BLOCK must name what would flip it.

For "what should I buy for a one-month horizon" questions: rank candidates by (a) a clear near-term catalyst, (b) a reasonable entry versus the recent range, (c) enough pool depth for the size, then present the top two with the reason for each and one you would avoid and why. Write the analysis as a dated document so the desk can review the call a month later.

For a direct order ("buy 5 dollars of Amazon"): the analysis is not needed. Give one line of pros and one of cons for doing it now, check the risk gate, draft the order and record it.

Citations and review, added 2026-09-16:
- Every claim in a Scout or Auditor reply must point to the fact it rests on, tagged [F<n>] for a market fact line or [N] for the news. A number without a tag is a signal to review.
- The valuation line per asset (P/E, beta, market cap, next earnings date, dividend yield, analyst consensus) comes from a daily profile; use it to judge whether the entry is reasonable, and treat an earnings date inside the horizon as the main catalyst and the main risk.
- The 30-day reference range (Chainlink rounds) tells where the price sits in its recent path: near the low with a catalyst ahead is a setup; near the high after a run is not.
- Every dated outlook is reviewed one month later: the desk compares the prices of that day with the current ones, measures the picks against the market average and writes the result into the same note. A desk that does not review its calls has no track record.


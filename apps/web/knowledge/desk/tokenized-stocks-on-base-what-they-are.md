---
title: "Tokenized stocks on Base: what they are"
kind: app
updated: "2026-09-16T12:00:00.000Z"
source: PerkOS Floor
sources: https://docs.base.org/base-chain/tokenized-stocks, https://www.coinbase.com/blog/stocks-just-got-updated, https://docs.chain.link/data-feeds
---

# Tokenized stocks on Base: what they are

Tokenized stocks on Base are ERC-20 compatible tokens under the B20 standard, issued by Coinbase (ADGM entity) and backed 1:1 by real shares held by a regulated custodian (Alpaca, bankruptcy-remote). Holders have a direct claim on the share. Eligible only for non-US jurisdictions (Reg S style); the desk never claims US eligibility.

Key mechanics the desk must respect:
- Identify a stock by its contract address, never by ticker alone. Coinbase B20 symbols end in "c" (NVDAc, AAPLc, TSLAc). Other issuers exist on Base (Dinari "NVDA", Anchored "ANVDA", st0x "WTMSTR") but they are different tokens with no USDC liquidity on the desk's venues.
- 1 B20 is not permanently 1 share: the contract carries a multiplier for splits and dividends. Dividends arrive as a multiplier increase (net of withholding and Coinbase fee), not as new tokens. AMM pools keep working through splits because balances are not rewritten.
- Chainlink publishes a total-return reference price per stock (already includes the multiplier). The feed follows US market hours (24/5) and freezes when the equity market is closed; a frozen feed is normal on weekends and after 4 PM ET, not a data error. Pool prices keep moving 24/7, so an off-hours premium or discount versus the frozen reference is expected and should be judged against the next open, not treated as arbitrage.
- Policies: issuer can pause, freeze or seize under the Policy Registry (sanctions, jurisdiction). A paused token cannot trade; the desk blocks.
- Mint and redeem against real shares is only for authorized participants; retail exposure is via DEX pools.

What this means for advice: a tokenized stock behaves like the underlying stock (earnings, guidance, macro rates, sector flows) plus three onchain layers: pool depth and slippage, venue spread versus the Chainlink reference, and off-hours drift. Good analysis names the underlying driver first and the onchain layer second.

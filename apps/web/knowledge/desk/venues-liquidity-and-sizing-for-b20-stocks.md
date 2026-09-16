---
title: "Venues, liquidity and sizing for B20 stocks"
kind: app
updated: "2026-09-16T12:00:00.000Z"
source: PerkOS
sources: https://github.com/aerodrome-finance/slipstream, https://basescan.org/address/0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef, https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
---

# Venues, liquidity and sizing for B20 stocks

Where B20 tokenized stocks trade on Base (verified onchain 2026-09-16):
- Aerodrome Slipstream (concentrated liquidity, latest "Gauges V3" deployment) is the primary spot venue for Coinbase B20 stocks. USDC held in the main pools: GOOGLc about 1.12M, METAc 851k, NVDAc 757k, AAPLc 739k, AMZNc 399k, MSTRc 390k, SNDKc 384k, MSFTc 376k, SPCXc 357k, TSLAc 331k. Fee tier 0.05 percent, tick spacing 10.
- Uniswap V3 on Base is secondary: NVDAc/USDC 0.3 percent holds about 12k USDC, AAPLc about 42k, GOOGLc about 41k; TSLAc, MSTRc and SNDKc have no meaningful Uniswap USDC pool. Uniswap is still a valid venue when its price is better for a small size.
- The desk quotes both venues for every order and takes the best price; the human signs the swap with their own wallet. Bankr gives an independent second quote (read-only, never executes). Chainlink gives the reference price for the underlying share.
- Catalogue volume figures (millions per day per stock) come from all venues including Coinbase itself; onchain DEX volume is far smaller (NVDAc about 19k per day on Uniswap). Do not confuse the two.
- Lending: Morpho on Base lists NVDAc, AAPLc, METAc and GOOGLc as collateral but markets are tiny (about 1k USD). Not a desk product.

Sizing rules of thumb for this desk: keep an order under 0.5 percent of the pool's USDC depth for negligible price impact; between 0.5 and 2 percent expect visible slippage; above 2 percent split the order or wait. A spread above 1.5 percent between venues or versus the Chainlink reference during market hours is a block signal; off hours, compare against the last close and the expected open instead.

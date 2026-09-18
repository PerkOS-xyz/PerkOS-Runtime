# Uniswap developer feedback

Feedback from building PerkOS Floor on the Uniswap stack during Runtime NYC, September 2026.
Project: a Mac desktop app where a desk of four agents works tokenized stocks on Base. The agents
draft; the person holds to approve and signs with their own wallet.

## What we integrated

| Piece | Where | What it does |
|---|---|---|
| Quoter V2 (`0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`) | `apps/web/app/lib/uniswap.ts` | Quotes tokenized stock pairs on Base before a draft is shown |
| SwapRouter02 (`0x2626664c2603336E57B271c5C0b26F421741e481`) | `apps/web/app/lib/uniswap.ts`, `draftTrade()` | Builds the swap the person signs |
| Universal Router (`0x6fF5693b99212Da76ad316178A184AB56D299b43`) | `apps/web/app/lib/launchBuy.ts` | One transaction: wrap ETH, a V3 leg to the pair, then the V4 leg into a launched token |
| V4 PoolManager (`0x498581fF718922c3f8e6A244956aF099B2652b2b`) and V4 Quoter | `apps/web/app/lib/launchBuy.ts`, `apps/web/app/lib/launchMarket.ts` | Reads the pool key from the `Initialize` event of the deploy transaction and prices the token |
| Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) | `apps/web/app/lib/launchBuy.ts` | Approval leg before the router spends |

## What worked well

**The Universal Router made a two hop trade one signature.** A person buying a token that was
launched minutes earlier needs ETH to reach a V4 pool whose only liquidity is against a tokenized
stock. Wrapping, a V3 leg and a V4 leg compose into a single transaction, so the person approves
once instead of three times. For a desktop app where every approval travels to a phone over
WalletConnect and takes 15 to 40 seconds, that difference is the product.

**Reading the pool key from the `Initialize` event is reliable.** A token launched through a third
party lands in a V4 pool we did not create. Recovering the exact `PoolKey` from the deploy
transaction, rather than reconstructing it from assumptions about fee and tick spacing, is what let
the desk trade tokens it had just created. Dynamic fee pools (`0x800000`) would have been
impossible to guess.

**`eth_simulateV1` with asset changes closed the last gap.** Every draft is simulated before it is
offered, and the simulated output is what the person is shown. "Success" alone is not enough: a
swap can succeed and deliver almost nothing.

## What cost us time

**Fee tier discovery is on the integrator.** Our first implementation quoted a single fee tier and
took whatever came back. A route through a thin 0.3% pool cost a user most of a 5 dollar buy while
a 1% pool sat there with real liquidity. We now walk every tier (`FEE_TIERS` in
`apps/web/app/lib/launchBuy.ts`) both directly and through USDC, keep the best output, and refuse
the draft when price impact passes 12%. A "best route across tiers" helper in the docs, or a
quoter that returns the best tier for a pair, would have saved a day and a user's money.

**Intermediate tokens can be stranded in the router.** A multi hop route that runs dry leaves the
intermediate balance in the Universal Router, where anyone can sweep it. We learned this by losing
it. Sweeping every intermediate token, not just the input and the output, should be louder in the
docs than it is.

**V4 documentation assumes you are the pool creator.** Most examples start from
`initialize`. The integrator arriving at an existing pool created by someone else, with a hook and
a dynamic fee, has to assemble the actions (`SWAP_EXACT_IN_SINGLE`, `SETTLE`, `TAKE`) from
reference material spread across the periphery repository. A worked example of "trade an existing
V4 pool you did not deploy, from a router call" would be the single most useful addition.

## What we would ask for next

- A quoter endpoint that returns the best fee tier for a pair in one call.
- Guidance on sweeping intermediate tokens in composed routes, in the Universal Router docs.
- A V4 example written from the taker's point of view rather than the pool creator's.

## Contact

PerkOS, https://github.com/PerkOS-xyz/PerkOS-Runtime

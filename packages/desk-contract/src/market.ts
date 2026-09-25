/**
 * What a desk can trade, and what it is worth.
 *
 * This is the first half of the contract a desk fulfils. It is written as a
 * schema and not only as a type because the two sides are different repos: a
 * desk answers over HTTP, and Runtime has to be able to refuse an answer that
 * does not make sense instead of drawing it.
 *
 * The honesty rule of this file is `tradeable`. A desk that cannot tell yet
 * whether an order can be routed says `null`, and the screen shows that as
 * unknown. A guessed `true` ends up inside a risk verdict, which is the one
 * place a guess must never reach.
 */

import { z } from "zod";

export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an address is 0x and 40 hex characters");
export const TickerSchema = z.string().trim().min(1).max(16);

export const DeskAssetSchema = z
  .object({
    ticker: TickerSchema,
    name: z.string().trim().min(1).max(120),
    address: AddressSchema,
    decimals: z.number().int().min(0).max(36),
    /** Reference price in the desk's quote asset, null when the source is down. */
    priceUsd: z.number().positive().nullable(),
    /** When that price was observed. */
    priceAt: z.string().datetime().nullable(),
    change24hPct: z.number().nullable(),
    volume24hUsd: z.number().nonnegative().nullable(),
    /** null means the desk does not know yet, and the screen says so. */
    tradeable: z.boolean().nullable(),
    logoUrl: z.string().url().nullable(),
  })
  .strict();

export const DeskMarketSchema = z
  .object({
    /** The chain by its own name: `base`, `robinhood`. */
    chain: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    chainId: z.number().int().positive(),
    /** What an order is priced in: USDC on Base, USDG on Robinhood Chain. */
    quoteSymbol: z.string().trim().min(1).max(16),
    assets: z.array(DeskAssetSchema).min(1, "a market with no assets is not a market"),
    observedAt: z.string().datetime(),
  })
  .strict();

export type DeskAsset = z.infer<typeof DeskAssetSchema>;
export type DeskMarket = z.infer<typeof DeskMarketSchema>;

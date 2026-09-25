/**
 * What a desk holds in a person's name, and the order it would write.
 *
 * A desk never signs and never holds a key: it returns an order that is ready
 * and unsigned, and the person's wallet decides. That is why a draft carries
 * the transactions as data and a minimum output: the two things that let
 * someone check what they are about to sign.
 *
 * A refusal is part of the contract too. A desk that will not draft says why
 * with a code the screen can act on, instead of returning an empty draft.
 */

import { z } from "zod";

import { AddressSchema, TickerSchema } from "./market.ts";

export const DeskPositionSchema = z
  .object({
    ticker: TickerSchema,
    address: AddressSchema,
    /** Human amount, as a string, so no precision is lost on the way. */
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    valueUsd: z.number().nonnegative().nullable(),
  })
  .strict();

export const DeskTxSchema = z
  .object({
    /** What this step is for, in one word the screen shows: approve, swap. */
    label: z.string().trim().min(1).max(24),
    to: AddressSchema,
    data: z.string().regex(/^0x[0-9a-fA-F]*$/),
    /** Wei, as a string. Absent means zero. */
    value: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
    chainId: z.number().int().positive(),
  })
  .strict();

export const DeskDraftSchema = z
  .object({
    side: z.enum(["buy", "sell"]),
    ticker: TickerSchema,
    /** What the person pays, in the quote asset, as a human string. */
    amountIn: z.string().regex(/^\d+(\.\d+)?$/),
    quoteSymbol: z.string().trim().min(1).max(16),
    /** What they get if nothing moves, and the least they accept. */
    quoteOut: z.string().regex(/^\d+(\.\d+)?$/),
    minOut: z.string().regex(/^\d+(\.\d+)?$/),
    /** Where it would trade, named for the record: "Uniswap V3", "Aerodrome". */
    venue: z.string().trim().min(1).max(64),
    /** Unsigned, in the order they must be sent. */
    txs: z.array(DeskTxSchema).min(1),
    quotedAt: z.string().datetime(),
  })
  .strict();

/** A desk that will not draft says why, and the screen can act on the code. */
export const DeskRefusalSchema = z
  .object({
    refused: z.literal(true),
    code: z.enum(["unknown_asset", "no_route", "thin_liquidity", "amount", "no_balance", "unavailable"]),
    /** One sentence for the person, not a stack trace. */
    detail: z.string().trim().min(1).max(280),
  })
  .strict();

export const DeskQuoteReplySchema = z.union([DeskDraftSchema, DeskRefusalSchema]);

export type DeskPosition = z.infer<typeof DeskPositionSchema>;
export type DeskTx = z.infer<typeof DeskTxSchema>;
export type DeskDraft = z.infer<typeof DeskDraftSchema>;
export type DeskRefusal = z.infer<typeof DeskRefusalSchema>;
export type DeskQuoteReply = z.infer<typeof DeskQuoteReplySchema>;

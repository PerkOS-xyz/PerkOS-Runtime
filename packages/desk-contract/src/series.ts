/**
 * The price history a desk turn cites as a fact.
 *
 * A desk answers with the points it really has and names where they came
 * from. The source travels with the series because an agent that cites a range
 * has to be able to say who measured it, and because two desks on two chains
 * will never have the same source.
 */

import { z } from "zod";

import { TickerSchema } from "./market.js";

export const DeskSeriesPointSchema = z
  .object({ at: z.string().datetime(), value: z.number().positive() })
  .strict();

export const DeskSeriesSchema = z
  .object({
    ticker: TickerSchema,
    priceUsd: z.number().positive().nullable(),
    change24hPct: z.number().nullable(),
    points: z.array(DeskSeriesPointSchema),
    /** Who measured it: `chainlink-base`, `uniswap-rwa-1d`. */
    source: z.string().trim().min(1).max(64),
    /** Days actually covered, when the source spans more than a day. */
    days: z.number().int().positive().optional(),
    low: z.number().positive().optional(),
    high: z.number().positive().optional(),
    changePct: z.number().optional(),
    /** One sentence a turn can cite as it is. */
    line: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export type DeskSeriesPoint = z.infer<typeof DeskSeriesPointSchema>;
export type DeskSeries = z.infer<typeof DeskSeriesSchema>;

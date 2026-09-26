/**
 * The buy a desk is sending, kept above the Trader sheet (see runStore): its
 * outcome waits until the person has seen it, and the sheet shows it again
 * when it opens. It is kept in the window's sessionStorage too, so a reload
 * brings it back instead of the form.
 */

import { createRunStore, windowSession, type Run } from "./runStore";
import { isBuyOutcome, UNCONFIRMED, type BuyOutcome } from "./trade";

/** What the person approved, for the receipt. */
export interface BuySummary {
  ticker: string;
  /** Whole USDG, as sent. */
  amountUsdg: string;
  tokenOut: { symbol: string; address: string; decimals: number };
  quotedAmountOut: string;
  minAmountOut: string;
  maxSlippageBps: number;
  /** How much of the stock the wallet held when the owner approved, to tell when a buy that was not confirmed arrived. */
  heldBefore: string;
}

export type BuyRun = Run<BuySummary, BuyOutcome>;

const uint = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

/** Whether a summary kept across a reload is one the receipt can draw. */
export function isBuySummary(s: unknown): s is BuySummary {
  if (typeof s !== "object" || s === null) return false;
  const b = s as Record<string, unknown>;
  const t = b.tokenOut as Record<string, unknown> | null | undefined;
  return (
    typeof b.ticker === "string" &&
    typeof b.amountUsdg === "string" &&
    typeof t === "object" &&
    t !== null &&
    typeof t.symbol === "string" &&
    typeof t.address === "string" &&
    typeof t.decimals === "number" &&
    Number.isInteger(t.decimals) &&
    t.decimals >= 0 &&
    uint(b.quotedAmountOut) &&
    uint(b.minAmountOut) &&
    typeof b.maxSlippageBps === "number" &&
    uint(b.heldBefore)
  );
}

/** The key a desk's buy is kept under in sessionStorage. */
export const buyKey = (module: string): string => `runtime.trader.buy:${module}`;

const buys = createRunStore<BuySummary, BuyOutcome>({ kind: "unconfirmed", message: UNCONFIRMED }, undefined, {
  storage: windowSession,
  key: buyKey,
  isSummary: isBuySummary,
  isOutcome: isBuyOutcome,
});

/** The desk's buy in flight, or the last one whose outcome the person has not dismissed. */
export const buyRun = (module: string): BuyRun | null => buys.get(module);
export const subscribeBuys = (listener: () => void): (() => void) => buys.subscribe(listener);
/** Starts a buy unless one is already in flight for this desk. The run belongs to the desk, not to the sheet that started it. */
export const startBuy = (module: string, summary: BuySummary, send: () => Promise<BuyOutcome>): BuyRun | null => buys.start(module, summary, send);
/** The person has seen the outcome. A buy still in flight stays. */
export const dismissBuy = (module: string): void => buys.dismiss(module);

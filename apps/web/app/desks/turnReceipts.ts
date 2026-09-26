/**
 * The receipts of buys that followed a desk turn's plan. Each one goes to its
 * turn's record, where History and Memory read it, and stays here for this
 * window, so the Auditor's card shows it the moment PerkOS answers, whether
 * the Trader is still open or not.
 */

import type { TurnReceipt } from "../lib/turnRecord";
import { sendBuy, turnReceiptOf, type BuyOrder, type BuyOutcome } from "./trade";

const receipts = new Map<string, TurnReceipt>();
const listeners = new Set<() => void>();

/** The receipt this window keeps for a turn, or null. */
export const turnReceipt = (turnId: string | null): TurnReceipt | null => (turnId ? (receipts.get(turnId) ?? null) : null);

export function subscribeTurnReceipts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Http = typeof fetch;
const browserFetch: Http = (input, init) => fetch(input, init);

/**
 * Keeps the receipt of a buy that followed a turn's plan: here at once, and
 * with the turn's record. False when there was no swap to keep, or when the
 * record did not take it. The buy itself is never touched.
 */
export async function keepTurnReceipt(turnId: string, outcome: BuyOutcome, order: { ticker: string; amountUsdg: string }, http: Http = browserFetch): Promise<boolean> {
  const receipt = turnReceiptOf(outcome, order);
  if (!receipt) return false;
  receipts.set(turnId, receipt);
  for (const listener of listeners) listener();
  try {
    const res = await http(`/api/desks/turns?id=${encodeURIComponent(turnId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receipt }),
    });
    if (!res.ok) console.warn(`The receipt was not kept with the desk turn (${res.status}).`);
    return res.ok;
  } catch (err) {
    console.warn(`The receipt was not kept with the desk turn: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Sends one approved buy, as sendBuy does, and never throws either. A buy
 * that follows a desk turn's plan leaves its receipt with that turn; the
 * outcome does not wait for it.
 */
export async function sendBuyForTurn(order: BuyOrder, http: Http = browserFetch): Promise<BuyOutcome> {
  const outcome = await sendBuy(order, http);
  if (order.turnId) void keepTurnReceipt(order.turnId, outcome, order, http);
  return outcome;
}

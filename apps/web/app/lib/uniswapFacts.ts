/**
 * What Uniswap would pay out right now at the turn's size, as facts the team
 * cites like any other.
 *
 * The desk asks the Uniswap Trading API with its own key, read-only: nothing
 * is built for signing and nothing is sent. The team works from these lines,
 * so no agent has to run a command to get a price. A quote that does not come
 * back in time is left out, and the turn goes on from the market alone.
 */

import type { DeskQuote, DeskTrade } from "@perkos/client";
import type { DeskAsset } from "@perkos/desk-contract";

/** How many of the turn's assets get a Uniswap quote: the ones it looks at hardest. */
export const QUOTED_ASSETS = 3;
/** The size a turn prices when the question names none, in the desk's quote asset. */
export const DEFAULT_SIZE = 50;

const AMOUNT = /\$\s*(\d{1,7}(?:[.,]\d{1,2})?)|(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:usdg|usdc|usd|dollars?|d[oó]lares?)\b/i;

/** The size the question asks about, or the default, never above what one order may spend. */
export function turnSize(question: string, maxOrder?: number): number {
  const m = AMOUNT.exec(question);
  const asked = m ? Number((m[1] ?? m[2] ?? "").replace(",", ".")) : NaN;
  const size = Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_SIZE;
  return maxOrder && maxOrder > 0 ? Math.min(size, maxOrder) : size;
}

const units = (atomic: string, decimals: number) => Number(atomic) / 10 ** decimals;
/** A token amount: four decimals, or four significant figures under one. */
const amount = (n: number) => (n >= 1 ? n.toFixed(4) : n.toPrecision(4));

/** One quote as a fact line, without its [Fn] tag. */
export function quoteLine(q: DeskQuote, ticker: string): string {
  const paid = units(q.amountIn, q.tokenIn.decimals);
  const got = units(q.amountOut, q.tokenOut.decimals);
  let head = `Uniswap now: ${paid.toFixed(2)} ${q.tokenIn.symbol} buys ${amount(got)} ${ticker}`;
  if (got > 0) head += ` (${(paid / got).toFixed(2)} ${q.tokenIn.symbol} each)`;
  const parts = [head];
  if (q.priceImpactPct !== null) parts.push(`price impact ${q.priceImpactPct.toFixed(2)}%`);
  const route = q.protocols.length ? q.protocols.join(" + ") : q.routing;
  if (route) parts.push(`${route} route`);
  if (q.requestId) parts.push(`request ${q.requestId}`);
  if (q.chainId) parts.push(`chain ${q.chainId}`);
  if (q.quotedAt) parts.push(`quoted at ${q.quotedAt}`);
  return `${parts.join(", ")}.`;
}

/** Quotes for the first few tradeable assets at this size, in the turn's order; the ones that fail are left out. */
export async function uniswapFacts(trade: Pick<DeskTrade, "quote">, module: string, assets: DeskAsset[], size: number, onQuote?: (quote: DeskQuote) => void): Promise<string[]> {
  const picked = assets.filter((a) => a.tradeable !== false).slice(0, QUOTED_ASSETS);
  const lines = await Promise.all(
    picked.map((a) =>
      trade.quote(module, a.ticker, String(size)).then(
        (q) => { onQuote?.(q); return quoteLine(q, a.ticker); },
        () => null,
      ),
    ),
  );
  return lines.filter((line): line is string => line !== null);
}

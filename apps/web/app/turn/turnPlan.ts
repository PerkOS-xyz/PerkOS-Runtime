/**
 * The Trader's plan in a finished desk turn, as something the person can buy:
 * the stock the Trader names first among the turn's facts, and the size the
 * plan starts with, never more than one order may spend. An answer that puts
 * the entry off ("I would wait", "no entry today", "esperaría"), or that names
 * no stock of the facts or no size, has no plan; neither has a turn Risk blocked.
 *
 * Pure, so the Trader's card, the desk and Sparky's summary read a turn's plan
 * the same way. A plan only fills the Trader in: nothing is quoted or signed
 * until the person asks for a quote and holds to approve.
 */

import { runtimeFailure } from "../lib/turnFailure";
import { sizesIn } from "../lib/turnLint";
import type { TurnRecord, Verdict } from "../lib/turnRecord";
import { factTickers, firstTicker, settled } from "./turnLook";
import type { TurnView } from "./turnState";

export interface TurnPlan {
  /** One of the turn's fact tickers: "NVDA". */
  ticker: string;
  /** What the plan starts with, in the desk's quote asset, never above what one order may spend. */
  amount: number;
}

export interface PlanInput {
  /** The Trader's answer, as it arrived. */
  reply: string;
  /** The turn's [Fn] lines. */
  facts: readonly string[];
  verdict?: Verdict | null | undefined;
  /** The most one order may spend. A desk that sets none leaves the size as the Trader said it. */
  maxOrder?: number | undefined;
  /** The desk's quote asset: "USDG". */
  quote?: string | undefined;
}

/**
 * Words that put the entry off, in English and in Spanish. Said before the
 * plan's first size, they mean the Trader would not buy now; said after it,
 * they are about something else, such as when to add the second pick.
 */
const PUT_OFF = new RegExp(
  [
    // "I would wait", "waiting for the close"; not "don't wait" or "no need to wait".
    "(?<!\\b(?:don't|don’t|do\\s+not|no\\s+need\\s+to)\\s+)\\bwait(?:s|ing|ed)?\\b",
    "\\bhold(?:ing)?\\s+off\\b",
    "\\b(?:stand|stay|step)(?:ing)?\\s+(?:aside|out|away|down|flat)\\b",
    "\\bsidelines?\\b",
    "\\bsit(?:ting)?\\s+(?:this\\s+(?:one\\s+)?)?out\\b",
    "\\bno\\s+(?:entry|entries|trade|trades|buy|buys)\\b",
    "\\bnot\\s+(?:buy|buying|enter|entering|trade|trading|now)\\b",
    "\\bnot\\s+the\\s+(?:time|moment)\\b",
    "\\b(?:do|does|would|should|will|could)(?:\\s+not|n't|n’t)\\s+(?:buy|enter|trade|chase|add)\\b",
    "\\bwon(?:'|’)t\\s+(?:buy|enter|trade)\\b",
    "\\bskip\\b",
    "\\bpass\\s+(?:on|for\\s+now|today)\\b",
    // "Espera.", "esperaría", "mejor esperar", "esperar al cierre"; not "no esperaría".
    "^\\s*(?:@[\\w-]+[\\s,:]*)*espera\\b",
    "(?<!\\bno\\s+)\\besperar(?:ía|íamos|ia|iamos)\\b",
    "\\besperemos\\b",
    "\\besperar\\s+(?:a|al|el|la|los|las|hasta|que|un|una)\\b",
    "\\baguard\\w*",
    "\\bmejor\\s+(?:esperar|no)\\b",
    "\\bno\\s+(?:compr|entr|oper|abr)\\w*",
    "\\bno\\s+es\\s+(?:el\\s+)?momento\\b",
    "\\bsin\\s+(?:entrada|operar|comprar)\\b",
    "\\bal\\s+margen\\b",
    "\\b(?:quedarse|quedarme|quedarnos|mantenerse|mantenerme|mantenernos)\\s+fuera\\b",
    "\\babsten\\w*",
  ].join("|"),
  "i",
);

/** Where the sentence that holds `from` ends: its full stop, semicolon or line break, or the end of the text. */
function sentenceEnd(text: string, from: number): number {
  const rest = text.slice(from).search(/[.;!?](?=\s|$)|\n/);
  return rest < 0 ? text.length : from + rest + 1;
}

/** The Trader's plan in its answer, or null when it has none. */
export function readPlan(input: PlanInput): TurnPlan | null {
  if (input.verdict === "BLOCK") return null;
  const reply = input.reply.trim();
  if (!reply) return null;
  // The entry is the first size the answer names; a second one is usually when to add the next pick.
  const first = sizesIn(reply, input.quote ?? "USDG")[0];
  if (!first || !(first.value > 0)) return null;
  if (PUT_OFF.test(reply.slice(0, first.end))) return null;
  // The stock is named by then: one named only later is another pick, not the one this size buys.
  const ticker = firstTicker(reply.slice(0, sentenceEnd(reply, first.end)), factTickers(input.facts));
  if (!ticker) return null;
  const most = input.maxOrder !== undefined && input.maxOrder > 0 ? input.maxOrder : Number.POSITIVE_INFINITY;
  return { ticker, amount: Math.min(first.value, most) };
}

/** The plan of the turn the window holds: none while it runs, or when the Trader gave no answer. */
export function planOfView(view: TurnView, maxOrder?: number): TurnPlan | null {
  const trader = view.roles.trader;
  if (view.live || !view.turnId || !trader) return null;
  const r = settled(trader);
  if (r.status !== "delivered") return null;
  return readPlan({ reply: r.reply ?? "", facts: view.facts, verdict: view.verdict ?? null, maxOrder });
}

/** The plan of a kept turn. A runtime's failure sent as an answer is no plan. */
export function planOfRecord(record: Pick<TurnRecord, "replies" | "facts" | "verdict">, maxOrder?: number): TurnPlan | null {
  const trader = record.replies.find((r) => r.role === "trader");
  if (!trader?.ok || !trader.reply.trim() || runtimeFailure(trader.reply)) return null;
  return readPlan({ reply: trader.reply, facts: record.facts, verdict: record.verdict ?? null, maxOrder });
}

/**
 * The Trader's arithmetic and verdicts as pure data: what the delegated wallet
 * holds, why a buy cannot run yet, whether a quote is the order that was
 * asked for, how long a quote stays good, and what an answer to a buy or a
 * transfer home means for the person. No browser needed, so it is tested on
 * its own.
 */

import type { BuyReceipt, DeskQuote, DeskTrader, SweepReceipt, TraderBalance } from "@perkos/client";
import type { DeskAsset } from "@perkos/desk-contract";
import { formatUnits, parseUnits } from "viem";

import type { TurnReceipt } from "../lib/turnRecord";
import { effectiveOrderCap, worldApprovalRequired } from "./delegation";

export const EXPLORER = "https://robinhoodchain.blockscout.com";

/** Robinhood Chain: the one chain this Trader buys on, and the one its copy and explorer name. */
export const ROBINHOOD_CHAIN_ID = 4663;

/** USDG counts in 6 decimals on Robinhood Chain. A quote that counts it otherwise is not this order. */
export const USDG_DECIMALS = 6;

/**
 * How long a quote stays on screen, counted from when it arrived here. The
 * desk's own deadline is about five minutes; the margin keeps an approval from
 * landing just after it.
 */
export const QUOTE_TTL_S = 285;

/** The slippage a buy starts with: the least it accepts is the quote less 1%. */
export const SLIPPAGE_BPS = 100;
/** The most slippage the owner can choose. PerkOS refuses more. */
export const MAX_SLIPPAGE_BPS = 300;
/** The slippages the owner chooses from, in basis points. */
export const SLIPPAGE_CHOICES = [50, 100, 200, 300] as const;

/**
 * How far the price a quote implies may sit from the market's reference price
 * before the hold is blocked. The quote sets the minimum PerkOS holds the swap
 * to, and a quote that far off is more likely a wrong decimals count or a broken
 * route than a real price.
 */
export const PRICE_GAP_PCT = 5;

/**
 * How long the screen waits for a buy before calling it unconfirmed. PerkOS
 * can take about 150 s (pricing, two approvals and the swap, each waited
 * for); this is longer than Runtime's own wait on PerkOS, so that one answers
 * first.
 */
export const BUY_WAIT_MS = 200_000;
/** The same for a transfer home: one transaction, waited for. */
export const SWEEP_WAIT_MS = 100_000;

/** After a buy that may be on chain, when the wallet is read again. */
export const RECHECK_MS = [10_000, 30_000, 60_000] as const;
/** How long that outcome stays on screen before it can be put away, unless the wallet shows the stock arrived. */
export const DISMISS_AFTER_MS = 60_000;

/** Said when a buy was sent and no clear answer came back: it may be on chain. */
export const UNCONFIRMED = "We could not confirm the order. Check the explorer before trying again.";
/** The same for a transfer home. */
export const SWEEP_UNCONFIRMED = "We could not confirm the transfer. Check the explorer before trying again.";

/** A chain amount for reading: at most `digits` decimals, no trailing zeros. */
export function readable(units: string, decimals: number, digits = 6): string {
  const [whole, frac = ""] = formatUnits(BigInt(units), decimals).split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole!;
}

/**
 * A chain amount for reading that never shows a balance above zero as 0: an
 * amount too small for `digits` decimals reads "less than 0.000001".
 */
export function showAmount(units: string, decimals: number, digits = 6): string {
  const text = readable(units, decimals, digits);
  if (text !== "0" || BigInt(units) <= 0n) return text;
  return `less than ${digits > 0 ? `0.${"0".repeat(digits - 1)}1` : "1"}`;
}

/** The same with "about" before a rounded amount, and without it before one too small to show. */
export function aboutAmount(units: string, decimals: number, digits = 6): string {
  const text = showAmount(units, decimals, digits);
  return text.startsWith("less than") ? text : `about ${text}`;
}

/**
 * A bound, such as the least a buy accepts, read after "at least" or "below":
 * rounded like showAmount, or in full when rounding would not show it at all.
 */
export function boundAmount(units: string, decimals: number, digits = 6): string {
  const text = readable(units, decimals, digits);
  return text === "0" && BigInt(units) > 0n ? readable(units, decimals, decimals) : text;
}

/** Whole units as the chain counts them. */
export const toUnits = (amount: number, decimals: number): string => parseUnits(String(amount), decimals).toString();

/** The least a buy accepts once slippage is taken off the quote, in atomic units. */
export function minAfterSlippage(amountOut: string, bps: number): string {
  return ((BigInt(amountOut) * BigInt(10_000 - bps)) / 10_000n).toString();
}

/** A slippage the owner may choose: a whole number of basis points from 1 to the ceiling. */
export const slippageOk = (bps: unknown): bps is number => typeof bps === "number" && Number.isInteger(bps) && bps >= 1 && bps <= MAX_SLIPPAGE_BPS;

/**
 * Seconds left on a quote, from two readings of this machine's monotonic clock
 * (performance.now). The desk's clock is never compared with this one.
 */
export function quoteSecondsLeft(receivedAt: number, now: number, ttl = QUOTE_TTL_S): number {
  return Math.max(0, ttl - Math.floor(Math.max(0, now - receivedAt) / 1000));
}

export interface Funds {
  usdg: TraderBalance | null;
  /** ETH for gas, in wei, when PerkOS said. */
  gasWei: string | null;
  /** Every other token the wallet holds a balance of: what the Trader bought. */
  stocks: TraderBalance[];
}

/** What the delegated wallet holds, split the way the sheet shows it. */
export function fundsOf(trader: DeskTrader, quoteSymbol = "USDG"): Funds {
  const pays = trader.input?.address.toLowerCase();
  const usdg =
    trader.balances.find((b) => b.address !== null && (pays ? b.address.toLowerCase() === pays : b.symbol.toUpperCase() === quoteSymbol.toUpperCase())) ?? null;
  const stocks = trader.balances.filter((b) => b.address !== null && b !== usdg && BigInt(b.amount) > 0n);
  return { usdg, gasWei: trader.gas.wei, stocks };
}

/** USDG in the wallet as a number, for comparing with an amount typed in. */
export const usdgHeld = (f: Funds): number => (f.usdg ? Number(formatUnits(BigInt(f.usdg.amount), f.usdg.decimals)) : 0);

/** How much of a token the wallet holds, in atomic units: "0" when PerkOS lists none. */
export function heldOf(trader: DeskTrader | null, address: string): string {
  return trader?.balances.find((b) => b.address !== null && b.address.toLowerCase() === address.toLowerCase())?.amount ?? "0";
}

/** Why a buy of `amount` USDG cannot run right now, in words, or null when it can. */
export function buyBlocker(trader: DeskTrader | null, amount: number, agentId?: string): string | null {
  if (!trader) return "The delegated wallet has not been read yet.";
  if (!trader.delegated || !trader.wallet) return "Give the Trader access to a wallet of yours first.";
  if (worldApprovalRequired(trader, agentId)) return "Confirm this desk's Trader access with World before buying.";
  const cap = effectiveOrderCap(trader, agentId);
  const held = usdgHeld(fundsOf(trader));
  if (!(held > 0)) return "The delegated wallet holds no USDG. Send USDG on Robinhood Chain to it first.";
  if (!trader.gas.ok) return "The delegated wallet needs a little ETH on Robinhood Chain for gas.";
  if (!(cap > 0)) return "PerkOS has not set how much one order may spend yet.";
  if (!(amount > 0)) return "Enter how much USDG to spend.";
  if (amount > cap) return `One order can spend up to ${cap} USDG.`;
  if (amount > held) return `The delegated wallet holds ${held} USDG.`;
  return null;
}

/**
 * The line under the cap, from the reason PerkOS gives for it. Each one says
 * what is true now and what the owner can do about it.
 */
export function capNote(trader: Pick<DeskTrader, "cap" | "capBy" | "capReason">): string {
  const cap = trader.cap;
  if (!(cap > 0)) return "PerkOS has not set how much one order may spend yet, so buying waits.";
  switch (trader.capReason) {
    case "owner-limit":
      return `Your limit: up to ${cap} USDG an order, saved with your Dynamic signer rule. PerkOS checks every order against it before asking Dynamic to sign.`;
    case "no-rule-for-chain":
      // The delegation page cannot add Robinhood Chain to a saved limit yet, so this names no step for the owner.
      return `Your saved limit does not cover Robinhood Chain yet, so the PerkOS limit applies on Robinhood Chain for now: up to ${cap} USDG an order.`;
    case "owner-limit-above-platform":
      return `Your limit is at or above the most PerkOS allows, so each order is capped at ${cap} USDG.`;
    case "no-owner-limit":
      return `No limit of yours yet: PerkOS caps each order at ${cap} USDG. Set yours with Edit limits.`;
    default:
      // A PerkOS that gives no reason: say only who set the cap.
      return trader.capBy === "owner"
        ? `Your limit: up to ${cap} USDG an order. PerkOS checks every order against it before asking Dynamic to sign.`
        : `PerkOS caps each order at ${cap} USDG.`;
  }
}

/** What the owner asked the desk to price. */
export interface QuoteAsk {
  /** The stock chosen, as the desk's market lists it. */
  asset: Pick<DeskAsset, "ticker" | "address" | "decimals">;
  /** Whole USDG. */
  amount: number;
  /** The token the delegated wallet pays with, when known. */
  usdgAddress: string | null;
}

/**
 * Why a quote is not the order the owner asked for, or null when it is. The
 * quote sets the minimum PerkOS holds the swap to, so every part of it that
 * sets that minimum must be this order's: the chain, the stock and how it is
 * counted, USDG and how it is counted, and the exact amount.
 */
export function quoteMismatch(q: DeskQuote, ask: QuoteAsk): string | null {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const ticker = ask.asset.ticker;
  if (q.chainId !== null && q.chainId !== ROBINHOOD_CHAIN_ID) return `The desk priced this on chain ${q.chainId}, not on Robinhood Chain.`;
  if (!q.ticker) return "The desk did not say which stock it priced.";
  if (!same(q.ticker, ticker) || !same(q.tokenOut.address, ask.asset.address)) return `The desk priced another stock, not ${ticker}.`;
  if (q.tokenOut.decimals !== ask.asset.decimals) {
    return `The desk counts ${ticker} in ${q.tokenOut.decimals} decimals and the market in ${ask.asset.decimals}, so the amount cannot be trusted.`;
  }
  if (!ask.usdgAddress || !same(q.tokenIn.address, ask.usdgAddress)) return "The desk priced this paid with another token, not the wallet's USDG.";
  if (q.tokenIn.decimals !== USDG_DECIMALS) return `The desk counts USDG in ${q.tokenIn.decimals} decimals, not ${USDG_DECIMALS}.`;
  if (q.amountIn !== toUnits(ask.amount, USDG_DECIMALS)) return "The desk priced a different amount of USDG.";
  return null;
}

export interface PriceCheck {
  /** USDG a share, as the quote implies. */
  implied: number;
  /** The market's reference price, when it has one. */
  reference: number | null;
  /** How far the quote sits from it, in percent: above the market is positive. */
  gapPct: number | null;
  /** Why the hold is blocked, or null when it is not. */
  blocked: string | null;
}

/** A price in USDG, which the desk counts as dollars. */
export const usd = (n: number) => `$${n >= 1 ? n.toFixed(2) : n.toPrecision(3)}`;

/**
 * The price a quote implies, held against the market's reference price. More
 * than PRICE_GAP_PCT away either way blocks the hold: too cheap is as
 * suspect as too dear. With no reference price there is nothing to hold it
 * against, and the screen says so.
 */
export function priceCheck(q: DeskQuote, asset: Pick<DeskAsset, "ticker" | "priceUsd">): PriceCheck {
  const paid = Number(formatUnits(BigInt(q.amountIn), q.tokenIn.decimals));
  const got = Number(formatUnits(BigInt(q.amountOut), q.tokenOut.decimals));
  const implied = got > 0 ? paid / got : Number.POSITIVE_INFINITY;
  const reference = asset.priceUsd !== null && asset.priceUsd > 0 ? asset.priceUsd : null;
  if (!Number.isFinite(implied)) return { implied, reference, gapPct: null, blocked: `This quote gives no ${asset.ticker} for this USDG. Get a new quote.` };
  if (reference === null) return { implied, reference, gapPct: null, blocked: null };
  const gapPct = ((implied - reference) / reference) * 100;
  const blocked =
    Math.abs(gapPct) > PRICE_GAP_PCT
      ? `This quote prices ${asset.ticker} at ${usd(implied)} a share, ${Math.abs(gapPct).toFixed(1)}% ${gapPct > 0 ? "above" : "below"} the market's ${usd(reference)}. ` +
        `That is more than ${PRICE_GAP_PCT}% away, so it cannot be approved. Get a new quote in a moment.`
      : null;
  return { implied, reference, gapPct, blocked };
}

/** What an answer to a buy or a transfer home means. */
export type Outcome<R> =
  | { kind: "receipt"; receipt: R }
  /** Refused before anything was sent. */
  | { kind: "refused"; code: string; message: string; detail: string }
  /** Maybe sent, and nobody can say what happened. */
  | { kind: "unconfirmed"; message: string };

export type BuyOutcome = Outcome<BuyReceipt>;
export type SweepOutcome = Outcome<SweepReceipt>;

/** Refusals PerkOS answers before it signs anything, in the words the sheet uses. */
const REFUSED: Record<string, string> = {
  NO_DELEGATION: "The Trader has no wallet of yours to buy from. Give access first.",
  OVER_LIMIT: "This order is over a limit you set. Lower the amount, or edit your limits.",
  STALE_ORDER: "The price moved: you would get less than the least you accept. Get a new quote.",
  SIGNER_REFUSED: "Dynamic refused to sign: the order is outside the rule you saved for the Trader. Edit limits to change it.",
  TRADER_NEEDS_GAS: "The delegated wallet needs a little ETH on Robinhood Chain for gas.",
  DESK_UNAVAILABLE: "The desk could not price this order right now. Try again in a moment.",
  ORDER_IN_FLIGHT: "An order from this wallet is still going through. Wait for it before sending another.",
};

/**
 * Other refusals PerkOS gives only before a broadcast, in its own words: once
 * anything is sent it answers with the hashes instead of an error. Some come
 * as a 5xx, which is why they are named here.
 */
const NOTHING_SENT = new Set([
  "ORDER_FAILED",
  "INSUFFICIENT_FUNDS",
  "UNKNOWN_STOCK",
  "NOT_TRADEABLE",
  "QUOTE_REFUSED",
  "ROUTE_REFUSED",
  "APPROVAL_NOT_SEEN",
  "CHAIN_UNAVAILABLE",
  "NO_DESK_TRADE",
  "BAD_INPUT",
  "NOTHING_TO_SWEEP",
  "TRANSFER_REFUSED",
  "DESK_POLICY",
]);

const SWAP_STATUSES: readonly unknown[] = ["success", "pending", "reverted", "not_sent"];
const CHAIN_STATUSES: readonly unknown[] = ["success", "pending", "reverted"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isBuyReceipt = (r: unknown): r is BuyReceipt =>
  isObject(r) &&
  SWAP_STATUSES.includes(r.status) &&
  (r.bought === true || r.bought === false || r.bought === null) &&
  (r.hash === null || (typeof r.hash === "string" && r.hash !== "")) &&
  Array.isArray(r.steps);

const isSweepReceipt = (r: unknown): r is SweepReceipt => isObject(r) && typeof r.hash === "string" && r.hash !== "" && CHAIN_STATUSES.includes(r.status);

const textOrNull = (v: unknown) => v === null || typeof v === "string";

/** A buy receipt with every field the sheet draws in the shape it draws it. */
const isDrawableBuy = (r: unknown): r is BuyReceipt =>
  isBuyReceipt(r) &&
  (r.amountOut === null || (typeof r.amountOut === "string" && /^\d+$/.test(r.amountOut))) &&
  textOrNull(r.explorerUrl) &&
  textOrNull(r.notice) &&
  r.steps.every((s: unknown) => isObject(s) && typeof s.kind === "string" && CHAIN_STATUSES.includes(s.status) && textOrNull(s.hash) && textOrNull(s.explorerUrl));

const isOutcomeOf =
  <R>(isReceipt: (r: unknown) => r is R) =>
  (o: unknown): o is Outcome<R> =>
    isObject(o) &&
    ((o.kind === "receipt" && isReceipt(o.receipt)) ||
      (o.kind === "refused" && typeof o.code === "string" && typeof o.message === "string" && typeof o.detail === "string") ||
      (o.kind === "unconfirmed" && typeof o.message === "string"));

/** Whether an outcome kept across a reload can still be drawn as it was. */
export const isBuyOutcome = isOutcomeOf(isDrawableBuy);
/** The same for a transfer home. */
export const isSweepOutcome = isOutcomeOf((r: unknown): r is SweepReceipt => isSweepReceipt(r) && textOrNull(r.explorerUrl));

/**
 * A 2xx carries a receipt, or it is unconfirmed. Any 4xx but a timeout was
 * refused before signing. With `codesBeforeBroadcast`, a refusal PerkOS names
 * among the ones it gives only before a broadcast counts too, whatever its
 * status. Anything else after the hold (a 5xx, a timeout, a body nobody can
 * read) may have reached the chain, so it is never reported as a failure that
 * invites a second try.
 */
function outcomeOf<R>(status: number, body: unknown, isReceipt: (r: unknown) => r is R, lost: string, codesBeforeBroadcast: boolean): Outcome<R> {
  const b = isObject(body) ? body : {};
  if (status >= 200 && status < 300) return isReceipt(b.receipt) ? { kind: "receipt", receipt: b.receipt } : { kind: "unconfirmed", message: lost };
  const code = typeof b.error === "string" ? b.error : "";
  const said = typeof b.message === "string" ? b.message.trim() : "";
  const known = REFUSED[code];
  const named = codesBeforeBroadcast && (known !== undefined || NOTHING_SENT.has(code));
  if (!named && !(status >= 400 && status < 500 && status !== 408)) return { kind: "unconfirmed", message: lost };
  if (known) return { kind: "refused", code, message: known, detail: said && said !== known ? said : "" };
  return { kind: "refused", code: code || "refused", message: said || `PerkOS refused it (${status}).`, detail: "" };
}

/**
 * What an answer from /api/desks/buy means. The buy's contract is that PerkOS
 * answers an error only before anything is broadcast, so its named refusals
 * count as nothing sent even when they come as a 5xx.
 */
export const buyOutcome = (status: number, body: unknown): BuyOutcome => outcomeOf(status, body, isBuyReceipt, UNCONFIRMED, true);

/**
 * What an answer from /api/desks/sweep means. Only a 4xx is nothing sent: a
 * transfer home that answers a 5xx, even with a code, is read as unconfirmed,
 * so the person checks the explorer before sending it again.
 */
export const sweepOutcome = (status: number, body: unknown): SweepOutcome => outcomeOf(status, body, isSweepReceipt, SWEEP_UNCONFIRMED, false);

/** A transfer home that may still land: sent and not confirmed yet, or no clear answer at all. */
export const sweepUnsettled = (o: SweepOutcome): boolean => o.kind === "unconfirmed" || (o.kind === "receipt" && o.receipt.status === "pending");

export interface BuyOrder {
  module: string;
  ticker: string;
  /** Whole USDG as a decimal string, exactly as quoted. */
  amountUsdg: string;
  maxSlippageBps: number;
  /** The quote the owner saw, always sent: PerkOS refuses the swap below it less the slippage. */
  quotedAmountOut: string;
  /** The desk turn whose plan the buy follows, when it does: PerkOS keeps it as the order's reason. */
  turnId?: string;
}

export interface SweepOrder {
  module: string;
  /** USDG's or a stock's address. No destination: PerkOS pays only the owner. */
  token: string;
}

type Http = typeof fetch;
const browserFetch: Http = (input, init) => fetch(input, init);

async function send<R>(path: string, payload: unknown, waitMs: number, read: (status: number, body: unknown) => Outcome<R>, lost: string, http: Http): Promise<Outcome<R>> {
  let res: Response;
  try {
    res = await http(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(waitMs),
    });
  } catch {
    return { kind: "unconfirmed", message: lost };
  }
  return read(res.status, await res.json().catch(() => null));
}

/** Sends one approved buy and reads the answer. Never throws: a lost or late answer is an unconfirmed order. */
export const sendBuy = (order: BuyOrder, http: Http = browserFetch): Promise<BuyOutcome> =>
  send("/api/desks/buy", order, BUY_WAIT_MS, buyOutcome, UNCONFIRMED, http);

/** Sends one token home and reads the answer. Never throws, the same way. */
export const sendSweep = (order: SweepOrder, http: Http = browserFetch): Promise<SweepOutcome> =>
  send("/api/desks/sweep", order, SWEEP_WAIT_MS, sweepOutcome, SWEEP_UNCONFIRMED, http);

export type ReceiptTone = "success" | "pending" | "reverted" | "stopped";

/** A line PerkOS wrote, ending as a sentence. */
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * How a buy's receipt reads. The title comes from what PerkOS says happened
 * to the swap and from the steps it sent, so it names what reached the chain.
 * The body is PerkOS's own sentence about this order when it gives one, since
 * it knows why an order stopped, and otherwise a sentence built from the same
 * facts. Only a confirmed swap is a purchase. A swap that is not confirmed yet
 * may still buy, so its lines stay in Runtime's words: they are what keeps a
 * second order from going out.
 */
export function receiptView(r: BuyReceipt): { tone: ReceiptTone; title: string; body: string } {
  const said = r.notice ? sentence(r.notice) : null;
  if (r.bought === true) {
    return { tone: "success", title: "Bought", body: `From your delegated wallet. It stays there until you send it home.${said ? ` ${said}` : ""}` };
  }
  if (r.bought === null) {
    return r.hash
      ? { tone: "pending", title: "Sent, not confirmed yet", body: "The swap went out and may still buy. Check the explorer before placing another order." }
      : { tone: "pending", title: "Not confirmed", body: "PerkOS did not say whether the swap went out. Check the explorer before placing another order." };
  }
  if (r.status === "reverted") {
    return { tone: "reverted", title: "Robinhood Chain reverted the swap", body: said ?? "Nothing was bought; the wallet paid only the gas." };
  }
  // The order stopped before the swap: the steps say what did go out.
  const approvals = r.steps.filter((s) => s.kind !== "swap");
  if (approvals.some((s) => s.status === "pending")) {
    return { tone: "pending", title: "An approval is on its way", body: said ?? "Nothing was bought, and the swap was not sent." };
  }
  const went =
    approvals.length === 0
      ? "Nothing was sent."
      : approvals.some((s) => s.status === "reverted")
        ? "An approval failed on chain, so the swap was not sent."
        : `${approvals.length === 1 ? "An approval" : "The approvals"} went out, and the swap was not sent.`;
  return { tone: "stopped", title: "Nothing was bought", body: said ?? went };
}

/** How a transfer home reads, from its status on the chain. */
export function sweepView(r: SweepReceipt, symbol: string): string {
  if (r.status === "success") return `Sent your ${symbol} home.`;
  if (r.status === "reverted") return `Robinhood Chain reverted the transfer: your ${symbol} stayed in the delegated wallet, which paid only the gas.`;
  return `Your ${symbol} is on its way home. Check the explorer before sending it again.`;
}

/** An answer that may still be a purchase: a swap not confirmed yet, or no clear answer at all. */
export const unresolved = (o: BuyOutcome): boolean => o.kind === "unconfirmed" || (o.kind === "receipt" && o.receipt.bought === null);

/**
 * The receipt a desk turn keeps of a buy that followed its plan: the swap that
 * went out, confirmed, on its way or reverted, with what the person approved.
 * Null when no swap went out, or when nobody can say what happened.
 */
export function turnReceiptOf(outcome: BuyOutcome, order: { ticker: string; amountUsdg: string }, at: Date = new Date()): TurnReceipt | null {
  if (outcome.kind !== "receipt") return null;
  const r = outcome.receipt;
  if (r.status === "not_sent" || !r.hash) return null;
  return { hash: r.hash, ...(r.explorerUrl ? { explorerUrl: r.explorerUrl } : {}), status: r.status, ticker: order.ticker, amount: order.amountUsdg, at: at.toISOString() };
}

/** What held a buy from the desk's plan below the plan's amount: one order's limit, or the USDG in the wallet. */
export type PlanCap = "cap" | "held" | null;

/**
 * What a buy from the desk's plan starts with: the plan's amount, never more
 * than one order may spend or than the wallet holds, in whole cents. Before
 * the wallet is read, or while a limit is not known, the plan's amount as it is.
 */
export function planAmount(planned: number, trader: DeskTrader | null): { amount: string; capped: PlanCap } {
  let amount = planned;
  let capped: PlanCap = null;
  if (trader && trader.cap > 0 && trader.cap < amount) {
    amount = trader.cap;
    capped = "cap";
  }
  const held = trader ? usdgHeld(fundsOf(trader)) : 0;
  if (held > 0 && held < amount) {
    amount = held;
    capped = "held";
  }
  // Down to the cent, so rounding never asks for more than the wallet holds.
  return { amount: String(Math.floor(amount * 100 + 1e-6) / 100), capped };
}

/** How much more of the stock the wallet holds than when the owner approved, in atomic units, or null when none. */
export function arrived(before: string, now: string): string | null {
  const more = BigInt(now) - BigInt(before);
  return more > 0n ? more.toString() : null;
}

/**
 * Whether an outcome may be put away. One that may still be a purchase stays
 * until the wallet shows the stock arrived, or for DISMISS_AFTER_MS after the
 * answer, so the form that places another order does not come straight back.
 */
export function mayDismiss(o: BuyOutcome, msSinceAnswer: number, stockArrived: boolean): boolean {
  return !unresolved(o) || stockArrived || msSinceAnswer >= DISMISS_AFTER_MS;
}

/** What the sheet's gates read from a run: whether it has answered, and what. */
export interface RunState<O> {
  outcome: O | null;
}

/** A transfer home, with the token it moves. */
export type SweepState = RunState<SweepOutcome> & { summary: { symbol: string; token: string } };

const inFlight = (run: RunState<unknown> | null): boolean => run !== null && run.outcome === null;

/** A buy that is going through or may still land. */
export const buyOpen = (run: RunState<BuyOutcome> | null): boolean => run !== null && (run.outcome === null || unresolved(run.outcome));

/** A transfer home that is going through or may still land. */
export const sweepOpen = (run: RunState<SweepOutcome> | null): boolean => run !== null && (run.outcome === null || sweepUnsettled(run.outcome));

/** Revoke is on unless PerkOS is still signing a buy or a transfer home: revoking then could leave an approval out with nothing bought. */
export const revokeAllowed = (buy: RunState<BuyOutcome> | null, sweep: RunState<SweepOutcome> | null): boolean => !inFlight(buy) && !inFlight(sweep);

/** Send home is on unless a buy is spending from the wallet or may still land, or another transfer home may still land. */
export const sendHomeAllowed = (buy: RunState<BuyOutcome> | null, sweep: RunState<SweepOutcome> | null): boolean => !buyOpen(buy) && !sweepOpen(sweep);

/**
 * Why a transfer home keeps a buy waiting, or null when it does not. Any
 * transfer in flight does. One of USDG that may still land does too: PerkOS
 * would read the balance before it leaves, and the swap would revert once it
 * has, with nothing bought and the gas spent.
 */
export function sweepBlocksBuy(sweep: SweepState | null, usdgAddress: string | null): string | null {
  if (!sweep) return null;
  if (sweep.outcome === null) return "Wait for the transfer home to finish.";
  const usdg = usdgAddress ? sweep.summary.token.toLowerCase() === usdgAddress.toLowerCase() : sweep.summary.symbol.toUpperCase() === "USDG";
  if (usdg && sweepUnsettled(sweep.outcome)) {
    return 'Your USDG may still be on its way home, so a buy now could spend USDG that is leaving. Check the explorer, then press "I checked the explorer" above.';
  }
  return null;
}

/** Why the owner cannot get a quote or hold to approve right now, or null when they can. */
export function buyReason(trader: DeskTrader | null, amount: number, stockChosen: boolean, sweep: SweepState | null, agentId?: string): string | null {
  const usdgAddress = trader ? (fundsOf(trader).usdg?.address ?? null) : null;
  return buyBlocker(trader, amount, agentId) ?? sweepBlocksBuy(sweep, usdgAddress) ?? (stockChosen ? null : "Choose a stock.");
}

/** A wallet read can finish after a rebind or the quote expires. Keep the
 * owner's approval bound to the wallet, chain and quote they actually saw. */
export function recheckBuy(input: {
  before: DeskTrader; current: DeskTrader | null; amount: number; agentId?: string;
  receivedAt: number; now: number; sweep: SweepState | null;
}): string | null {
  const { before, current } = input;
  if (!current || !before.wallet || current.wallet?.toLowerCase() !== before.wallet.toLowerCase() || current.chainId !== before.chainId) {
    return "The Trader's wallet or chain changed. Review it and get a new quote.";
  }
  if (quoteSecondsLeft(input.receivedAt, input.now) <= 0) return "The quote expired while checking access. Get a new quote.";
  return buyReason(current, input.amount, true, input.sweep, input.agentId);
}

/** Whether the buy's outcome may be put away now, on this machine's monotonic clock (see mayDismiss). */
export function outcomeDismissible(run: RunState<BuyOutcome> & { answeredAt: number | null }, now: number, stockArrived: boolean): boolean {
  if (run.outcome === null) return false;
  return mayDismiss(run.outcome, run.answeredAt !== null ? Math.max(0, now - run.answeredAt) : 0, stockArrived);
}

/** The steps PerkOS signs for a buy, as the receipt names them. */
export const STEP_LABEL: Record<string, string> = {
  approve: "Let Permit2 move this USDG",
  permit2: "Let the router spend it",
  swap: "Swap",
  sweep: "Send home",
};

/** Where a step stands, in words. */
export const STEP_STATE: Record<BuyReceipt["steps"][number]["status"], string> = {
  success: "confirmed",
  pending: "on its way",
  reverted: "reverted",
};

/** An address as the sheet shows it. */
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const txUrl = (hash: string, explorerUrl?: string | null) => explorerUrl || `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

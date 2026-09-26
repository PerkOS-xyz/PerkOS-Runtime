/**
 * The Trader on a desk that buys from a wallet the owner delegated. The owner
 * keeps a Dynamic wallet and lets PerkOS sign for it: the money sits in that
 * wallet, PerkOS checks every buy against the Trader's policy and signs it
 * through Dynamic only after the owner approves it, and what the wallet buys
 * stays there. A sweep sends a token back to the owner and can pay nobody
 * else. Runtime never sees a key; it reads the wallet, asks for a quote, and
 * asks for one approved order at a time.
 */

import { PerkosApiError, type PerkosClient } from "./client.ts";

export interface TraderToken {
  symbol: string;
  address: string;
  decimals: number;
}

export interface TraderBalance {
  symbol: string;
  /** Null for the chain's own coin, the ETH that pays the gas. */
  address: string | null;
  decimals: number;
  /** Atomic units, as a decimal string. */
  amount: string;
}

export interface DeskTrader {
  /** PerkOS holds a live share of a wallet the owner delegated. */
  delegated: boolean;
  /** The delegated wallet, or null before the owner gives access. */
  wallet: string | null;
  chainId: number;
  /** Whether the wallet holds the ETH an order needs for gas, and how much in wei when PerkOS says. */
  gas: { ok: boolean; wei: string | null };
  balances: TraderBalance[];
  /** The most one order may spend, in whole USDG. 0 when PerkOS names no cap. */
  cap: number;
  /** Who set the cap: the owner's own limit, or the platform's default while they have none. */
  capBy: "owner" | "platform" | null;
  /** Why the cap is whose it is, so the screen can say it truly. Null from a PerkOS that does not say. */
  capReason: CapReason | null;
  /** What the desk pays with, when PerkOS names it. */
  input: TraderToken | null;
  /** False when the desk's stock list did not answer, so stocks the wallet holds may be missing. */
  marketAvailable: boolean;
}

/**
 * Why the cap on one order is the owner's or the platform's: the owner's
 * limit applies ("owner-limit"), the owner's saved rule does not cover the
 * desk's chain ("no-rule-for-chain"), the owner's limit is above the
 * platform's ("owner-limit-above-platform"), or the owner saved none.
 */
export type CapReason = "owner-limit" | "no-rule-for-chain" | "owner-limit-above-platform" | "no-owner-limit";
const CAP_REASONS: readonly CapReason[] = ["owner-limit", "no-rule-for-chain", "owner-limit-above-platform", "no-owner-limit"];

export interface DeskQuote {
  /** The chain the desk priced on, when it says. */
  chainId: number | null;
  /** The stock the desk priced, as it named it; null when it did not. */
  ticker: string | null;
  tokenIn: TraderToken;
  tokenOut: TraderToken;
  /** Atomic units. */
  amountIn: string;
  amountOut: string;
  priceImpactPct: number | null;
  routing: string | null;
  protocols: string[];
  requestId: string | null;
  /** When the desk quoted, by its clock. Shown, never compared with this machine's. */
  quotedAt: string | null;
  gasFeeUsd: number | null;
}

/** Where one transaction stands on the chain. */
export type ChainStatus = "success" | "pending" | "reverted";

/** Where the swap of an order stands: its own chain status, or "not_sent" when the order stopped before it. */
export type SwapStatus = ChainStatus | "not_sent";
const SWAP_STATUSES: readonly SwapStatus[] = ["success", "pending", "reverted", "not_sent"];

/** One transaction PerkOS signed for an order: "approve" (USDG to Permit2), "permit2" (the router's allowance) or "swap". */
export interface BuyStep {
  kind: string;
  hash: string | null;
  status: ChainStatus;
  explorerUrl: string | null;
}

export interface BuyReceipt {
  /** The swap's own status, "not_sent" when the order stopped before the swap. */
  status: SwapStatus;
  /**
   * true: the swap landed. false: nothing was bought (the order stopped
   * before the swap, or the swap reverted). null: the swap was sent and is
   * not confirmed yet, so nothing may invite another buy.
   */
  bought: boolean | null;
  /** The swap's hash, null when no swap was sent. */
  hash: string | null;
  explorerUrl: string | null;
  /** What the wallet received, in the stock's atomic units, once the chain says. */
  amountOut: string | null;
  /** Every transaction the order sent, approvals included, in order. */
  steps: BuyStep[];
  /** Why the order stopped, as a sentence, when PerkOS gives one. */
  notice: string | null;
}

export interface SweepReceipt {
  hash: string;
  status: ChainStatus;
  explorerUrl: string | null;
}

export interface BuyInput {
  ticker: string;
  /** Whole USDG, as a decimal string: the amount the owner held for, exactly. */
  amountUsdg: string;
  maxSlippageBps: number;
  /** The quote the owner approved, in the stock's atomic units, so PerkOS can refuse a worse price. */
  quotedAmountOut: string;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Whole units (such as "1.5" USDG) in atomic units, cutting what the token cannot hold. */
export function fromWhole(v: unknown, decimals: number): string | null {
  const raw = typeof v === "number" && Number.isFinite(v) && v >= 0 ? String(v) : typeof v === "string" ? v.trim() : "";
  const m = /^(\d+)(?:\.(\d*))?$/.exec(raw) ?? /^()\.(\d+)$/.exec(raw);
  if (!m) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(`${m[1] || "0"}${frac}`).toString();
}

/**
 * An amount in atomic units. PerkOS sends atomic strings; a whole-unit value
 * with a decimal point is converted rather than misread as atomic.
 */
export function atomic(v: unknown, decimals: number): string | null {
  const raw = typeof v === "string" ? v.trim() : "";
  if (/^\d+$/.test(raw)) return BigInt(raw).toString();
  return raw.includes(".") || typeof v === "number" ? fromWhole(v, decimals) : null;
}

/** An amount PerkOS gave as atomic (`raw`, `amount`) or, failing that, in whole units (`formatted`). */
const amountOf = (v: Obj, decimals: number, atomicKeys: string[]): string | null => {
  for (const k of atomicKeys) {
    const a = atomic(v[k], decimals);
    if (a !== null) return a;
  }
  return fromWhole(v.formatted, decimals);
};

const status = (v: unknown): ChainStatus => (v === "success" || v === "reverted" ? v : "pending");

function token(v: unknown): TraderToken | null {
  if (!isObject(v)) return null;
  const decimals = finite(v.decimals);
  if (!text(v.symbol) || typeof v.address !== "string" || !ADDRESS.test(v.address) || decimals === null) return null;
  return { symbol: v.symbol as string, address: v.address, decimals };
}

function balance(v: unknown): TraderBalance[] {
  if (!isObject(v)) return [];
  const decimals = finite(v.decimals);
  const symbol = text(v.symbol);
  if (!symbol || decimals === null) return [];
  const address = typeof v.address === "string" && ADDRESS.test(v.address) ? v.address : null;
  const amount = amountOf(v, decimals, ["raw", "amount"]);
  // A stock reads by its ticker when PerkOS gives one.
  return amount === null ? [] : [{ symbol: text(v.ticker) ?? symbol, address, decimals, amount }];
}

/** PerkOS may say "enough" outright, or hand over what the wallet holds. Either way the screen needs a yes or no. */
function gasOf(v: unknown, balances: TraderBalance[]): DeskTrader["gas"] {
  const native = balances.find((b) => b.address === null && b.symbol.toUpperCase() === "ETH");
  const said = isObject(v) ? (typeof v.ok === "boolean" ? v.ok : typeof v.enough === "boolean" ? v.enough : null) : typeof v === "boolean" ? v : null;
  const held = isObject(v) ? amountOf(v, 18, ["raw", "amount", "wei"]) : typeof v === "boolean" ? null : atomic(v, 18);
  const wei = native?.amount ?? held;
  return { ok: said ?? (wei !== null && BigInt(wei) > 0n), wei };
}

function capOf(v: unknown): Pick<DeskTrader, "cap" | "capBy" | "capReason"> {
  const n = isObject(v) ? finite(v.amount ?? v.usdg ?? v.maxUsdg) : finite(v);
  const by = isObject(v) && (v.source === "owner" || v.source === "platform") ? v.source : null;
  const reason = isObject(v) ? CAP_REASONS.find((r) => r === v.reason) ?? null : null;
  return { cap: n !== null && n > 0 ? n : 0, capBy: by, capReason: reason };
}

function step(v: unknown): BuyStep[] {
  if (!isObject(v)) return [];
  const kind = text(v.kind);
  if (!kind) return [];
  return [{ kind, hash: text(v.hash), status: status(v.status), explorerUrl: text(v.explorerUrl) }];
}

/** The reason an order stopped: a sentence, or the message of an older PerkOS that sent { code, message }. */
const noticeOf = (v: unknown): string | null => (isObject(v) ? text(v.message) : text(v))?.trim() ?? null;

/**
 * Only an answer whose parts agree is a verdict: a landed swap that says it
 * bought, or a swap that reverted or was never sent that says it did not.
 * Anything else is read as not confirmed, never as bought or as nothing sent.
 */
function boughtOf(swap: SwapStatus, said: unknown): boolean | null {
  if (swap === "success" && said === true) return true;
  if ((swap === "reverted" || swap === "not_sent") && said === false) return false;
  return null;
}

export class DeskTrade {
  constructor(private readonly client: PerkosClient) {}

  private path(module: string, rest: string): string {
    return `/desks/${encodeURIComponent(module)}/${rest}`;
  }

  /**
   * The delegated wallet, what it holds on the desk's chain, and the cap on
   * one order. Moves nothing. With `expectChainId`, a Trader on any other
   * chain is refused: the screen that draws it knows one chain's tokens and
   * explorer, and a wallet read on another chain would be drawn wrong.
   */
  async trader(module: string, expectChainId?: number): Promise<DeskTrader> {
    const body = await this.client.request<Obj>(this.path(module, "trader"), { timeoutMs: 30_000 });
    const chainId = finite(body.chainId);
    if (typeof body.delegated !== "boolean" || chainId === null || !Array.isArray(body.balances)) {
      throw new PerkosApiError("PerkOS answered a Trader this version cannot read", 502, "TRADER_SHAPE");
    }
    if (expectChainId !== undefined && chainId !== expectChainId) {
      throw new PerkosApiError(`This Trader is on chain ${chainId}; this desk trades on chain ${expectChainId}`, 502, "TRADER_CHAIN");
    }
    const wallet = typeof body.wallet === "string" && ADDRESS.test(body.wallet) ? body.wallet : null;
    const balances = body.balances.flatMap(balance);
    return {
      delegated: body.delegated && wallet !== null,
      wallet,
      chainId,
      gas: gasOf(body.gas, balances),
      balances,
      ...capOf(body.cap),
      input: token(body.input),
      marketAvailable: body.marketAvailable !== false,
    };
  }

  /** What the desk would pay out for this much USDG right now. Read-only: nothing is signed. */
  async quote(module: string, ticker: string, amountUsdg: string): Promise<DeskQuote> {
    const body = await this.client.request<Obj>(this.path(module, "quote"), {
      query: { ticker, amountUsdg },
      timeoutMs: 30_000,
    });
    const q = isObject(body.quote) ? body.quote : body;
    const tokenIn = token(q.tokenIn);
    const tokenOut = token(q.tokenOut);
    const amountIn = tokenIn ? atomic(q.amountIn, tokenIn.decimals) : null;
    const amountOut = tokenOut ? atomic(q.amountOut, tokenOut.decimals) : null;
    if (!tokenIn || !tokenOut || amountIn === null || amountOut === null || amountOut === "0") {
      throw new PerkosApiError("The desk answered a quote this version cannot read", 502, "QUOTE_SHAPE");
    }
    const protocols = Array.isArray(q.protocols) ? q.protocols.filter((p): p is string => typeof p === "string") : text(q.protocols) ? [q.protocols as string] : [];
    return {
      chainId: finite(q.chainId),
      ticker: text(q.ticker),
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      priceImpactPct: finite(q.priceImpactPct),
      routing: text(q.routing),
      protocols,
      requestId: text(q.requestId),
      quotedAt: text(q.quotedAt),
      gasFeeUsd: finite(q.gasFeeUsd),
    };
  }

  /**
   * How long a buy may take before this client gives up on the answer.
   * PerkOS prices the order, may send two approvals and then the swap, and
   * waits for each on the chain: about 150 s at worst. Clients allow at least
   * 180 s, so a slow order is not reported as unconfirmed while it is still
   * being answered.
   */
  static readonly BUY_TIMEOUT_MS = 190_000;

  /**
   * Buy with the delegated wallet, after the owner held to approve. PerkOS
   * prices it again, refuses it outside the policy or below the quote the
   * owner saw less their slippage, and signs it through Dynamic. The answer
   * can arrive before the chain settles the swap.
   */
  async buy(module: string, input: BuyInput): Promise<BuyReceipt> {
    const body = await this.client.request<Obj>(this.path(module, "orders/buy"), {
      method: "POST",
      body: input,
      timeoutMs: DeskTrade.BUY_TIMEOUT_MS,
    });
    const swap = SWAP_STATUSES.find((s) => s === body.status);
    // No swap hash is kept for an order that never sent one: an approval's hash is not the order's.
    const hash = swap === "not_sent" ? null : text(body.hash);
    // A status nobody can read, or a sent swap without its hash, cannot be checked on the explorer:
    // refused here, the screen reads it as unconfirmed rather than drawing a guess.
    if (!swap || (swap !== "not_sent" && !hash)) {
      throw new PerkosApiError("PerkOS answered a receipt this version cannot read", 502, "RECEIPT_SHAPE");
    }
    const uint = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? v : null);
    return {
      status: swap,
      bought: boughtOf(swap, body.bought),
      hash,
      explorerUrl: hash ? text(body.explorerUrl) : null,
      amountOut: uint(body.amountOut),
      steps: Array.isArray(body.steps) ? body.steps.flatMap(step) : [],
      notice: noticeOf(body.notice),
    };
  }

  /** Send a token from the delegated wallet home to the owner. PerkOS picks the destination; omitting the amount sends it all. */
  async sweep(module: string, tokenAddress: string, amount?: string): Promise<SweepReceipt> {
    const body = await this.client.request<Obj>(this.path(module, "sweep"), {
      method: "POST",
      body: amount === undefined ? { token: tokenAddress } : { token: tokenAddress, amount },
      timeoutMs: 90_000,
    });
    const hash = text(body.hash);
    if (!hash) throw new PerkosApiError("PerkOS answered a receipt this version cannot read", 502, "RECEIPT_SHAPE");
    return { hash, status: status(body.status), explorerUrl: text(body.explorerUrl) };
  }
}

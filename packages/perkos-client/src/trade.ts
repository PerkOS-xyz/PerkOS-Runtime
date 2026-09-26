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
  /** Why the order goes out, kept with it on PerkOS: the desk turn whose plan it follows. Left out, PerkOS writes its own. */
  reason?: string;
}

/** One stock the delegated wallet holds, at the desk's price, against what the Trader paid for it. */
export interface PortfolioPosition {
  ticker: string;
  name: string;
  address: string;
  decimals: number;
  /** What the wallet holds now, in atomic units. */
  amount: string;
  /** The desk's price now, in USDG a share; null while the market gives none. */
  price: number | null;
  change24hPct: number | null;
  logoUrl: string | null;
  /** What the wallet holds, at that price, in USDG. */
  value: number | null;
  /** USDG paid and shares received across the swaps that landed, each in its own atomic units. */
  spent: string;
  received: string;
  /** USDG a share across those swaps; null when none is on record. */
  avgCost: number | null;
  /** The average cost of what the wallet holds now, in USDG. */
  cost: number | null;
  pnl: number | null;
  pnlPct: number | null;
  /** How many swaps into this stock landed, and when PerkOS recorded the last one. */
  buys: number;
  lastBuyAt: string | null;
}

/** One swap the Trader sent on the desk. Its amounts are in whole units, as PerkOS wrote them. */
export interface PortfolioSwap {
  hash: string;
  /** The stock, by the desk's ticker; null for one the market no longer lists. */
  ticker: string | null;
  tokenOut: string | null;
  usdgIn: string | null;
  amountOut: string | null;
  /** A swap PerkOS has not confirmed or refused reads as "pending". */
  status: SwapStatus;
  explorerUrl: string | null;
  at: string | null;
}

export interface PortfolioTotals {
  /** What the positions with a price are worth, in USDG. */
  value: number;
  /** What the positions with a cost cost. */
  cost: number;
  /** Over the positions with both a price and a cost, and in percent of their cost. */
  pnl: number;
  pnlPct: number | null;
  /** How many positions have no price, and how many no cost. */
  unpriced: number;
  uncosted: number;
}

/** Whether the costs count every buy: PerkOS read its whole log of them, only part of it, or none. */
export type PortfolioHistory = "complete" | "partial" | "unavailable";
const HISTORIES: readonly PortfolioHistory[] = ["complete", "partial", "unavailable"];

export interface DeskPortfolio {
  /** PerkOS holds a live share of a wallet the owner delegated. */
  delegated: boolean;
  wallet: string | null;
  chainId: number;
  input: TraderToken | null;
  /** The USDG the wallet holds, ready to spend; null before the owner gives access. */
  cash: TraderBalance | null;
  gas: DeskTrader["gas"];
  positions: PortfolioPosition[];
  totals: PortfolioTotals;
  swaps: PortfolioSwap[];
  /** False when the desk's market did not answer, so a stock or a price may be missing. */
  marketAvailable: boolean;
  history: PortfolioHistory;
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

/** A whole-unit amount as PerkOS wrote it ("0.05"), or null. */
const whole = (v: unknown): string | null => (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : null);
const count = (v: unknown): number => {
  const n = finite(v);
  return n !== null && n > 0 ? Math.floor(n) : 0;
};
/** A link the screen may open: http(s) only. */
const link = (v: unknown): string | null => {
  const t = text(v)?.trim() ?? null;
  return t && /^https?:\/\//i.test(t) ? t : null;
};

function position(v: unknown, inputDecimals: number): PortfolioPosition[] {
  if (!isObject(v)) return [];
  const ticker = text(v.ticker);
  const decimals = finite(v.decimals);
  if (!ticker || typeof v.address !== "string" || !ADDRESS.test(v.address) || decimals === null) return [];
  // PerkOS gives what is held as `raw`, in atomic units, beside `amount` in whole units.
  const amount = atomic(v.raw, decimals) ?? fromWhole(v.amount, decimals);
  if (amount === null) return [];
  return [
    {
      ticker,
      name: text(v.name) ?? ticker,
      address: v.address,
      decimals,
      amount,
      price: finite(v.price),
      change24hPct: finite(v.change24hPct),
      logoUrl: link(v.logoUrl),
      value: finite(v.value),
      spent: fromWhole(v.spent, inputDecimals) ?? "0",
      received: fromWhole(v.received, decimals) ?? "0",
      avgCost: finite(v.avgCost),
      cost: finite(v.cost),
      pnl: finite(v.pnl),
      pnlPct: finite(v.pnlPct),
      buys: count(v.buys),
      lastBuyAt: text(v.lastBuyAt),
    },
  ];
}

function swapLine(v: unknown): PortfolioSwap[] {
  if (!isObject(v)) return [];
  const hash = text(v.hash);
  if (!hash) return [];
  return [
    {
      hash,
      ticker: text(v.ticker),
      tokenOut: typeof v.tokenOut === "string" && ADDRESS.test(v.tokenOut) ? v.tokenOut : null,
      usdgIn: whole(v.usdgIn),
      amountOut: whole(v.amountOut),
      // "sending", or anything else PerkOS has not settled, is not confirmed.
      status: SWAP_STATUSES.find((s) => s === v.status) ?? "pending",
      explorerUrl: link(v.explorerUrl),
      at: text(v.at),
    },
  ];
}

function totalsOf(v: unknown): PortfolioTotals {
  const t = isObject(v) ? v : {};
  return {
    value: finite(t.value) ?? 0,
    cost: finite(t.cost) ?? 0,
    pnl: finite(t.pnl) ?? 0,
    pnlPct: finite(t.pnlPct),
    unpriced: count(t.unpriced),
    uncosted: count(t.uncosted),
  };
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

  /**
   * What the delegated wallet holds on the desk's chain, priced by the desk,
   * against what the Trader paid for it; the USDG and gas beside it; and the
   * last swaps. Moves nothing. With `expectChainId`, a portfolio on any other
   * chain is refused, as the Trader is.
   */
  async positions(module: string, expectChainId?: number): Promise<DeskPortfolio> {
    const body = await this.client.request<Obj>(this.path(module, "positions"), { timeoutMs: 30_000 });
    const chainId = finite(body.chainId);
    const input = token(body.input);
    // Without what the desk pays in, no cost can be read.
    if (typeof body.delegated !== "boolean" || chainId === null || !input || !Array.isArray(body.positions) || !Array.isArray(body.swaps)) {
      throw new PerkosApiError("PerkOS answered a portfolio this version cannot read", 502, "PORTFOLIO_SHAPE");
    }
    if (expectChainId !== undefined && chainId !== expectChainId) {
      throw new PerkosApiError(`This portfolio is on chain ${chainId}; this desk trades on chain ${expectChainId}`, 502, "PORTFOLIO_CHAIN");
    }
    const wallet = typeof body.wallet === "string" && ADDRESS.test(body.wallet) ? body.wallet : null;
    const delegated = body.delegated && wallet !== null;
    const cash = delegated && isObject(body.cash) ? amountOf(body.cash, input.decimals, ["raw", "amount"]) : null;
    return {
      delegated,
      wallet,
      chainId,
      input,
      cash: cash === null ? null : { symbol: input.symbol, address: input.address, decimals: input.decimals, amount: cash },
      gas: gasOf(body.gas, []),
      // Before the owner gives access there is nothing of theirs to show, whatever came with the answer.
      positions: delegated ? body.positions.flatMap((p) => position(p, input.decimals)) : [],
      totals: totalsOf(body.totals),
      swaps: delegated ? body.swaps.flatMap(swapLine) : [],
      marketAvailable: body.marketAvailable !== false,
      history: HISTORIES.find((h) => h === body.history) ?? "complete",
    };
  }
}

/**
 * Orders on a desk whose money sits in a vault. The owner sets the rails with
 * their own wallet: a strategy per stock, with a limit per trade, a budget and
 * an end date. An order runs inside one of them, prepared by the desk and
 * sent from the wallet the owner delegated to the Trader, only after the
 * owner approves it.
 */

import { PerkosApiError, type PerkosClient } from "./client.ts";

export interface DeskRail {
  strategyId: string;
  owner: string;
  agent: string;
  inputToken: string;
  outputToken: string;
  router: string;
  /** Whole units of the desk's input, as decimal strings. */
  maxAmountPerTrade: string;
  maxTotalSpend: string;
  spent: string;
  available: string;
  expiresAt: string;
  maxSlippageBps: number;
  paused: boolean;
  revoked: boolean;
  /** The owner's delegated wallet is this strategy's agent. */
  forTrader: boolean;
}

export interface DeskRails {
  chain: string;
  chainId: number;
  vault: string;
  input: { symbol: string; address: string; decimals: number };
  routers: string[];
  /** The owner's delegated wallet, with its gas, or null before they delegate one. */
  trader: { address: string; gas: string; gasSymbol: string } | null;
  rails: DeskRail[];
}

export interface PreparedOrder {
  vault: string;
  chainId: number;
  execution: {
    strategyId: string;
    amountIn: string;
    quotedAmountOut: string;
    minAmountOut: string;
    deadline: string;
    signalHash: string;
    quoteHash: string;
    calldataHash: string;
    nonce: string;
  };
  routerCalldata: string;
  signature: string;
  tokenOut: string;
  requestId?: string;
  routing?: string;
}

export interface OrderReceipt {
  hash: string;
  from: string;
  chainId: number;
  explorerUrl: string | null;
  status: "success" | "reverted" | "pending";
  amountOut: string | null;
  summary: { venue: string; strategyId: string; amount: number; inputSymbol: string; tokenOut: string; minAmountOut: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export class DeskOrders {
  constructor(private readonly client: PerkosClient) {}

  private path(module: string, rest: string): string {
    return `/desks/${encodeURIComponent(module)}/${rest}`;
  }

  /** The owner's strategies in the desk's vault, and the Trader's wallet. Read from the chain each time. */
  async rails(module: string): Promise<DeskRails> {
    const body = await this.client.request<Record<string, unknown>>(this.path(module, "rails"));
    if (!Array.isArray(body.rails) || !isObject(body.input) || typeof body.vault !== "string") {
      throw new PerkosApiError("PerkOS answered rails this version cannot read", 502, "RAILS_SHAPE");
    }
    return body as unknown as DeskRails;
  }

  /** Ask the desk for an order on one strategy: the quote, the route and the risk co-signature. */
  async prepare(module: string, input: { strategyId: string; amountIn: string; signal: string }): Promise<PreparedOrder> {
    const body = await this.client.request<{ order?: unknown }>(this.path(module, "orders/prepare"), {
      method: "POST",
      body: input,
      timeoutMs: 50_000,
    });
    const order = body.order;
    if (!isObject(order) || !isObject(order.execution) || typeof order.routerCalldata !== "string" || typeof order.signature !== "string") {
      throw new PerkosApiError("The desk answered an order this version cannot read", 502, "ORDER_SHAPE");
    }
    return order as unknown as PreparedOrder;
  }

  /** Send an approved order from the owner's delegated wallet, and wait for it on chain. */
  async execute(module: string, order: PreparedOrder, reason: string): Promise<OrderReceipt> {
    const body = await this.client.request<Record<string, unknown>>(this.path(module, "orders/execute"), {
      method: "POST",
      body: { execution: order.execution, routerCalldata: order.routerCalldata, signature: order.signature, reason },
      timeoutMs: 90_000,
    });
    if (typeof body.hash !== "string") {
      throw new PerkosApiError("PerkOS answered a receipt this version cannot read", 502, "RECEIPT_SHAPE");
    }
    return body as unknown as OrderReceipt;
  }
}

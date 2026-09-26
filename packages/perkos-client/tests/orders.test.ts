/**
 * Orders on a vault desk: the client reads the owner's rails, asks the desk
 * to prepare an order, and sends only what the desk prepared.
 */

import { describe, expect, it, vi } from "vitest";

import { DeskOrders, PerkosClient, type PreparedOrder } from "../src/index.ts";

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const ordersWith = (http: typeof fetch) => new DeskOrders(new PerkosClient({ fetchImpl: http, token: () => "session-token" }));

const order: PreparedOrder = {
  vault: "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
  chainId: 4663,
  execution: {
    strategyId: "25",
    amountIn: "1000000",
    quotedAmountOut: "4200",
    minAmountOut: "4158",
    deadline: "1800000300",
    signalHash: `0x${"11".repeat(32)}`,
    quoteHash: `0x${"22".repeat(32)}`,
    calldataHash: `0x${"33".repeat(32)}`,
    nonce: "0",
  },
  routerCalldata: "0x3593564c",
  signature: "0xabcd",
  tokenOut: "0x00000000000000000000000000000000000000d4",
};

describe("vault desk orders", () => {
  it("reads the rails of the desk's module", async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/rails");
      return reply(200, { ok: true, vault: order.vault, input: { symbol: "USDG", address: "0x5fc5", decimals: 6 }, rails: [], trader: null });
    });
    await expect(ordersWith(http as typeof fetch).rails("stocks-robinhood")).resolves.toMatchObject({ rails: [], trader: null });
  });

  it("asks the desk to prepare an order and returns what it prepared", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/orders/prepare");
      expect(JSON.parse(String(init?.body))).toEqual({ strategyId: "25", amountIn: "1000000", signal: "Buy $1" });
      return reply(200, { ok: true, order });
    });
    await expect(ordersWith(http as typeof fetch).prepare("stocks-robinhood", { strategyId: "25", amountIn: "1000000", signal: "Buy $1" })).resolves.toEqual(order);
  });

  it("sends exactly the prepared order, with the reason, and returns the receipt", async () => {
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ execution: order.execution, routerCalldata: order.routerCalldata, signature: order.signature, reason: "Risk GO" });
      return reply(200, { ok: true, hash: "0xfeed", status: "success", amountOut: "4200", explorerUrl: null, chainId: 4663, from: "0x6732", summary: {} });
    });
    await expect(ordersWith(http as typeof fetch).execute("stocks-robinhood", order, "Risk GO")).resolves.toMatchObject({ hash: "0xfeed", status: "success" });
  });

  it("refuses an answer it cannot read", async () => {
    const http = vi.fn(async () => reply(200, { ok: true, order: { nope: true } }));
    await expect(ordersWith(http as typeof fetch).prepare("stocks-robinhood", { strategyId: "1", amountIn: "1", signal: "x" })).rejects.toMatchObject({ code: "ORDER_SHAPE" });
  });
});

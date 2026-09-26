/**
 * The receipt of a buy that followed a desk turn's plan: kept with the turn's
 * record, and in this window for the Auditor's card at once.
 */

import type { BuyReceipt } from "@perkos/client";
import { describe, expect, it, vi } from "vitest";

import type { BuyOutcome } from "../app/desks/trade";
import { keepTurnReceipt, sendBuyForTurn, subscribeTurnReceipts, turnReceipt } from "../app/desks/turnReceipts";

const swap = (o: Partial<BuyReceipt> = {}): BuyOutcome => ({
  kind: "receipt",
  receipt: { status: "success", bought: true, hash: "0xfeed", explorerUrl: null, amountOut: "1", steps: [], notice: null, ...o },
});
const order = { ticker: "NVDA", amountUsdg: "50" };

describe("keeping a buy's receipt with its turn", () => {
  it("shows it here at once and sends it to the turn's record", async () => {
    const heard = vi.fn();
    const stop = subscribeTurnReceipts(heard);
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("/api/desks/turns?id=20260926-143200-ab12");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body)).receipt).toMatchObject({ hash: "0xfeed", status: "success", ticker: "NVDA", amount: "50" });
      return Response.json({ ok: true });
    });
    await expect(keepTurnReceipt("20260926-143200-ab12", swap(), order, http as unknown as typeof fetch)).resolves.toBe(true);
    expect(turnReceipt("20260926-143200-ab12")).toMatchObject({ hash: "0xfeed", ticker: "NVDA", amount: "50" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(turnReceipt("20260926-143200-0000")).toBeNull();
    expect(turnReceipt(null)).toBeNull();
    stop();
  });

  it("keeps it here even when the record does not take it, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refused = vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 }));
    await expect(keepTurnReceipt("20260926-143300-ab12", swap({ status: "pending", bought: null }), order, refused as unknown as typeof fetch)).resolves.toBe(false);
    expect(turnReceipt("20260926-143300-ab12")).toMatchObject({ status: "pending" });
    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(keepTurnReceipt("20260926-143400-ab12", swap(), order, down as unknown as typeof fetch)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("keeps nothing and sends nothing when no swap went out", async () => {
    const http = vi.fn();
    await expect(keepTurnReceipt("20260926-143500-ab12", { kind: "unconfirmed", message: "x" }, order, http as unknown as typeof fetch)).resolves.toBe(false);
    await expect(keepTurnReceipt("20260926-143500-ab12", swap({ status: "not_sent", bought: false, hash: null }), order, http as unknown as typeof fetch)).resolves.toBe(false);
    expect(http).not.toHaveBeenCalled();
    expect(turnReceipt("20260926-143500-ab12")).toBeNull();
  });
});

describe("sending a buy from a turn's plan", () => {
  const order = { module: "stocks-robinhood", ticker: "NVDA", amountUsdg: "50", maxSlippageBps: 100, quotedAmountOut: "4200000000000000" };
  const answer = { status: "success", bought: true, hash: "0xbeef", explorerUrl: null, amountOut: "1", steps: [], notice: null };

  it("sends the buy with its turn, then keeps the receipt with that turn", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body)) });
      return String(url) === "/api/desks/buy" ? Response.json({ receipt: answer }) : Response.json({ ok: true });
    });
    const outcome = await sendBuyForTurn({ ...order, turnId: "20260926-143600-ab12" }, http as unknown as typeof fetch);
    expect(outcome).toMatchObject({ kind: "receipt", receipt: { hash: "0xbeef" } });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ url: "/api/desks/buy", method: "POST", body: { turnId: "20260926-143600-ab12" } });
    expect(calls[1]).toMatchObject({ url: "/api/desks/turns?id=20260926-143600-ab12", method: "PATCH", body: { receipt: { hash: "0xbeef", ticker: "NVDA", amount: "50" } } });
    expect(turnReceipt("20260926-143600-ab12")).toMatchObject({ hash: "0xbeef" });
  });

  it("sends a buy that follows no plan as it is, and keeps nothing", async () => {
    const http = vi.fn(async () => Response.json({ receipt: answer }));
    await expect(sendBuyForTurn(order, http as unknown as typeof fetch)).resolves.toMatchObject({ kind: "receipt" });
    expect(http).toHaveBeenCalledTimes(1);
  });
});

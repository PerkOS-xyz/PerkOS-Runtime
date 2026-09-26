/**
 * The Trader's verdicts: why a buy cannot run, whether a quote is the order
 * that was asked for, how long it stays good, what an answer to a buy or a
 * transfer home means, and the runs that outlive the sheet.
 */

import type { BuyReceipt, DeskQuote, DeskTrader } from "@perkos/client";
import { describe, expect, it, vi } from "vitest";

import { buyRun, dismissBuy, startBuy, subscribeBuys, type BuySummary } from "../app/desks/buyStore";
import { createRunStore } from "../app/desks/runStore";
import { dismissSweep, startSweep, sweepRun } from "../app/desks/sweepStore";
import {
  arrived,
  BUY_WAIT_MS,
  buyBlocker,
  buyOutcome,
  capNote,
  DISMISS_AFTER_MS,
  fundsOf,
  heldOf,
  MAX_SLIPPAGE_BPS,
  mayDismiss,
  minAfterSlippage,
  priceCheck,
  QUOTE_TTL_S,
  quoteMismatch,
  quoteSecondsLeft,
  readable,
  receiptView,
  sendBuy,
  sendSweep,
  SLIPPAGE_BPS,
  SLIPPAGE_CHOICES,
  slippageOk,
  SWEEP_UNCONFIRMED,
  sweepOutcome,
  sweepUnsettled,
  sweepView,
  toUnits,
  UNCONFIRMED,
  unresolved,
  type BuyOutcome,
} from "../app/desks/trade";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const trader = (o: Partial<DeskTrader> = {}): DeskTrader => ({
  delegated: true,
  wallet: "0x6732c0829808e8286012f53462013104289025b4",
  chainId: 4663,
  gas: { ok: true, wei: "500000000000000" },
  balances: [
    { symbol: "USDG", address: USDG, decimals: 6, amount: "25000000" },
    { symbol: "ETH", address: null, decimals: 18, amount: "500000000000000" },
    { symbol: "NVDA", address: NVDA, decimals: 18, amount: "4158000000000000" },
    { symbol: "AAPL", address: "0x00000000000000000000000000000000000000a1", decimals: 18, amount: "0" },
  ],
  cap: 25,
  capBy: "platform",
  capReason: "no-owner-limit",
  input: { symbol: "USDG", address: USDG, decimals: 6 },
  marketAvailable: true,
  ...o,
});

describe("what the delegated wallet holds", () => {
  it("splits USDG, the gas and what the Trader bought", () => {
    const f = fundsOf(trader());
    expect(f.usdg?.amount).toBe("25000000");
    expect(f.gasWei).toBe("500000000000000");
    expect(f.stocks.map((s) => s.symbol)).toEqual(["NVDA"]);
  });

  it("finds USDG by the address the desk pays with, not by a symbol a stock could share", () => {
    const lookalike = { symbol: "USDG", address: "0x00000000000000000000000000000000000000bd", decimals: 6, amount: "1" };
    const f = fundsOf(trader({ balances: [lookalike, ...trader().balances] }));
    expect(f.usdg?.address).toBe(USDG);
    expect(fundsOf(trader({ input: null })).usdg?.address).toBe(USDG);
  });

  it("reads amounts the way the chain counts them", () => {
    expect(readable("4158000000000000", 18)).toBe("0.004158");
    expect(readable("25000000", 6, 2)).toBe("25");
    expect(toUnits(1.5, 6)).toBe("1500000");
    expect(minAfterSlippage("4200000000000000", 100)).toBe("4158000000000000");
  });

  it("says how much of a token the wallet holds, zero when PerkOS lists none", () => {
    expect(heldOf(trader(), NVDA.toUpperCase().replace("0X", "0x"))).toBe("4158000000000000");
    expect(heldOf(trader(), "0x00000000000000000000000000000000000000ff")).toBe("0");
    expect(heldOf(null, NVDA)).toBe("0");
  });
});

describe("why a buy cannot run", () => {
  it("says it in words: no access, no USDG, no gas, over the cap or the balance", () => {
    expect(buyBlocker(null, 1)).toMatch(/not been read yet/);
    expect(buyBlocker(trader({ delegated: false, wallet: null }), 1)).toMatch(/Give the Trader access/);
    expect(buyBlocker(trader({ balances: [] }), 1)).toMatch(/holds no USDG/);
    expect(buyBlocker(trader({ gas: { ok: false, wei: "0" } }), 1)).toMatch(/ETH on Robinhood Chain for gas/);
    expect(buyBlocker(trader({ cap: 0 }), 1)).toMatch(/not set how much one order may spend/);
    expect(buyBlocker(trader(), Number.NaN)).toMatch(/how much USDG/);
    expect(buyBlocker(trader({ cap: 5 }), 6)).toBe("One order can spend up to 5 USDG.");
    expect(buyBlocker(trader({ cap: 50 }), 30)).toBe("The delegated wallet holds 25 USDG.");
    expect(buyBlocker(trader(), 1)).toBeNull();
  });
});

describe("the line under the cap", () => {
  it("says why the cap is whose it is, from the reason PerkOS gives", () => {
    expect(capNote(trader({ cap: 10, capBy: "owner", capReason: "owner-limit" }))).toMatch(/^Your limit: up to 10 USDG an order, saved with your Dynamic signer rule/);
    expect(capNote(trader({ cap: 100, capReason: "no-rule-for-chain" }))).toBe(
      "Your saved limit does not cover Robinhood Chain yet, so the PerkOS limit applies on Robinhood Chain for now: up to 100 USDG an order.",
    );
    expect(capNote(trader({ cap: 100, capReason: "owner-limit-above-platform" }))).toMatch(/at or above the most PerkOS allows, so each order is capped at 100 USDG/);
    expect(capNote(trader({ cap: 100, capReason: "no-owner-limit" }))).toBe("No limit of yours yet: PerkOS caps each order at 100 USDG. Set yours with Edit limits.");
  });

  it("never claims the owner has no limit when PerkOS did not say so", () => {
    expect(capNote(trader({ cap: 100, capBy: "platform", capReason: null }))).toBe("PerkOS caps each order at 100 USDG.");
    expect(capNote(trader({ cap: 10, capBy: "owner", capReason: null }))).toMatch(/^Your limit: up to 10 USDG/);
    expect(capNote(trader({ cap: 0, capReason: "no-owner-limit" }))).toMatch(/buying waits/);
    for (const reason of ["owner-limit", "no-rule-for-chain", "owner-limit-above-platform", "no-owner-limit", null] as const) {
      expect(capNote(trader({ cap: 100, capReason: reason }))).not.toMatch(/\u2014/);
    }
  });
});

describe("a quote is the order that was asked for", () => {
  const asset = { ticker: "NVDA", address: NVDA, decimals: 18 };
  const ask = { asset, amount: 1, usdgAddress: USDG };
  const q = (o: Partial<DeskQuote> = {}): DeskQuote => ({
    chainId: 4663,
    ticker: "NVDA",
    tokenIn: { symbol: "USDG", address: USDG, decimals: 6 },
    tokenOut: { symbol: "NVDA", address: NVDA, decimals: 18 },
    amountIn: "1000000",
    amountOut: "5500000000000000",
    priceImpactPct: 0.1,
    routing: "CLASSIC",
    protocols: ["V4"],
    requestId: "req-1",
    quotedAt: null,
    gasFeeUsd: null,
    ...o,
  });

  it("takes a quote for this stock, this amount of the wallet's USDG, on Robinhood Chain", () => {
    expect(quoteMismatch(q(), ask)).toBeNull();
    expect(quoteMismatch(q({ chainId: null }), ask)).toBeNull();
    expect(quoteMismatch(q({ ticker: "nvda", tokenOut: { symbol: "NVDA", address: NVDA.toUpperCase().replace("0X", "0x"), decimals: 18 } }), ask)).toBeNull();
  });

  it("refuses another chain, another stock, or a ticker it did not name", () => {
    expect(quoteMismatch(q({ chainId: 1 }), ask)).toMatch(/chain 1, not on Robinhood Chain/);
    expect(quoteMismatch(q({ ticker: "AAPL" }), ask)).toMatch(/another stock, not NVDA/);
    expect(quoteMismatch(q({ ticker: null }), ask)).toBe("The desk did not say which stock it priced.");
    expect(quoteMismatch(q({ tokenOut: { symbol: "NVDA", address: USDG, decimals: 18 } }), ask)).toMatch(/another stock/);
  });

  it("refuses a stock or USDG counted in other decimals, which would move the minimum by powers of ten", () => {
    expect(quoteMismatch(q({ tokenOut: { symbol: "NVDA", address: NVDA, decimals: 6 } }), ask)).toMatch(/counts NVDA in 6 decimals and the market in 18/);
    expect(quoteMismatch(q({ tokenIn: { symbol: "USDG", address: USDG, decimals: 18 } }), ask)).toMatch(/counts USDG in 18 decimals, not 6/);
  });

  it("refuses another payment token, an unknown one, or another amount", () => {
    expect(quoteMismatch(q({ tokenIn: { symbol: "USDG", address: NVDA, decimals: 6 } }), ask)).toMatch(/not the wallet's USDG/);
    expect(quoteMismatch(q(), { ...ask, usdgAddress: null })).toMatch(/not the wallet's USDG/);
    expect(quoteMismatch(q({ amountIn: "1000001" }), ask)).toMatch(/different amount of USDG/);
  });

  it("blocks the hold when the price the quote implies is more than 5% from the market's", () => {
    // 1 USDG for 0.0055 NVDA is about $181.82 a share.
    expect(priceCheck(q(), { ticker: "NVDA", priceUsd: 180 })).toMatchObject({ reference: 180, blocked: null });
    expect(priceCheck(q(), { ticker: "NVDA", priceUsd: 180 }).implied).toBeCloseTo(181.818, 2);
    const dear = priceCheck(q(), { ticker: "NVDA", priceUsd: 170 });
    expect(dear.gapPct).toBeCloseTo(6.95, 1);
    expect(dear.blocked).toBe(
      "This quote prices NVDA at $181.82 a share, 7.0% above the market's $170.00. That is more than 5% away, so it cannot be approved. Get a new quote in a moment.",
    );
    expect(priceCheck(q(), { ticker: "NVDA", priceUsd: 200 }).blocked).toMatch(/9\.1% below the market's \$200\.00/);
    // A decimals slip shows up as a price far off, even when the other checks pass.
    expect(priceCheck(q({ amountOut: "5500000000000000000" }), { ticker: "NVDA", priceUsd: 180 }).blocked).toMatch(/below the market's/);
  });

  it("does not block without a market price, and says so instead", () => {
    expect(priceCheck(q(), { ticker: "NVDA", priceUsd: null })).toMatchObject({ reference: null, gapPct: null, blocked: null });
  });
});

describe("slippage", () => {
  it("starts at 1% and never goes past 3%", () => {
    expect(SLIPPAGE_BPS).toBe(100);
    expect(MAX_SLIPPAGE_BPS).toBe(300);
    expect(SLIPPAGE_CHOICES).toContain(SLIPPAGE_BPS);
    expect(Math.max(...SLIPPAGE_CHOICES)).toBe(MAX_SLIPPAGE_BPS);
    expect(SLIPPAGE_CHOICES.every(slippageOk)).toBe(true);
    for (const bad of [0, 301, 500, 1.5, "100", null]) expect(slippageOk(bad)).toBe(false);
  });
});

describe("the quote countdown", () => {
  it("counts about 285 s from when the quote arrived here, on one clock", () => {
    expect(QUOTE_TTL_S).toBe(285);
    expect(quoteSecondsLeft(10_000, 10_000)).toBe(285);
    expect(quoteSecondsLeft(10_000, 10_999)).toBe(285);
    expect(quoteSecondsLeft(10_000, 11_000)).toBe(284);
    expect(quoteSecondsLeft(10_000, 10_000 + 285_000)).toBe(0);
    expect(quoteSecondsLeft(10_000, 10_000 + 900_000)).toBe(0);
    // A clock read before the quote arrived never adds time.
    expect(quoteSecondsLeft(10_000, 5_000)).toBe(285);
  });
});

const receipt = (o: Partial<BuyReceipt> = {}): BuyReceipt => ({
  status: "success",
  bought: true,
  hash: "0xfeed",
  explorerUrl: null,
  amountOut: "4190000000000000",
  steps: [{ kind: "swap", hash: "0xfeed", status: "success", explorerUrl: null }],
  notice: null,
  ...o,
});

describe("what an answer to a buy means", () => {
  it("keeps a receipt, whatever happened to the swap", () => {
    expect(buyOutcome(200, { receipt: receipt() })).toEqual({ kind: "receipt", receipt: receipt() });
    for (const r of [
      receipt({ status: "pending", bought: null }),
      receipt({ status: "reverted", bought: false }),
      receipt({ status: "not_sent", bought: false, hash: null, steps: [{ kind: "approve", hash: "0xa11", status: "success", explorerUrl: null }] }),
    ]) {
      expect(buyOutcome(200, { receipt: r })).toEqual({ kind: "receipt", receipt: r });
    }
  });

  it("says what to do for each refusal PerkOS gives before it signs, and keeps its detail", () => {
    expect(buyOutcome(409, { error: "TRADER_NEEDS_GAS", message: "0x6732… needs ETH" })).toEqual({
      kind: "refused",
      code: "TRADER_NEEDS_GAS",
      message: "The delegated wallet needs a little ETH on Robinhood Chain for gas.",
      detail: "0x6732… needs ETH",
    });
    for (const code of ["NO_DELEGATION", "OVER_LIMIT", "STALE_ORDER", "SIGNER_REFUSED", "DESK_UNAVAILABLE", "ORDER_IN_FLIGHT"]) {
      expect(buyOutcome(code === "DESK_UNAVAILABLE" ? 503 : 409, { error: code, message: "x" })).toMatchObject({ kind: "refused", code });
    }
    expect(buyOutcome(409, { error: "STALE_ORDER", message: "x" })).toMatchObject({ message: expect.stringMatching(/less than the least you accept/) });
    expect(buyOutcome(400, { error: "input", message: "The order needs a desk" })).toMatchObject({ kind: "refused", message: "The order needs a desk" });
  });

  it("reads PerkOS's other refusals, which it gives only before a broadcast, in its own words", () => {
    expect(buyOutcome(502, { error: "ORDER_FAILED", message: "The order could not be sent. Nothing was bought." })).toEqual({
      kind: "refused",
      code: "ORDER_FAILED",
      message: "The order could not be sent. Nothing was bought.",
      detail: "",
    });
    expect(buyOutcome(503, { error: "CHAIN_UNAVAILABLE", message: "Robinhood Chain did not answer." })).toMatchObject({ kind: "refused" });
    expect(buyOutcome(409, { error: "INSUFFICIENT_FUNDS", message: "The wallet holds 0.5 USDG" })).toMatchObject({ kind: "refused", message: "The wallet holds 0.5 USDG" });
  });

  it("never reads a lost answer or one it cannot read after the hold as a failure", () => {
    const unconfirmed = { kind: "unconfirmed", message: UNCONFIRMED };
    expect(buyOutcome(502, { error: "PERKOS_UNREACHABLE", message: "PerkOS did not answer: timed out" })).toEqual(unconfirmed);
    expect(buyOutcome(502, { error: "RECEIPT_SHAPE", message: "PerkOS answered a receipt this version cannot read" })).toEqual(unconfirmed);
    expect(buyOutcome(500, { error: "internal", message: "boom" })).toEqual(unconfirmed);
    expect(buyOutcome(504, null)).toEqual(unconfirmed);
    expect(buyOutcome(408, {})).toEqual(unconfirmed);
    expect(buyOutcome(200, { receipt: { hash: "0xfeed", status: "success" } })).toEqual(unconfirmed);
    expect(buyOutcome(200, { receipt: { ...receipt(), status: "mined" } })).toEqual(unconfirmed);
    expect(buyOutcome(200, { receipt: { ...receipt(), bought: "yes" } })).toEqual(unconfirmed);
    expect(UNCONFIRMED).toBe("We could not confirm the order. Check the explorer before trying again.");
  });

  it("sends the order as approved, the quote included, and waits at least 180 s for it", async () => {
    expect(BUY_WAIT_MS).toBeGreaterThanOrEqual(180_000);
    const order = { module: "stocks-robinhood", ticker: "NVDA", amountUsdg: "1", maxSlippageBps: 100, quotedAmountOut: "4200000000000000" };
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("/api/desks/buy");
      expect(JSON.parse(String(init?.body))).toEqual(order);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ receipt: receipt() }, { status: 200 });
    });
    await expect(sendBuy(order, http as unknown as typeof fetch)).resolves.toEqual({ kind: "receipt", receipt: receipt() });
  });

  it("turns a network failure or a wait that ran out into an unconfirmed order", async () => {
    const order = { module: "stocks-robinhood", ticker: "NVDA", amountUsdg: "1", maxSlippageBps: 100, quotedAmountOut: "4200000000000000" };
    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(sendBuy(order, down as unknown as typeof fetch)).resolves.toEqual({ kind: "unconfirmed", message: UNCONFIRMED });
    const late = vi.fn(async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    await expect(sendBuy(order, late as unknown as typeof fetch)).resolves.toEqual({ kind: "unconfirmed", message: UNCONFIRMED });
  });
});

describe("how a buy's receipt reads", () => {
  const approve = (status: BuyReceipt["steps"][number]["status"]) => ({ kind: "approve", hash: "0xa11", status, explorerUrl: null });
  const permit2 = (status: BuyReceipt["steps"][number]["status"]) => ({ kind: "permit2", hash: "0xb22", status, explorerUrl: null });

  it("calls only a confirmed swap a purchase", () => {
    expect(receiptView(receipt())).toMatchObject({ tone: "success", title: "Bought" });
  });

  it("never calls a swap that is not confirmed yet either bought or not bought", () => {
    expect(receiptView(receipt({ status: "pending", bought: null, amountOut: null }))).toEqual({
      tone: "pending",
      title: "Sent, not confirmed yet",
      body: "The swap went out and may still buy. Check the explorer before placing another order.",
    });
  });

  it("never says a swap went out when no swap hash came back", () => {
    // A verdict PerkOS did not back up (not sent, yet "bought") reads as unknown, and says so plainly.
    expect(receiptView(receipt({ status: "not_sent", bought: null, hash: null, amountOut: null, steps: [] }))).toEqual({
      tone: "pending",
      title: "Not confirmed",
      body: "PerkOS did not say whether the swap went out. Check the explorer before placing another order.",
    });
  });

  it("keeps its own words for a swap that may still buy, whatever PerkOS adds", () => {
    const view = receiptView(receipt({ status: "pending", bought: null, amountOut: null, notice: "The swap was sent and is not confirmed yet." }));
    expect(view.body).toBe("The swap went out and may still buy. Check the explorer before placing another order.");
  });

  it("says a reverted swap bought nothing and cost only gas, or says it as PerkOS did", () => {
    expect(receiptView(receipt({ status: "reverted", bought: false, amountOut: null }))).toMatchObject({
      tone: "reverted",
      title: "Robinhood Chain reverted the swap",
      body: "Nothing was bought; the wallet paid only the gas.",
    });
    expect(receiptView(receipt({ status: "reverted", bought: false, amountOut: null, notice: "The swap failed on chain, so nothing was bought." })).body).toBe(
      "The swap failed on chain, so nothing was bought.",
    );
  });

  it("says exactly what went out when the order stopped before the swap", () => {
    const stopped = (steps: BuyReceipt["steps"], notice: string | null = null) => receiptView(receipt({ status: "not_sent", bought: false, hash: null, amountOut: null, steps, notice }));
    expect(stopped([approve("success")])).toEqual({ tone: "stopped", title: "Nothing was bought", body: "An approval went out, and the swap was not sent." });
    expect(stopped([approve("success"), permit2("success")]).body).toBe("The approvals went out, and the swap was not sent.");
    expect(stopped([approve("success"), permit2("reverted")]).body).toBe("An approval failed on chain, so the swap was not sent.");
    expect(stopped([approve("pending")])).toEqual({ tone: "pending", title: "An approval is on its way", body: "Nothing was bought, and the swap was not sent." });
    // Nothing went out at all: no claim about an approval.
    expect(stopped([]).body).toBe("Nothing was sent.");
  });

  it("gives PerkOS's own sentence about a stopped order once, not next to a copy of it", () => {
    const notice = "The approval went out, but the swap was not sent and nothing was bought. The price moved: ask for a new quote";
    expect(receiptView(receipt({ status: "not_sent", bought: false, hash: null, amountOut: null, steps: [approve("success")], notice }))).toEqual({
      tone: "stopped",
      title: "Nothing was bought",
      body: `${notice}.`,
    });
    // The title still follows the steps: an approval on its way is not "nothing".
    expect(receiptView(receipt({ status: "not_sent", bought: false, hash: null, amountOut: null, steps: [approve("pending")], notice: "Buy again once it lands!" }))).toEqual({
      tone: "pending",
      title: "An approval is on its way",
      body: "Buy again once it lands!",
    });
  });
});

describe("a buy that may be on chain", () => {
  it("is one that is not confirmed yet, or has no answer at all", () => {
    expect(unresolved({ kind: "unconfirmed", message: UNCONFIRMED })).toBe(true);
    expect(unresolved({ kind: "receipt", receipt: receipt({ status: "pending", bought: null }) })).toBe(true);
    expect(unresolved({ kind: "receipt", receipt: receipt() })).toBe(false);
    expect(unresolved({ kind: "receipt", receipt: receipt({ status: "reverted", bought: false }) })).toBe(false);
    expect(unresolved({ kind: "refused", code: "STALE_ORDER", message: "x", detail: "" })).toBe(false);
  });

  it("tells when the stock arrived by what the wallet holds now", () => {
    expect(arrived("100", "250")).toBe("150");
    expect(arrived("100", "100")).toBeNull();
    expect(arrived("100", "40")).toBeNull();
  });

  it("stays on screen until the stock arrives or a minute has passed", () => {
    const pending: BuyOutcome = { kind: "receipt", receipt: receipt({ status: "pending", bought: null }) };
    expect(mayDismiss(pending, 5_000, false)).toBe(false);
    expect(mayDismiss(pending, 5_000, true)).toBe(true);
    expect(mayDismiss(pending, DISMISS_AFTER_MS, false)).toBe(true);
    expect(mayDismiss({ kind: "unconfirmed", message: UNCONFIRMED }, 0, false)).toBe(false);
    expect(mayDismiss({ kind: "receipt", receipt: receipt() }, 0, false)).toBe(true);
    expect(mayDismiss({ kind: "refused", code: "STALE_ORDER", message: "x", detail: "" }, 0, false)).toBe(true);
  });
});

describe("sending a token home", () => {
  const sent = (status: "success" | "pending" | "reverted") => ({ hash: "0xbeef", status, explorerUrl: null });

  it("reads each status for what it is", () => {
    expect(sweepView(sent("success"), "NVDA")).toBe("Sent your NVDA home.");
    expect(sweepView(sent("pending"), "NVDA")).toBe("Your NVDA is on its way home. Check the explorer before sending it again.");
    expect(sweepView(sent("reverted"), "NVDA")).toBe("Robinhood Chain reverted the transfer: your NVDA stayed in the delegated wallet, which paid only the gas.");
  });

  it("treats only a 4xx as nothing sent, and any other answer as unconfirmed", () => {
    expect(sweepOutcome(200, { receipt: sent("reverted") })).toEqual({ kind: "receipt", receipt: sent("reverted") });
    expect(sweepOutcome(409, { error: "NOTHING_TO_SWEEP", message: "The Trader's wallet holds none of this token" })).toMatchObject({
      kind: "refused",
      message: "The Trader's wallet holds none of this token",
    });
    expect(sweepOutcome(409, { error: "ORDER_IN_FLIGHT", message: "busy" })).toMatchObject({ kind: "refused", code: "ORDER_IN_FLIGHT" });
    expect(sweepOutcome(401, { error: "signed_out", message: "Sign in to PerkOS first." })).toMatchObject({ kind: "refused", message: "Sign in to PerkOS first." });
    const unconfirmed = { kind: "unconfirmed", message: SWEEP_UNCONFIRMED };
    // A 5xx is unconfirmed even with a code a buy would trust: the person checks the explorer before sending again.
    expect(sweepOutcome(502, { error: "ORDER_FAILED", message: "The transfer could not be sent. Nothing moved." })).toEqual(unconfirmed);
    expect(sweepOutcome(503, { error: "CHAIN_UNAVAILABLE", message: "Robinhood Chain did not answer." })).toEqual(unconfirmed);
    expect(sweepOutcome(503, { error: "DESK_UNAVAILABLE", message: "The desk is not answering." })).toEqual(unconfirmed);
    expect(sweepOutcome(502, { error: "PERKOS_UNREACHABLE", message: "PerkOS did not answer: timed out" })).toEqual(unconfirmed);
    expect(sweepOutcome(408, {})).toEqual(unconfirmed);
    expect(sweepOutcome(504, null)).toEqual(unconfirmed);
    expect(sweepOutcome(200, { receipt: { hash: "0xbeef", status: "mined" } })).toEqual(unconfirmed);
  });

  it("keeps Send home off while a transfer may still land", () => {
    expect(sweepUnsettled({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED })).toBe(true);
    expect(sweepUnsettled({ kind: "receipt", receipt: sent("pending") })).toBe(true);
    expect(sweepUnsettled({ kind: "receipt", receipt: sent("success") })).toBe(false);
    expect(sweepUnsettled({ kind: "receipt", receipt: sent("reverted") })).toBe(false);
    expect(sweepUnsettled({ kind: "refused", code: "NOTHING_TO_SWEEP", message: "x", detail: "" })).toBe(false);
  });

  it("names only the token, and turns a lost answer into an unconfirmed transfer", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("/api/desks/sweep");
      expect(JSON.parse(String(init?.body))).toEqual({ module: "stocks-robinhood", token: NVDA });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ receipt: sent("pending") }, { status: 200 });
    });
    await expect(sendSweep({ module: "stocks-robinhood", token: NVDA }, http as unknown as typeof fetch)).resolves.toEqual({ kind: "receipt", receipt: sent("pending") });
    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(sendSweep({ module: "stocks-robinhood", token: NVDA }, down as unknown as typeof fetch)).resolves.toEqual({
      kind: "unconfirmed",
      message: SWEEP_UNCONFIRMED,
    });
  });
});

describe("a buy that outlives the sheet", () => {
  const summary: BuySummary = {
    ticker: "NVDA",
    amountUsdg: "1",
    tokenOut: { symbol: "NVDA", address: NVDA, decimals: 18 },
    quotedAmountOut: "4200000000000000",
    minAmountOut: "4158000000000000",
    maxSlippageBps: 100,
    heldBefore: "0",
  };

  it("keeps the outcome after whoever started it is gone, until the owner dismisses it", async () => {
    let finish: (o: BuyOutcome) => void = () => undefined;
    const heard = vi.fn();
    const stop = subscribeBuys(heard);
    const run = startBuy("desk-a", summary, () => new Promise<BuyOutcome>((resolve) => (finish = resolve)));
    expect(run?.outcome).toBeNull();
    expect(run?.answeredAt).toBeNull();
    expect(buyRun("desk-a")?.id).toBe(run?.id);
    // A second hold while the first is in flight starts nothing.
    expect(startBuy("desk-a", summary, async () => ({ kind: "unconfirmed", message: UNCONFIRMED }))).toBeNull();
    // Nor can the one in flight be dismissed.
    dismissBuy("desk-a");
    expect(buyRun("desk-a")).not.toBeNull();
    finish({ kind: "receipt", receipt: receipt() });
    await vi.waitFor(() => expect(buyRun("desk-a")?.outcome).toMatchObject({ kind: "receipt" }));
    expect(buyRun("desk-a")?.answeredAt).toEqual(expect.any(Number));
    expect(heard).toHaveBeenCalledTimes(2);
    dismissBuy("desk-a");
    expect(buyRun("desk-a")).toBeNull();
    stop();
  });

  it("reads a send that throws as unconfirmed, never as nothing sent", async () => {
    startBuy("desk-b", summary, async () => {
      throw new Error("lost");
    });
    await vi.waitFor(() => expect(buyRun("desk-b")?.outcome).toEqual({ kind: "unconfirmed", message: UNCONFIRMED }));
    dismissBuy("desk-b");
  });

  it("keeps each desk's buy apart", async () => {
    startBuy("desk-c", summary, async () => ({ kind: "unconfirmed", message: UNCONFIRMED }));
    expect(buyRun("desk-d")).toBeNull();
    await vi.waitFor(() => expect(buyRun("desk-c")?.outcome).not.toBeNull());
    dismissBuy("desk-c");
  });

  it("stamps when the answer arrived, on the clock it is given", async () => {
    let t = 1_000;
    const store = createRunStore<string, string>("lost", () => t);
    store.start("desk-e", "order", async () => {
      t = 4_000;
      return "done";
    });
    await vi.waitFor(() => expect(store.get("desk-e")).toMatchObject({ outcome: "done", answeredAt: 4_000 }));
  });
});

describe("a transfer home that outlives the sheet", () => {
  it("keeps Send home busy while it is in flight, and its outcome until the owner puts it away", async () => {
    let finish: (o: { kind: "unconfirmed"; message: string }) => void = () => undefined;
    const run = startSweep("desk-s", { symbol: "NVDA", token: NVDA }, () => new Promise((resolve) => (finish = resolve)));
    expect(sweepRun("desk-s")).toMatchObject({ id: run?.id, outcome: null, summary: { token: NVDA } });
    expect(startSweep("desk-s", { symbol: "USDG", token: USDG }, async () => ({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED }))).toBeNull();
    dismissSweep("desk-s");
    expect(sweepRun("desk-s")).not.toBeNull();
    finish({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED });
    await vi.waitFor(() => expect(sweepRun("desk-s")?.outcome).toEqual({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED }));
    dismissSweep("desk-s");
    expect(sweepRun("desk-s")).toBeNull();
  });

  it("reads a send that throws as unconfirmed", async () => {
    startSweep("desk-t", { symbol: "NVDA", token: NVDA }, async () => {
      throw new Error("lost");
    });
    await vi.waitFor(() => expect(sweepRun("desk-t")?.outcome).toEqual({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED }));
    dismissSweep("desk-t");
  });
});

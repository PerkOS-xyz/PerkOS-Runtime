/**
 * The Trader sheet's gates as pure data (when Revoke, a buy and Send home are
 * on, and when an outcome may be put away), amounts too small to show, and the
 * runs kept in sessionStorage across a reload.
 */

import type { BuyReceipt, DeskTrader } from "@perkos/client";
import { describe, expect, it, vi } from "vitest";

import { buyKey, isBuySummary, type BuySummary } from "../app/desks/buyStore";
import { createRunStore, keptRun, readKept, windowSession, type KeptStorage, type RunKeeper } from "../app/desks/runStore";
import { isSweepSummary, sweepKey } from "../app/desks/sweepStore";
import {
  aboutAmount,
  boundAmount,
  buyOpen,
  buyReason,
  DISMISS_AFTER_MS,
  isBuyOutcome,
  isSweepOutcome,
  outcomeDismissible,
  revokeAllowed,
  sendHomeAllowed,
  showAmount,
  SWEEP_UNCONFIRMED,
  sweepBlocksBuy,
  sweepOpen,
  UNCONFIRMED,
  type BuyOutcome,
  type SweepOutcome,
  type SweepState,
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
    { symbol: "NVDA", address: NVDA, decimals: 18, amount: "4158000000000000" },
  ],
  cap: 25,
  capBy: "platform",
  capReason: "no-owner-limit",
  input: { symbol: "USDG", address: USDG, decimals: 6 },
  marketAvailable: true,
  ...o,
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
const summary: BuySummary = {
  ticker: "NVDA",
  amountUsdg: "1",
  tokenOut: { symbol: "NVDA", address: NVDA, decimals: 18 },
  quotedAmountOut: "4200000000000000",
  minAmountOut: "4158000000000000",
  maxSlippageBps: 100,
  heldBefore: "0",
};

const bought: BuyOutcome = { kind: "receipt", receipt: receipt() };
const pendingBuy: BuyOutcome = { kind: "receipt", receipt: receipt({ status: "pending", bought: null }) };
const lostBuy: BuyOutcome = { kind: "unconfirmed", message: UNCONFIRMED };
const refusedBuy: BuyOutcome = { kind: "refused", code: "STALE_ORDER", message: "x", detail: "" };
const sent = (status: "success" | "pending" | "reverted"): SweepOutcome => ({ kind: "receipt", receipt: { hash: "0xbeef", status, explorerUrl: null } });
const lostSweep: SweepOutcome = { kind: "unconfirmed", message: SWEEP_UNCONFIRMED };
const sweepOf = (token: string, outcome: SweepOutcome | null, symbol = token === USDG ? "USDG" : "NVDA"): SweepState => ({ summary: { symbol, token }, outcome });

describe("when Revoke is on", () => {
  it("waits only while PerkOS is still signing a buy or a transfer home", () => {
    expect(revokeAllowed(null, null)).toBe(true);
    expect(revokeAllowed({ outcome: null }, null)).toBe(false);
    expect(revokeAllowed(null, { outcome: null })).toBe(false);
    // Once PerkOS has answered, it signs nothing more for that order.
    expect(revokeAllowed({ outcome: lostBuy }, { outcome: lostSweep })).toBe(true);
    expect(revokeAllowed({ outcome: pendingBuy }, { outcome: sent("pending") })).toBe(true);
  });
});

describe("when Send home is on", () => {
  it("waits while a buy is spending from the wallet or may still land", () => {
    expect(buyOpen(null)).toBe(false);
    expect(buyOpen({ outcome: null })).toBe(true);
    expect(buyOpen({ outcome: pendingBuy })).toBe(true);
    expect(buyOpen({ outcome: lostBuy })).toBe(true);
    expect(buyOpen({ outcome: bought })).toBe(false);
    expect(buyOpen({ outcome: refusedBuy })).toBe(false);
    expect(sendHomeAllowed({ outcome: pendingBuy }, null)).toBe(false);
    expect(sendHomeAllowed({ outcome: bought }, null)).toBe(true);
  });

  it("waits while another transfer home is in flight or may still land", () => {
    expect(sweepOpen({ outcome: null })).toBe(true);
    expect(sweepOpen({ outcome: sent("pending") })).toBe(true);
    expect(sweepOpen({ outcome: lostSweep })).toBe(true);
    expect(sendHomeAllowed(null, { outcome: sent("pending") })).toBe(false);
    expect(sendHomeAllowed(null, { outcome: sent("success") })).toBe(true);
    expect(sendHomeAllowed(null, { outcome: sent("reverted") })).toBe(true);
    expect(sendHomeAllowed(null, { outcome: { kind: "refused", code: "NOTHING_TO_SWEEP", message: "x", detail: "" } })).toBe(true);
    expect(sendHomeAllowed(null, null)).toBe(true);
  });
});

describe("when a buy is on", () => {
  it("waits for any transfer home in flight", () => {
    expect(sweepBlocksBuy(sweepOf(NVDA, null), USDG)).toBe("Wait for the transfer home to finish.");
    expect(sweepBlocksBuy(sweepOf(USDG, null), USDG)).toBe("Wait for the transfer home to finish.");
  });

  it("waits while a transfer of USDG home may still land, and says what to do", () => {
    for (const outcome of [sent("pending"), lostSweep]) {
      const why = sweepBlocksBuy(sweepOf(USDG, outcome), USDG);
      expect(why).toMatch(/^Your USDG may still be on its way home/);
      expect(why).toMatch(/Check the explorer, then press "I checked the explorer" above\.$/);
    }
    // The address decides, whatever its case.
    expect(sweepBlocksBuy(sweepOf(USDG.toLowerCase(), sent("pending"), "USDG"), USDG)).not.toBeNull();
    // With no USDG address to compare, the symbol does.
    expect(sweepBlocksBuy(sweepOf(USDG, lostSweep), null)).not.toBeNull();
  });

  it("does not wait for a transfer that settled, or for a stock that may still land", () => {
    expect(sweepBlocksBuy(null, USDG)).toBeNull();
    expect(sweepBlocksBuy(sweepOf(USDG, sent("success")), USDG)).toBeNull();
    expect(sweepBlocksBuy(sweepOf(USDG, sent("reverted")), USDG)).toBeNull();
    expect(sweepBlocksBuy(sweepOf(USDG, { kind: "refused", code: "NOTHING_TO_SWEEP", message: "x", detail: "" }), USDG)).toBeNull();
    expect(sweepBlocksBuy(sweepOf(NVDA, sent("pending")), USDG)).toBeNull();
    expect(sweepBlocksBuy(sweepOf(NVDA, lostSweep), USDG)).toBeNull();
  });

  it("gives the wallet's reason first, then the transfer's, then the stock", () => {
    expect(buyReason(null, 1, true, null)).toBe("The delegated wallet has not been read yet.");
    expect(buyReason(trader(), 100, true, sweepOf(USDG, sent("pending")))).toBe("One order can spend up to 25 USDG.");
    expect(buyReason(trader(), 1, false, sweepOf(USDG, sent("pending")))).toMatch(/^Your USDG may still be on its way home/);
    expect(buyReason(trader(), 1, false, sweepOf(NVDA, null))).toBe("Wait for the transfer home to finish.");
    expect(buyReason(trader(), 1, false, null)).toBe("Choose a stock.");
    expect(buyReason(trader(), 1, true, sweepOf(NVDA, sent("pending")))).toBeNull();
    expect(buyReason(trader(), 1, true, null)).toBeNull();
  });
});

describe("when a buy's outcome may be put away", () => {
  it("never while PerkOS has not answered", () => {
    expect(outcomeDismissible({ outcome: null, answeredAt: null }, 1_000_000, true)).toBe(false);
  });

  it("at once for a verdict, and for one that may land only after a minute or once the stock arrives", () => {
    expect(outcomeDismissible({ outcome: bought, answeredAt: 1_000 }, 1_000, false)).toBe(true);
    expect(outcomeDismissible({ outcome: refusedBuy, answeredAt: 1_000 }, 1_000, false)).toBe(true);
    expect(outcomeDismissible({ outcome: pendingBuy, answeredAt: 1_000 }, 5_000, false)).toBe(false);
    expect(outcomeDismissible({ outcome: pendingBuy, answeredAt: 1_000 }, 5_000, true)).toBe(true);
    expect(outcomeDismissible({ outcome: lostBuy, answeredAt: 1_000 }, 1_000 + DISMISS_AFTER_MS, false)).toBe(true);
    expect(outcomeDismissible({ outcome: lostBuy, answeredAt: 1_000 }, 1_000 + DISMISS_AFTER_MS - 1, false)).toBe(false);
    // A clock that reads earlier than the answer counts as no time passed.
    expect(outcomeDismissible({ outcome: lostBuy, answeredAt: 1_000 }, 0, false)).toBe(false);
  });
});

describe("an amount too small to show", () => {
  it("reads as less than the smallest step, never as 0", () => {
    expect(showAmount("4200000000000000", 18)).toBe("0.0042");
    expect(showAmount("500000000000", 18)).toBe("less than 0.000001");
    expect(showAmount("4000", 6, 2)).toBe("less than 0.01");
    expect(showAmount("1", 18, 0)).toBe("less than 1");
    expect(showAmount("0", 18)).toBe("0");
  });

  it("shows a bound in full when rounding would hide it", () => {
    expect(boundAmount("4158000000000000", 18)).toBe("0.004158");
    expect(boundAmount("495000000000", 18)).toBe("0.000000495");
    expect(boundAmount("0", 18)).toBe("0");
  });

  it("drops the about before it", () => {
    expect(aboutAmount("4200000000000000", 18)).toBe("about 0.0042");
    expect(aboutAmount("500000000000", 18)).toBe("less than 0.000001");
  });
});

/** sessionStorage as a Map, the way a window keeps it across a reload. */
function memoryStorage(): KeptStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const keeper = (storage: () => KeptStorage | null): RunKeeper<BuySummary, BuyOutcome> => ({
  storage,
  key: buyKey,
  isSummary: isBuySummary,
  isOutcome: isBuyOutcome,
});

describe("a run kept across a reload", () => {
  it("reads back what was approved and what came back", () => {
    expect(readKept(keptRun({ summary, outcome: bought }), lostBuy, isBuySummary, isBuyOutcome)).toEqual({ summary, outcome: bought });
    expect(readKept(keptRun({ summary, outcome: refusedBuy }), lostBuy, isBuySummary, isBuyOutcome)).toEqual({ summary, outcome: refusedBuy });
  });

  it("brings back a run that was in flight, or whose outcome no longer reads, as one that may be on chain", () => {
    expect(readKept(keptRun({ summary, outcome: null }), lostBuy, isBuySummary, isBuyOutcome)).toEqual({ summary, outcome: lostBuy });
    expect(readKept(JSON.stringify({ summary, outcome: { kind: "receipt", receipt: { ...receipt(), amountOut: "4.19" } } }), lostBuy, isBuySummary, isBuyOutcome)).toEqual({
      summary,
      outcome: lostBuy,
    });
    expect(readKept(JSON.stringify({ summary, outcome: { kind: "receipt", receipt: { ...receipt(), steps: [{ kind: {}, status: "success" }] } } }), lostBuy, isBuySummary, isBuyOutcome))
      .toEqual({ summary, outcome: lostBuy });
  });

  it("keeps nothing it cannot draw", () => {
    expect(readKept(null, lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
    expect(readKept("", lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
    expect(readKept("{not json", lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
    expect(readKept("null", lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
    expect(readKept(JSON.stringify({ summary: { ...summary, quotedAmountOut: "about 4" }, outcome: bought }), lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
    expect(readKept(JSON.stringify({ outcome: bought }), lostBuy, isBuySummary, isBuyOutcome)).toBeNull();
  });

  it("checks transfers home the same way", () => {
    expect(isSweepSummary({ symbol: "USDG", token: USDG })).toBe(true);
    expect(isSweepSummary({ symbol: "USDG" })).toBe(false);
    expect(isSweepOutcome(sent("pending"))).toBe(true);
    expect(isSweepOutcome(lostSweep)).toBe(true);
    expect(isSweepOutcome({ kind: "receipt", receipt: { hash: "", status: "pending", explorerUrl: null } })).toBe(false);
    expect(isSweepOutcome({ kind: "maybe" })).toBe(false);
    expect(sweepKey("stocks-robinhood")).not.toBe(buyKey("stocks-robinhood"));
  });

  it("has no window in a server render, so nothing is kept", () => {
    expect(windowSession()).toBeNull();
  });
});

describe("a store that keeps its runs", () => {
  it("writes each change, and a reload brings back a buy in flight as unconfirmed with its minute started again", () => {
    const storage = memoryStorage();
    const before = createRunStore<BuySummary, BuyOutcome>(lostBuy, () => 10, keeper(() => storage));
    before.start("desk-k", summary, () => new Promise<BuyOutcome>(() => undefined));
    expect(JSON.parse(storage.map.get(buyKey("desk-k"))!)).toEqual({ summary, outcome: null });

    // The window reloads while PerkOS is still signing.
    const after = createRunStore<BuySummary, BuyOutcome>(lostBuy, () => 500, keeper(() => storage));
    const back = after.get("desk-k");
    expect(back).toMatchObject({ module: "desk-k", summary, outcome: lostBuy, answeredAt: 500 });
    // The same run on every read, so the sheet does not redraw for nothing.
    expect(after.get("desk-k")).toBe(back);
    expect(buyOpen(back)).toBe(true);
    expect(outcomeDismissible(back!, 500 + DISMISS_AFTER_MS - 1, false)).toBe(false);
    expect(outcomeDismissible(back!, 500 + DISMISS_AFTER_MS, false)).toBe(true);

    // The old page's answer never arrives here: the new page puts the run away once it may.
    after.dismiss("desk-k");
    expect(after.get("desk-k")).toBeNull();
    expect(storage.map.has(buyKey("desk-k"))).toBe(false);
  });

  it("keeps the outcome once it arrives, and clears it when the owner puts it away", async () => {
    const storage = memoryStorage();
    const store = createRunStore<BuySummary, BuyOutcome>(lostBuy, () => 1, keeper(() => storage));
    store.start("desk-l", summary, async () => pendingBuy);
    await vi.waitFor(() => expect(JSON.parse(storage.map.get(buyKey("desk-l"))!)).toEqual({ summary, outcome: pendingBuy }));
    const reloaded = createRunStore<BuySummary, BuyOutcome>(lostBuy, () => 2, keeper(() => storage));
    expect(reloaded.get("desk-l")).toMatchObject({ outcome: pendingBuy, answeredAt: 2 });
    // Each desk is kept apart.
    expect(reloaded.get("desk-m")).toBeNull();
    reloaded.dismiss("desk-l");
    expect(storage.map.has(buyKey("desk-l"))).toBe(false);
  });

  it("works in memory when storage is missing or refuses every call", async () => {
    const refusing: KeptStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    for (const storage of [() => null, () => refusing, (): KeptStorage => { throw new Error("SecurityError"); }]) {
      const store = createRunStore<BuySummary, BuyOutcome>(lostBuy, () => 1, keeper(storage));
      expect(store.get("desk-o")).toBeNull();
      store.start("desk-o", summary, async () => bought);
      await vi.waitFor(() => expect(store.get("desk-o")?.outcome).toEqual(bought));
      store.dismiss("desk-o");
      expect(store.get("desk-o")).toBeNull();
    }
  });
});

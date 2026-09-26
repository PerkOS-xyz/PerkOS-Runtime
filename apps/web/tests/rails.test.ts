/**
 * Rails on a vault desk: the transactions the owner's wallet signs to set
 * them, and how a strategy reads on the desk.
 */

import type { DeskRail, DeskRails } from "@perkos/client";
import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import { newRail, railsCalls, railsProblem, railState, readable, toUnits } from "../app/desks/rails";

const rails: DeskRails = {
  chain: "robinhood",
  chainId: 4663,
  vault: "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
  input: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  routers: ["0x8876789976decbfcbbbe364623c63652db8c0904"],
  trader: { address: "0x6732c0829808e8286012f53462013104289025b4", gas: "0.0005", gasSymbol: "ETH" },
  rails: [],
};
const STOCK = "0x00000000000000000000000000000000000000d4";
const draft = { outputToken: STOCK, perTrade: 5, budget: 20, days: 7, slippagePct: 1 };
const rail = (o: Partial<DeskRail> = {}): DeskRail => ({
  strategyId: "25",
  owner: "0x1234567890abcdef1234567890abcdef12345678",
  agent: rails.trader!.address,
  inputToken: rails.input.address,
  outputToken: STOCK,
  router: rails.routers[0]!,
  maxAmountPerTrade: "5",
  maxTotalSpend: "20",
  spent: "0",
  available: "20",
  expiresAt: "2026-10-03T00:00:00.000Z",
  maxSlippageBps: 100,
  paused: false,
  revoked: false,
  forTrader: true,
  ...o,
});

describe("rails on a vault desk", () => {
  it("says what is missing before anything is signed", () => {
    expect(railsProblem(draft)).toBeNull();
    expect(railsProblem({ ...draft, outputToken: "" })).toMatch(/stock/);
    expect(railsProblem({ ...draft, budget: 4 })).toMatch(/budget/);
    expect(railsProblem({ ...draft, days: 120 })).toMatch(/90 days/);
    expect(railsProblem({ ...draft, slippagePct: 30 })).toMatch(/Slippage/);
  });

  it("names the Trader's wallet as the agent and funds exactly the budget", () => {
    const calls = railsCalls(rails, draft, "0x1234567890abcdef1234567890abcdef12345678", Date.parse("2026-09-26T00:00:00Z"));
    const vault = parseAbi([
      "function createStrategy(address,address,address,address,uint128,uint128,uint64,uint16,bytes32) returns (uint256)",
      "function fundStrategy(uint256,uint256)",
    ]);
    const create = decodeFunctionData({ abi: vault, data: calls.create.data });
    expect(String(create.args?.[0]).toLowerCase()).toBe("0x6732c0829808e8286012f53462013104289025b4");
    expect(create.args?.slice(4, 6)).toEqual([5_000_000n, 20_000_000n]);
    expect(create.args?.[6]).toBe(BigInt(Date.parse("2026-10-03T00:00:00Z") / 1000));
    expect(create.args?.[7]).toBe(100);
    expect(calls.approve.to).toBe(rails.input.address);
    const fund = decodeFunctionData({ abi: vault, data: calls.fund("26").data });
    expect(fund.args).toEqual([26n, 20_000_000n]);
  });

  it("finds the strategy just created, and reads how each one stands", () => {
    const now = Date.parse("2026-09-26T00:00:00Z");
    expect(newRail([rail()], [rail(), rail({ strategyId: "26" })], STOCK)?.strategyId).toBe("26");
    expect(newRail([rail()], [rail()], STOCK)).toBeNull();
    expect(railState(rail(), now)).toBe("active");
    expect(railState(rail({ spent: "20", available: "0" }), now)).toBe("empty");
    expect(railState(rail({ paused: true }), now)).toBe("paused");
    expect(railState(rail({ expiresAt: "2026-09-01T00:00:00.000Z" }), now)).toBe("expired");
    expect(railState(rail({ forTrader: false }), now)).toBe("not-trader");
  });

  it("counts and reads amounts the way the chain does", () => {
    expect(toUnits(1.5, 6)).toBe("1500000");
    expect(readable("4158000000000000", 18)).toBe("0.004158");
    expect(readable("20000000", 6)).toBe("20");
  });
});

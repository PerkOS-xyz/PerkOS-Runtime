/**
 * The rails a person sets on a vault desk, as pure data: the transactions
 * their own wallet signs to create and fund a strategy, and how a strategy
 * reads on the desk. No browser needed, so it is tested on its own.
 */

import type { DeskRail, DeskRails } from "@perkos/client";
import { encodeFunctionData, formatUnits, keccak256, parseAbi, parseUnits, toHex, type Hex } from "viem";

const VAULT = parseAbi([
  "function createStrategy(address agent, address inputToken, address outputToken, address router, uint128 maxAmountPerTrade, uint128 maxTotalSpend, uint64 expiresAt, uint16 maxSlippageBps, bytes32 humanProofHash) returns (uint256 strategyId)",
  "function fundStrategy(uint256 strategyId, uint256 amount)",
]);
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

export interface RailsDraft {
  outputToken: string;
  /** Whole units of the desk's input. */
  perTrade: number;
  budget: number;
  days: number;
  slippagePct: number;
}

export type RailsCall = { to: `0x${string}`; data: Hex };

/** What is wrong with a draft, in words, or null when it can be signed. */
export function railsProblem(d: RailsDraft): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.outputToken)) return "Choose a stock.";
  if (!(d.perTrade > 0)) return "Set how much one trade may spend.";
  if (!(d.budget >= d.perTrade)) return "The budget must cover at least one trade.";
  if (!(d.days >= 1 && d.days <= 90)) return "Rails last from 1 to 90 days.";
  if (!(d.slippagePct >= 0.1 && d.slippagePct <= 20)) return "Slippage goes from 0.1% to 20%.";
  return null;
}

/**
 * The three transactions that set rails, in order: the strategy that names the
 * Trader's wallet as its agent, the allowance for the budget, and the funding.
 * The funding needs the new strategy's id, so it is built once that is known.
 */
export function railsCalls(r: DeskRails, d: RailsDraft, owner: string, now: number) {
  if (!r.trader) throw new Error("Give the Trader a wallet first");
  const router = r.routers[0];
  if (!router) throw new Error("This desk names no router");
  const perTrade = parseUnits(String(d.perTrade), r.input.decimals);
  const budget = parseUnits(String(d.budget), r.input.decimals);
  const expiresAt = BigInt(Math.floor(now / 1000) + Math.round(d.days * 86_400));
  // The vault keeps a proof that a person set these rails: here, who and when.
  const proof = keccak256(toHex(JSON.stringify({ source: "perkos-runtime", owner: owner.toLowerCase(), at: now })));
  const vault = r.vault as `0x${string}`;
  return {
    create: {
      to: vault,
      data: encodeFunctionData({
        abi: VAULT,
        functionName: "createStrategy",
        args: [
          r.trader.address as `0x${string}`,
          r.input.address as `0x${string}`,
          d.outputToken as `0x${string}`,
          router as `0x${string}`,
          perTrade,
          budget,
          expiresAt,
          Math.round(d.slippagePct * 100),
          proof,
        ],
      }),
    } satisfies RailsCall,
    approve: {
      to: r.input.address as `0x${string}`,
      data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [vault, budget] }),
    } satisfies RailsCall,
    fund: (strategyId: string): RailsCall => ({
      to: vault,
      data: encodeFunctionData({ abi: VAULT, functionName: "fundStrategy", args: [BigInt(strategyId), budget] }),
    }),
  };
}

/** The strategy just created: for this stock, naming the Trader, and not there before. */
export function newRail(before: DeskRail[], after: DeskRail[], outputToken: string): DeskRail | null {
  const known = new Set(before.map((r) => r.strategyId));
  const fresh = after.filter((r) => !known.has(r.strategyId) && r.forTrader && r.outputToken.toLowerCase() === outputToken.toLowerCase());
  return fresh.sort((a, b) => Number(b.strategyId) - Number(a.strategyId))[0] ?? null;
}

export type RailState = "active" | "empty" | "paused" | "revoked" | "expired" | "not-trader";

/** How a strategy stands for the Trader right now. */
export function railState(r: DeskRail, now: number): RailState {
  if (r.revoked) return "revoked";
  if (Date.parse(r.expiresAt) <= now) return "expired";
  if (r.paused) return "paused";
  if (!r.forTrader) return "not-trader";
  return Number(r.available) > 0 && Number(r.spent) < Number(r.maxTotalSpend) ? "active" : "empty";
}

export const RAIL_STATE_LABEL: Record<RailState, string> = {
  active: "Ready",
  empty: "Spent",
  paused: "Paused",
  revoked: "Revoked",
  expired: "Expired",
  "not-trader": "Not the Trader's",
};

/** A whole-unit amount as the chain counts it. */
export const toUnits = (amount: number, decimals: number): string => parseUnits(String(amount), decimals).toString();

/** A chain amount for reading: at most `digits` decimals, no trailing zeros. */
export function readable(units: string, decimals: number, digits = 6): string {
  const [whole, frac = ""] = formatUnits(BigInt(units), decimals).split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole!;
}

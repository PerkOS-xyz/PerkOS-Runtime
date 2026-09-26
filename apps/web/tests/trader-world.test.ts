import type { DeskTeam, DeskTrader } from "@perkos/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { delegationChanged, delegationMode, effectiveOrderCap, traderAgentId, worldApprovalRequired } from "../app/desks/delegation";
import { buyReason, recheckBuy, revokeAllowed, sendHomeAllowed, QUOTE_TTL_S } from "../app/desks/trade";
import { WalletTraderSheet } from "../app/desks/WalletTraderSheet";

const state = vi.hoisted(() => ({ trader: null as DeskTrader | null }));
vi.mock("../app/desks/useTrader", () => ({ useTrader: () => ({ trader: state.trader, loading: false, error: "", load: async () => state.trader }) }));
vi.mock("../app/desks/useMarket", () => ({ useMarket: () => ({ market: null }) }));

const wallet = "0x6732c0829808e8286012f53462013104289025b4";
const grant = { agentId: "eqlty-trader-id", walletAddress: wallet, chainIds: [4663], maxPerOrder: "25", revision: 1 };
const trader = (extra: Partial<DeskTrader> = {}): DeskTrader => ({
  delegated: true, wallet, chainId: 4663, gas: { ok: true, wei: "1000000000000000" },
  balances: [{ symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, amount: "200000000" }],
  cap: 100, capBy: "platform", capReason: "no-owner-limit", input: null, marketAvailable: true,
  world: { enabled: true, approved: true, grant }, ...extra,
});
const render = (value: DeskTrader, agentId = grant.agentId) => {
  state.trader = value;
  return renderToStaticMarkup(createElement(WalletTraderSheet, { title: "EQLTY", module: "stocks-robinhood", chain: "robinhood", agentId, onClose: () => undefined })).replace(/<!-- -->/g, "");
};

describe("the selected desk's World authority", () => {
  it("selects the stable ID, refuses ambiguous roles and never substitutes an agent name", () => {
    const team: DeskTeam = { templateId: "eqlty", status: "ready", agents: [{ role: "trader", name: "eqlty-trader", agentId: grant.agentId, state: "ready" }] };
    expect(traderAgentId(team, "eqlty")).toBe(grant.agentId);
    expect(traderAgentId(team, "floor")).toBeUndefined();
    expect(traderAgentId({ ...team, agents: [...team.agents, { role: "trader", name: "another", agentId: "other", state: "ready" }] }, "eqlty")).toBeUndefined();
    expect(traderAgentId({ ...team, agents: [{ role: "trader", name: "a-name-is-not-an-id", state: "planned" }] }, "eqlty")).toBeUndefined();
    expect(traderAgentId(null, "eqlty")).toBeUndefined();
  });

  it("blocks legacy shares and mismatched Trader, wallet or chain before funds checks", () => {
    for (const changed of [null, { ...grant, agentId: "floor-trader-id" }, { ...grant, walletAddress: "0x1111111111111111111111111111111111111111" }, { ...grant, chainIds: [8453] }]) {
      const current = trader({ world: { enabled: true, approved: changed !== null, grant: changed } });
      expect(worldApprovalRequired(current, grant.agentId)).toBe(true);
      expect(delegationMode(current, grant.agentId)).toBe("grant");
      expect(effectiveOrderCap(current, grant.agentId)).toBe(0);
      expect(buyReason(current, 5, true, null, grant.agentId)).toContain("World");
      expect(current.delegated).toBe(true);
    }
    expect(buyReason(trader(), 5, true, null)).toContain("World");
  });

  it("uses the smaller saved or World cap and rechecks a revoked approval", () => {
    const current = trader();
    expect(delegationMode(current, grant.agentId)).toBe("edit");
    expect(effectiveOrderCap(current, grant.agentId)).toBe(25);
    expect(effectiveOrderCap(trader({ cap: 10 }), grant.agentId)).toBe(10);
    expect(buyReason(current, 25, true, null, grant.agentId)).toBeNull();
    expect(buyReason(current, 26, true, null, grant.agentId)).toContain("25 USDG");
    expect(buyReason(trader({ world: { enabled: true, approved: false, grant: null } }), 25, true, null, grant.agentId)).toContain("World");
  });

  it("keeps previous behavior when World is absent or disabled", () => {
    const legacy = trader();
    delete legacy.world;
    for (const value of [legacy, trader({ world: { enabled: false, approved: false, grant: null } })]) {
      expect(effectiveOrderCap(value)).toBe(100);
      expect(buyReason(value, 100, true, null)).toBeNull();
      expect(delegationMode(value)).toBe("edit");
    }
  });

  it("refuses a wallet rebind, chain change, expired quote or revoked grant during the final read", () => {
    const before = trader();
    const input = { before, current: trader(), amount: 5, agentId: grant.agentId, receivedAt: 1000, now: 2000, sweep: null };
    expect(recheckBuy(input)).toBeNull();
    const another = "0x1111111111111111111111111111111111111111";
    const rebound = trader({ wallet: another, world: { enabled: true, approved: true, grant: { ...grant, walletAddress: another } } });
    expect(recheckBuy({ ...input, current: rebound })).toContain("wallet or chain changed");
    expect(recheckBuy({ ...input, current: trader({ chainId: 8453, world: { enabled: true, approved: true, grant: { ...grant, chainIds: [8453] } } }) })).toContain("wallet or chain changed");
    expect(recheckBuy({ ...input, now: 1000 + QUOTE_TTL_S * 1000 })).toContain("quote expired");
    expect(recheckBuy({ ...input, current: trader({ world: { enabled: true, approved: false, grant: null } }) })).toContain("World");
    expect(recheckBuy({ ...input, current: null })).toContain("wallet or chain changed");
  });

  it("detects approval and later revisions even when the cap stays unchanged", () => {
    const pending = trader({ world: { enabled: true, approved: false, grant: null } });
    expect(delegationChanged(pending, trader())).toBe(true);
    expect(delegationChanged(trader(), trader({ world: { enabled: true, approved: true, grant: { ...grant, revision: 2 } } }))).toBe(true);
    expect(delegationChanged(trader(), trader())).toBe(false);
  });

  it("shows a connected legacy wallet as paused while preserving balances and recovery", () => {
    const out = render(trader({ world: { enabled: true, approved: false, grant: null } }));
    expect(out).toContain("Wallet connected · World approval required");
    expect(out).toContain("Buying paused");
    expect(out).toContain("Confirm Trader access");
    expect(out).not.toContain("The Trader buys from your wallet");
    expect(out).not.toContain("up to 100 USDG");
    expect(out).toContain(">Revoke</button>");
    expect(out).toContain(">Send home</button>");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Get a quote<\/button>/);
    expect(revokeAllowed(null, null)).toBe(true);
    expect(sendHomeAllowed(null, null)).toBe(true);
  });

  it("displays the effective approved cap, not the larger legacy cap", () => {
    const out = render(trader());
    expect(out).toContain("up to 25 USDG");
    expect(out).not.toContain("up to 100 USDG");
    expect(out).toContain("Edit limits");
  });
});

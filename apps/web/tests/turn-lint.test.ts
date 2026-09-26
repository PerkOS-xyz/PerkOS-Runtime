/**
 * Checks on the team's answers: none of them blocks anything, each is a flag
 * History counts. The desk supplies what they compare against.
 */

import { describe, expect, it } from "vitest";

import { largestSize, lintTurn, wordLimit, type LintInput } from "../app/lib/turnLint";
import type { RoleReply } from "../app/lib/turnRecord";

const rolePrompts = {
  scout: 'As Scout: read the facts. Open with "@Trader @Auditor". Under 70 words, plain text.',
  risk: 'As Risk: first line "RISK: low", "RISK: medium" or "RISK: high". Under 50 words.',
  trader: 'As Trader (open with "@Sparky"): the entry plan. Under 60 words.',
  auditor: 'As Auditor (open with "@Sparky"): the record. Under 80 words.',
};
const given = [
  "Desk rules: priced in USDG. An order is at most 100 USDG.",
  "Where this desk trades: Uniswap on Robinhood Chain.",
  "[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable. 7-day range 172.10 to 184.00 USDG, -2.50% over it (uniswap-rwa-1d).",
].join("\n");

const reply = (role: string, text: string, phase: 1 | 2 = role === "scout" || role === "risk" ? 1 : 2): RoleReply => ({ role, phase, ok: true, reply: text, ms: 1 });
const good: RoleReply[] = [
  reply("scout", "@Trader @Auditor NVDA is up 1.2% in 24h [F1] and sits near the top of its range [F1]."),
  reply("risk", "RISK: medium\n@Trader @Auditor Keep it to 50 USDG. Block if the reference stays frozen."),
  reply("trader", "@Sparky Entry: 50 USDG through Uniswap, take profit at 190 USDG, stop at 172 USDG."),
  reply("auditor", "@Sparky Thesis: NVDA holds its range [F1]. Main risk: a frozen reference. Check the next close."),
];
const input = (replies: RoleReply[], extra: Partial<LintInput> = {}): LintInput => ({
  kind: "analyze",
  replies,
  given,
  rolePrompts,
  maxOrder: 100,
  quote: "USDG",
  venues: ["Uniswap on Robinhood Chain"],
  ...extra,
});

describe("checks on the team's answers", () => {
  it("passes a turn that keeps the desk's rules", () => {
    expect(lintTurn(input(good))).toEqual([]);
  });

  it("flags a role that did not answer, but not one the person stopped waiting for", () => {
    const failed = { ...good[3]!, ok: false, reply: "", failure: "model" as const };
    const stopped = { ...good[2]!, ok: false, reply: "", failure: "stopped" as const };
    expect(lintTurn(input([good[0]!, good[1]!, stopped, failed]))).toEqual(["auditor:no-answer"]);
  });

  it("flags missing mentions, citations and risk level", () => {
    const flags = lintTurn(
      input([
        reply("scout", "NVDA looks fine."),
        reply("risk", "Medium risk overall."),
        reply("trader", "Entry 50 USDG."),
        reply("auditor", "Thesis: fine."),
      ]),
    );
    expect(flags).toEqual([
      "scout:no-mention",
      "scout:no-citation",
      "risk:no-mention",
      "risk:no-risk-level",
      "trader:no-mention",
      "auditor:no-mention",
      "auditor:no-citation",
    ]);
  });

  it("flags a closed market, a percentage nobody gave, a size over the cap and a long answer", () => {
    const long = `@Trader @Auditor ${"word ".repeat(90)}[F1]`;
    expect(lintTurn(input([reply("scout", "@Trader @Auditor The market is closed, NVDA fell 7.3% [F1].")]))).toEqual([
      "scout:says-market-closed",
      "scout:pct-not-in-facts(7.3)",
    ]);
    expect(lintTurn(input([reply("trader", "@Sparky Buy 250 USDG of NVDA now.")]))).toEqual(["trader:size-over-limit"]);
    expect(lintTurn(input([reply("scout", long)]))[0]).toMatch(/^scout:over-length\(\d+\)$/);
  });

  it("takes the venues from the desk, and skips the check when the desk names none", () => {
    const aero = reply("trader", "@Sparky Entry 50 USDG on Aerodrome.");
    const uni = reply("trader", "@Sparky Entry 50 USDG on Uniswap.");
    expect(lintTurn(input([aero]))).toEqual(["trader:venue-not-in-facts(Aerodrome)"]);
    expect(lintTurn(input([uni]))).toEqual([]);
    expect(lintTurn(input([aero], { venues: undefined }))).toEqual([]);
    expect(lintTurn(input([uni], { venues: ["Aerodrome on Base"], given: "[F1] NVDA (NVIDIA): 181.20 USDC." }))).toEqual(["trader:venue-not-in-facts(Uniswap)"]);
  });

  it("asks an order turn for a verdict instead of a risk level, and leaves sizes and citations to it", () => {
    const flags = lintTurn(input([reply("risk", "@Trader @Auditor Looks fine."), reply("scout", "@Trader @Auditor Buy 500 USDG.")], { kind: "order" }));
    expect(flags).toEqual(["risk:no-verdict"]);
    expect(lintTurn(input([reply("risk", "VERDICT: GO\n@Trader @Auditor within limits.")], { kind: "order" }))).toEqual([]);
  });

  it("skips the size check for a desk without an order cap", () => {
    expect(lintTurn(input([reply("trader", "@Sparky Buy 250 USDG of NVDA now.")], { maxOrder: undefined }))).toEqual([]);
  });
});

describe("reading limits from the desk's words", () => {
  it("finds the word limit in a role prompt", () => {
    expect(wordLimit(rolePrompts.scout)).toBe(70);
    expect(wordLimit("No limit here.")).toBeNull();
    expect(wordLimit(undefined)).toBeNull();
  });

  it("reads sizes to trade and leaves price levels alone", () => {
    expect(largestSize("Entry: 50 USDG, take profit at 195 USDG, stop at 170 USDG.", "USDG")).toBe(50);
    expect(largestSize("Add below 175 USDG and size 80 USDG.", "USDG")).toBe(80);
    expect(largestSize("Start with $2k.", "USDG")).toBe(2_000);
    expect(largestSize("NVDA trades at 181.20 USDG.", "USDG")).toBe(0);
    expect(largestSize("Position of 1,500 USDC.", "USDC")).toBe(1_500);
  });
});

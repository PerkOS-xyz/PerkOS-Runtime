/**
 * What the team is asked: the head every role shares, the handoff the second
 * phase gets, and Sparky's line in the chat.
 */

import type { DeskAsset } from "@perkos/desk-contract";
import { describe, expect, it } from "vitest";

import { buildHead, fullPrompt, handoff, headBudget, HANDOFF_CLIP, principalLine, PROMPT_CAP, roleTail, shortFact } from "../app/lib/turnPrompts";

const facts = ["[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable.", "[F2] AAPL (Apple): 341.67 USDG at 14:30, tradeable."];
const rules = "This desk trades tokenized stocks on Robinhood Chain, priced in USDG. An order is at most 100 USDG.";

describe("the head", () => {
  it("carries the request, the rules, the venues, the numbered facts and the memory, in that order", () => {
    const head = buildHead({ question: "How is NVDA doing today?", rules, facts, venues: ["Uniswap on Robinhood Chain"], memory: "Earlier turn: NVDA read as steady." });
    const text = head.text;
    const at = (s: string) => text.indexOf(s);
    expect(at('Request to the desk: "How is NVDA doing today?".')).toBe(0);
    expect(at(`Desk rules: ${rules}`)).toBeGreaterThan(0);
    expect(at("Where this desk trades: Uniswap on Robinhood Chain.")).toBeGreaterThan(at("Desk rules"));
    expect(at("tagged for citation")).toBeGreaterThan(at("Where this desk trades"));
    expect(at("[F1] NVDA")).toBeGreaterThan(at("tagged for citation"));
    expect(at("[F2] AAPL")).toBeGreaterThan(at("[F1] NVDA"));
    expect(at("Desk memory: Earlier turn")).toBeGreaterThan(at("[F2] AAPL"));
    expect(text.endsWith("Do not open skills, files or tools.")).toBe(true);
    expect(head.facts).toEqual(facts);
  });

  it("leaves out what the desk does not give", () => {
    const text = buildHead({ question: "Hi", rules, facts: [] }).text;
    expect(text).not.toContain("Where this desk trades");
    expect(text).not.toContain("tagged for citation");
    expect(text).not.toContain("Desk memory");
  });

  it("stays inside its budget, cutting facts from the end before memory", () => {
    const many = Array.from({ length: 12 }, (_, i) => `[F${i + 1}] ${"x".repeat(280)}`);
    const memory = "m".repeat(800);
    const full = buildHead({ question: "What should I buy?", rules, facts: many, memory });
    const cut = buildHead({ question: "What should I buy?", rules, facts: many, memory, maxChars: full.text.length - 500 });
    expect(cut.text.length).toBeLessThanOrEqual(full.text.length - 500);
    expect(cut.facts.length).toBeLessThan(12);
    expect(cut.facts).toEqual(many.slice(0, cut.facts.length));
    expect(cut.memory.length).toBe(800);

    const tight = buildHead({ question: "What should I buy?", rules, facts: many, memory, maxChars: 900 });
    expect(tight.facts).toEqual([]);
    expect(tight.text.length).toBeLessThanOrEqual(900);
    expect(tight.memory.length).toBeLessThan(800);
  });

  it("caps the memory at 900 characters", () => {
    expect(buildHead({ question: "q", rules, facts, memory: "y".repeat(2_000) }).memory.length).toBeLessThanOrEqual(900);
  });

  it("leaves room for the handoff and the longest role prompt, so the whole prompt fits what PerkOS takes", () => {
    const rolePrompt = "r".repeat(1_200);
    const budget = headBudget([rolePrompt, "short"]);
    const head = buildHead({ question: "q".repeat(2_000), rules: "u".repeat(1_600), facts: Array.from({ length: 40 }, (_, i) => `[F${i + 1}] ${"f".repeat(300)}`), maxChars: budget });
    const note = handoff([
      { role: "scout", phase: 1, ok: true, reply: "s".repeat(5_000), ms: 1 },
      { role: "risk", phase: 1, ok: true, reply: "k".repeat(5_000), ms: 1 },
    ]);
    expect(fullPrompt(head.text, roleTail(rolePrompt, note)).length).toBeLessThanOrEqual(PROMPT_CAP);
    expect(`${head.text}\n\n${roleTail(rolePrompt, note)}`.length).toBeLessThanOrEqual(PROMPT_CAP);
  });
});

describe("the handoff", () => {
  it("quotes what the first roles said, clipped, with Risk's level", () => {
    const note = handoff(
      [
        { role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA holds its range [F1].", ms: 1 },
        { role: "risk", phase: 1, ok: true, reply: `RISK: medium\n@Trader ${"z".repeat(2_000)}`, ms: 1 },
      ],
      { riskLevel: "medium" },
    );
    expect(note).toContain('Scout said: "@Trader @Auditor NVDA holds its range [F1]."');
    expect(note).toMatch(/Risk said: "RISK: medium @Trader z+…" \(risk medium\)\./);
    const quoted = note.match(/Risk said: "([^"]*)"/)?.[1] ?? "";
    expect(quoted.length).toBeLessThanOrEqual(HANDOFF_CLIP);
  });

  it("says who did not answer and why", () => {
    const note = handoff([{ role: "scout", phase: 1, ok: false, reply: "", failure: "model", detail: "API call failed", ms: 1 }]);
    expect(note).toBe("(Scout did not answer: model failed).");
  });

  it("names the verdict on an order turn", () => {
    expect(handoff([{ role: "risk", phase: 1, ok: true, reply: "VERDICT: GO", ms: 1 }], { verdict: "GO" })).toBe('Risk said: "VERDICT: GO" (verdict GO).');
  });
});

describe("Sparky's line to the first roles", () => {
  const nvda: DeskAsset = {
    ticker: "NVDA",
    name: "NVIDIA",
    address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    decimals: 18,
    priceUsd: 181.2,
    priceAt: null,
    change24hPct: 1.2,
    volume24hUsd: null,
    tradeable: true,
    logoUrl: null,
  };

  it("mentions the roles, asks the question and attaches a few facts", () => {
    expect(shortFact(nvda, "USDG")).toBe("NVDA 181.20 USDG, +1.20% in 24h");
    expect(principalLine("How is NVDA doing today?", ["scout", "risk"], [shortFact(nvda, "USDG")])).toBe(
      "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG, +1.20% in 24h.",
    );
    expect(principalLine("Pick for me", ["scout", "risk"], ["A", "B", "C", "D", "E", "F"])).toBe("@Scout @Risk Pick for me. Facts attached: A; B; C; D; and 2 more.");
    expect(principalLine("Hi", ["scout"], [])).toBe("@Scout Hi.");
    expect(principalLine("x", ["scout"], [])).not.toMatch(/\[F\d/);
    expect(principalLine("x", ["scout"], [])).not.toContain(String.fromCharCode(0x2014));
  });
});

/**
 * Which questions are a task for the desk's team. Plain chat must stay with
 * Sparky, because a desk turn wakes the team and runs on the person's desk time.
 */

import type { DeskAsset, DeskManifest } from "@perkos/desk-contract";
import { describe, expect, it } from "vitest";

import { turnKindFor } from "../app/turn/classify";

const prompts = { scout: "s", risk: "r", trader: "t", auditor: "a" };
const starters = [
  { text: "What should I buy this month?", tag: "The desk reads the market" },
  { text: "How is NVDA doing today?", tag: "Price and recent range" },
  { text: "What can I trade on this desk?", tag: "Tokenized stocks in USDG" },
  { text: "Is Apple cheaper than Microsoft right now?", tag: "Compare two stocks" },
];
/** Today's EQLTY manifest: two kinds of turn, no starter marked yet. */
const eqlty: DeskManifest = { tagline: "Tokenized stocks on Robinhood Chain", starters, screens: ["market", "trader"], rules: "r", turns: { analyze: prompts, advise: prompts } };
/** The same desk once it marks its starters. */
const marked: DeskManifest = {
  ...eqlty,
  starters: [
    { ...starters[0]!, turn: "advise" },
    { ...starters[1]!, turn: "analyze" },
    starters[2]!,
    { ...starters[3]!, turn: "analyze" },
  ],
};

const asset = (ticker: string, name: string): DeskAsset => ({
  ticker,
  name: `${name} • Robinhood Token`,
  address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  decimals: 18,
  priceUsd: 100,
  priceAt: null,
  change24hPct: null,
  volume24hUsd: null,
  tradeable: true,
  logoUrl: null,
});
const assets = [asset("NVDA", "NVIDIA"), asset("AAPL", "Apple"), asset("MSFT", "Microsoft"), asset("TSLA", "Tesla")];
const kind = (text: string, manifest: DeskManifest | null = eqlty) => turnKindFor(text, { manifest, assets });

describe("which questions go to the team", () => {
  it("routes the EQLTY starters, marked or not", () => {
    for (const m of [eqlty, marked]) {
      expect(kind("What should I buy this month?", m)).toBe("advise");
      expect(kind("How is NVDA doing today?", m)).toBe("analyze");
      expect(kind("What can I trade on this desk?", m)).toBeNull();
      expect(kind("Is Apple cheaper than Microsoft right now?", m)).toBe("analyze");
    }
  });

  it("lets a marked starter decide, and keeps an unmarked one as plain chat once the desk marks its starters", () => {
    const m: DeskManifest = { ...marked, starters: [{ text: "Tell me something nice", tag: "x", turn: "advise" }, { text: "Analyze NVDA", tag: "y" }] };
    expect(kind("Tell me something nice", m)).toBe("advise");
    expect(kind("Analyze NVDA", m)).toBeNull();
    expect(turnKindFor("anything", { manifest: m, assets, starter: m.starters[0]! })).toBe("advise");
  });

  it("keeps plain chat with Sparky", () => {
    for (const text of ["hi", "Hello Sparky", "Thanks!", "What is a tokenized stock?", "Tell me about NVDA", "check my settings", "What can I trade here?", ""]) {
      expect([text, kind(text)]).toEqual([text, null]);
    }
  });

  it("reads a request to analyze as a task, with or without an asset", () => {
    expect(kind("Analyze NVDA")).toBe("analyze");
    expect(kind("analyse tesla")).toBe("analyze");
    expect(kind("Research the market for me")).toBe("analyze");
    expect(kind("look into Apple")).toBe("analyze");
    expect(kind("check the market")).toBe("analyze");
    expect(kind("check NVDA")).toBe("analyze");
  });

  it("reads open buying questions as advice", () => {
    expect(kind("Which stock should I buy?")).toBe("advise");
    expect(kind("Any opportunities this week?")).toBe("advise");
    expect(kind("What do you recommend?")).toBe("advise");
    expect(kind("Best pick for next month")).toBe("advise");
  });

  it("understands Spanish", () => {
    expect(kind("¿Qué acción me conviene comprar este mes?")).toBe("advise");
    expect(kind("¿Qué me recomiendas?")).toBe("advise");
    expect(kind("¿Cómo va NVDA hoy?")).toBe("analyze");
    expect(kind("¿Apple está más barata que Microsoft?")).toBe("analyze");
    expect(kind("analiza el mercado")).toBe("analyze");
    expect(kind("revisa Tesla")).toBe("analyze");
    expect(kind("hola, ¿cómo estás?")).toBeNull();
  });

  it("runs only a kind the desk has", () => {
    const analyzeOnly: DeskManifest = { ...eqlty, turns: { analyze: prompts } };
    expect(kind("What should I buy this month?", analyzeOnly)).toBeNull();
    expect(kind("How is NVDA doing today?", { ...eqlty, turns: {} })).toBeNull();
    expect(kind("How is NVDA doing today?", null)).toBeNull();
  });

  it("sends a trade request with an amount to an order turn only on a desk that runs them, and to an analysis otherwise", () => {
    expect(kind("Buy $50 of NVDA")).toBe("analyze");
    expect(kind("Buy $50 of NVDA", { ...eqlty, turns: { ...eqlty.turns, order: prompts } })).toBe("order");
    expect(kind("What should I buy with $50?")).toBeNull();
  });

  it("recognises tickers before the market has loaded", () => {
    expect(turnKindFor("How is NVDA doing?", { manifest: eqlty })).toBe("analyze");
    expect(turnKindFor("Is it OK to ask?", { manifest: eqlty })).toBeNull();
  });
});

/**
 * The contract, against the answers a desk really gives. These schemas are the
 * only thing standing between a desk in another repo and a screen that draws
 * whatever arrives, so the interesting cases here are the refusals.
 */

import { describe, expect, it } from "vitest";

import { DeskDraftSchema, DeskManifestSchema, DeskMarketSchema, DeskQuoteReplySchema, DeskSeriesSchema } from "../src/index.ts";

const asset = {
  ticker: "NVDA",
  name: "NVIDIA",
  address: "0xb20000000000000000000078ee7ce2fE4908108C",
  decimals: 8,
  priceUsd: 225.27,
  priceAt: "2026-09-24T01:42:52.448Z",
  change24hPct: -1.48,
  volume24hUsd: 24991268,
  tradeable: null,
  logoUrl: null,
};

const market = {
  chain: "base",
  chainId: 8453,
  quoteSymbol: "USDC",
  assets: [asset],
  observedAt: "2026-09-24T01:42:56.283Z",
};

describe("a desk's market", () => {
  it("takes the shape a desk answers with", () => {
    expect(DeskMarketSchema.safeParse(market).success).toBe(true);
  });

  it("keeps an unknown tradeable as unknown", () => {
    const parsed = DeskMarketSchema.parse(market);
    expect(parsed.assets[0]?.tradeable).toBeNull();
    expect(DeskMarketSchema.safeParse({ ...market, assets: [{ ...asset, tradeable: true }] }).success).toBe(true);
  });

  it("refuses a market with nothing in it", () => {
    expect(DeskMarketSchema.safeParse({ ...market, assets: [] }).success).toBe(false);
  });

  it("refuses an asset that cannot be traded: no address, no decimals", () => {
    expect(DeskMarketSchema.safeParse({ ...market, assets: [{ ...asset, address: "0xnope" }] }).success).toBe(false);
    expect(DeskMarketSchema.safeParse({ ...market, assets: [{ ...asset, decimals: 1.5 }] }).success).toBe(false);
  });

  it("refuses a field nobody agreed on", () => {
    expect(DeskMarketSchema.safeParse({ ...market, promoted: true }).success).toBe(false);
  });
});

describe("a desk's series", () => {
  it("carries its source and, when it has one, its range", () => {
    const ok = DeskSeriesSchema.safeParse({
      ticker: "NVDA",
      priceUsd: 225.27,
      change24hPct: null,
      points: [{ at: "2026-09-23T02:37:01.000Z", value: 228.72 }],
      source: "chainlink-base",
      days: 30,
      low: 207.96,
      high: 231.23,
      line: "30-day reference range $207.96 to $231.23.",
    });
    expect(ok.success).toBe(true);
  });

  it("refuses a series that will not say where it came from", () => {
    expect(DeskSeriesSchema.safeParse({ ticker: "NVDA", priceUsd: 1, change24hPct: null, points: [] }).success).toBe(false);
  });
});

describe("an order", () => {
  const draft = {
    side: "buy" as const,
    ticker: "NVDA",
    amountIn: "1",
    quoteSymbol: "USDC",
    quoteOut: "0.00443",
    minOut: "0.00438",
    venue: "Aerodrome",
    txs: [
      { label: "approve", to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x095ea7b3", chainId: 8453 },
      { label: "swap", to: "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F", data: "0xa026383e", chainId: 8453 },
    ],
    quotedAt: "2026-09-24T01:42:56.283Z",
  };

  it("is a draft with its steps and its worst acceptable outcome", () => {
    expect(DeskDraftSchema.safeParse(draft).success).toBe(true);
    expect(DeskQuoteReplySchema.safeParse(draft).success).toBe(true);
  });

  it("refuses a draft with nothing to sign", () => {
    expect(DeskDraftSchema.safeParse({ ...draft, txs: [] }).success).toBe(false);
  });

  it("accepts a refusal as an answer, with a reason a person can read", () => {
    const refusal = { refused: true, code: "thin_liquidity", detail: "The pool is too thin for this size right now." };
    expect(DeskQuoteReplySchema.safeParse(refusal).success).toBe(true);
    expect(DeskQuoteReplySchema.safeParse({ refused: true, code: "because", detail: "no" }).success).toBe(false);
  });
});

describe("a desk's manifest", () => {
  const prompts = { scout: "As Scout: read the facts.", risk: "As Risk: size it.", trader: "As Trader: plan it.", auditor: "As Auditor: record it." };
  const manifest = {
    tagline: "Tokenized stocks on Robinhood Chain",
    starters: [{ text: "How is NVDA doing today?", tag: "Price and recent range" }],
    screens: ["market", "portfolio"],
    rules: "Priced in USDG. Nobody on the desk spends or signs.",
    turns: { analyze: prompts, advise: prompts },
  };

  it("takes the line, the first questions, the screens and the team's turns", () => {
    expect(DeskManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("still takes a manifest without a starter's turn, an order cap or venues", () => {
    const parsed = DeskManifestSchema.parse(manifest);
    expect(parsed.maxOrder).toBeUndefined();
    expect(parsed.venues).toBeUndefined();
    expect(parsed.starters[0]?.turn).toBeUndefined();
  });

  it("takes the turn a starter runs, the order cap and the desk's venues", () => {
    const parsed = DeskManifestSchema.parse({
      ...manifest,
      starters: [
        { text: "What should I buy this month?", tag: "The desk reads the market", turn: "advise" },
        { text: "How is NVDA doing today?", tag: "Price and recent range", turn: "analyze" },
        { text: "What can I trade on this desk?", tag: "Tokenized stocks in USDG" },
      ],
      maxOrder: 100,
      venues: ["Uniswap on Robinhood Chain"],
    });
    expect(parsed.starters.map((s) => s.turn)).toEqual(["advise", "analyze", undefined]);
    expect(parsed.maxOrder).toBe(100);
    expect(parsed.venues).toEqual(["Uniswap on Robinhood Chain"]);
  });

  it("refuses a starter's turn it does not know, an order cap that is not a positive number, or empty venues", () => {
    const starter = { text: "Launch a coin", tag: "New token" };
    expect(DeskManifestSchema.safeParse({ ...manifest, starters: [{ ...starter, turn: "launch" }] }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, maxOrder: 0 }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, maxOrder: "100" }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, venues: [] }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, venues: [""] }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, starters: [{ ...starter, promoted: true }] }).success).toBe(false);
  });

  it("refuses a screen the app does not know, a role left out, or a field nobody reads", () => {
    expect(DeskManifestSchema.safeParse({ ...manifest, screens: ["casino"] }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, turns: { analyze: { scout: "x", risk: "y", trader: "z" } } }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, theme: "dark" }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, turns: { launch: prompts } }).success).toBe(false);
  });

  it("takes a launch turn: Scout, Risk and the Auditor, with the Hooks and Treasury specialists when the desk seats them", () => {
    const launch = { scout: "As Scout: read the pair.", risk: "As Risk: VERDICT: GO or VERDICT: BLOCK.", auditor: "As Auditor: record the launch." };
    expect(DeskManifestSchema.safeParse({ ...manifest, turns: { ...manifest.turns, launch } }).success).toBe(true);
    const seated = DeskManifestSchema.parse({ ...manifest, turns: { launch: { ...launch, hooks: "As Hooks: the pool's hook.", treasury: "As Treasury: the fee split." } } });
    expect(Object.keys(seated.turns.launch ?? {})).toEqual(["scout", "risk", "auditor", "hooks", "treasury"]);
  });

  it("refuses a launch turn without Risk's verdict to ask for, or with a role that trades", () => {
    const launch = { scout: "As Scout: read the pair.", risk: "As Risk: a verdict.", auditor: "As Auditor: record the launch." };
    const { risk: _risk, ...noRisk } = launch;
    expect(DeskManifestSchema.safeParse({ ...manifest, turns: { launch: noRisk } }).success).toBe(false);
    expect(DeskManifestSchema.safeParse({ ...manifest, turns: { launch: { ...launch, trader: "As Trader: buy it." } } }).success).toBe(false);
  });
});

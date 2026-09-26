/**
 * Market facts in Sparky's prompt: what the question is about, and prices cited as the desk gave them.
 */

import type { DeskAsset, DeskMarket } from "@perkos/desk-contract";
import { describe, expect, it } from "vitest";

import { askedAbout, marketFacts, mostActive } from "../app/lib/marketFacts";

const asset = (ticker: string, name: string, extra: Partial<DeskAsset> = {}): DeskAsset => ({
  ticker,
  name: `${name} • Robinhood Token`,
  address: `0x${ticker.padEnd(40, "0").slice(0, 40).replace(/[^0-9a-f]/gi, "a")}`,
  decimals: 18,
  priceUsd: 100,
  priceAt: "2026-09-26T00:50:00.000Z",
  change24hPct: null,
  volume24hUsd: null,
  tradeable: true,
  logoUrl: null,
  ...extra,
});

const MARKET: DeskMarket = {
  chain: "robinhood",
  chainId: 4663,
  quoteSymbol: "USDG",
  observedAt: "2026-09-26T00:55:00.000Z",
  assets: [
    asset("AAPL", "Apple", { priceUsd: 341.6733 }),
    asset("AMC", "AMC Entertainment", { priceUsd: 2.95 }),
    asset("AMD", "AMD", { priceUsd: 630.99 }),
    asset("BE", "Bloom Energy"),
    asset("NVDA", "NVIDIA", { priceUsd: 225.17, tradeable: null }),
    asset("AAOI", "Applied Optoelectronics"),
    asset("ALL", "Allstate"),
  ],
};

const tickers = (q: string) => askedAbout(q, MARKET.assets).map((a) => a.ticker);

describe("askedAbout", () => {
  it("finds tickers in capitals, with a dollar sign, or typed in lowercase", () => {
    expect(tickers("How is NVDA doing?")).toEqual(["NVDA"]);
    expect(tickers("compare $amd and amc")).toEqual(["AMD", "AMC"]);
    expect(tickers("what about nvda.")).toEqual(["NVDA"]);
  });

  it("finds a company by its name", () => {
    expect(tickers("Is Apple cheaper than Nvidia today?")).toEqual(["AAPL", "NVDA"]);
    expect(askedAbout("How is Meta doing?", [asset("META", "Meta Platforms")]).map((a) => a.ticker)).toEqual(["META"]);
  });

  it("does not read common words as tickers or names", () => {
    expect(tickers("is it a good time to buy all of them, applied or not")).toEqual([]);
    expect(tickers("be careful")).toEqual([]);
    expect(tickers("BE")).toEqual(["BE"]);
  });
});

describe("marketFacts", () => {
  it("is empty without a market", () => {
    expect(marketFacts("EQLTY Desk", null, "NVDA?")).toBe("");
  });

  it("lists the assets and cites the prices asked about, with the desk's own history line", () => {
    const facts = marketFacts("EQLTY Desk", MARKET, "Should I look at NVDA or apple?", [
      { ticker: "NVDA", priceUsd: 225.17, change24hPct: null, points: [], source: "uniswap-rwa-1d", line: "NVDA moved from 210.10 to 228.30 over 5 days" },
    ]);
    expect(facts).toContain("Market of EQLTY Desk on robinhood, priced in USDG");
    expect(facts).toContain("Assets on this desk (7): AAPL, AMC, AMD, BE, NVDA, AAOI, ALL.");
    expect(facts).toMatch(/- NVDA \(NVIDIA\): 225\.17 USDG at \d{2}:\d{2}, tradeability unknown\. NVDA moved from 210\.10 to 228\.30 over 5 days\./);
    expect(facts).toMatch(/- AAPL \(Apple\): 341\.67 USDG at \d{2}:\d{2}, tradeable\./);
    expect(facts).toContain("never guess one");
  });

  it("says so when a price is missing", () => {
    const market = { ...MARKET, assets: [asset("AMD", "AMD", { priceUsd: null, priceAt: null })] };
    expect(marketFacts("EQLTY Desk", market, "AMD")).toContain("- AMD (AMD): no price right now, tradeable.");
  });

  it("summarizes a series that only has points", () => {
    const points = [224.15, 226.4, 223.9, 225.1].map((value, i) => ({ at: `2026-09-25T0${2 + i * 2}:00:00.000Z`, value }));
    const facts = marketFacts("EQLTY Desk", MARKET, "NVDA", [
      { ticker: "NVDA", priceUsd: 224.84, change24hPct: 0.3686, points, source: "uniswap-rwa-1h" },
    ]);
    expect(facts).toContain("6-hour range 223.90 to 226.40 USDG, +0.37% in 24h (uniswap-rwa-1h).");
  });

  it("summarizes a series without a line from its range", () => {
    const facts = marketFacts("EQLTY Desk", MARKET, "AMD", [
      { ticker: "AMD", priceUsd: 630.99, change24hPct: null, points: [], source: "uniswap-rwa-1d", days: 5, low: 600, high: 640.5, changePct: 2.5 },
    ]);
    expect(facts).toContain("5-day range 600.00 to 640.50 USDG, +2.50% over it (uniswap-rwa-1d).");
  });

  it("answers an open question from the desk's most active assets", () => {
    const market = {
      ...MARKET,
      assets: [
        asset("AAPL", "Apple", { volume24hUsd: 5000, change24hPct: 1.2 }),
        asset("AMD", "AMD", { volume24hUsd: 9000, change24hPct: -2.4 }),
        asset("BE", "Bloom Energy", { volume24hUsd: null, change24hPct: 7.5 }),
        asset("NVDA", "NVIDIA", { volume24hUsd: 12000, tradeable: null }),
        asset("ALL", "Allstate", { priceUsd: null }),
      ],
    };
    expect(mostActive(market.assets).map((a) => a.ticker)).toEqual(["AMD", "AAPL", "BE"]);
    const facts = marketFacts("EQLTY Desk", market, "What should I buy this month?");
    expect(facts).toContain("Most active on this desk now:");
    expect(facts).toMatch(/- AMD \(AMD\): 100\.00 USDG at \d{2}:\d{2}, -2\.40% in 24h, tradeable\./);
    expect(facts).not.toContain("Prices of what the person asked about");
    expect(facts).toContain("Never suggest ETFs, funds or tickers that are not in its list");
  });
});

/**
 * Market facts in Sparky's prompt: what the question is about, and prices cited as the desk gave them.
 */

import type { DeskAsset, DeskMarket } from "@perkos/desk-contract";
import { describe, expect, it } from "vitest";

import { askedAbout, candidates, factLines, MAX_CANDIDATES, marketFacts, mostActive, spreadOf } from "../app/lib/marketFacts";

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
    expect(facts).toContain("Never suggest a ticker that is not in its list");
    expect(facts).not.toContain("ETF");
  });

  it("says so plainly when the desk reports no 24h activity, and spreads the sample", () => {
    const tickers = ["AAOI", "AAPL", "AMBA", "AMC", "AMD", "AMZN", "ASML", "AVGO", "BND", "COIN", "GLD", "MSFT", "NVDA", "SGOV", "SPY", "TSLA"];
    const market = { ...MARKET, assets: tickers.map((t) => asset(t, t)) };
    const sample = spreadOf(market.assets).map((a) => a.ticker);
    expect(sample).toHaveLength(8);
    expect(sample).toEqual(["AAOI", "AMBA", "AMD", "ASML", "BND", "GLD", "NVDA", "SPY"]);
    const facts = marketFacts("EQLTY Desk", market, "What should I buy this month?");
    expect(facts).toContain("the desk reports no 24h volume or change right now");
    expect(facts).not.toContain("Most active on this desk now:");
  });
});

describe("numbered facts for the team", () => {
  it("numbers the assets in the order given, with the same text Sparky's facts use", () => {
    const lines = factLines(MARKET, [MARKET.assets[4]!, MARKET.assets[0]!], [
      { ticker: "NVDA", priceUsd: 225.17, change24hPct: null, points: [], source: "uniswap-rwa-1d", line: "NVDA moved from 210.10 to 228.30 over 5 days" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[F1\] NVDA \(NVIDIA\): 225\.17 USDG at \d{2}:\d{2}, tradeability unknown\. NVDA moved from 210\.10 to 228\.30 over 5 days\.$/);
    expect(lines[1]).toMatch(/^\[F2\] AAPL \(Apple\): 341\.67 USDG at \d{2}:\d{2}, tradeable\.$/);
    expect(factLines(MARKET, [MARKET.assets[4]!, MARKET.assets[0]!])).toEqual(factLines(MARKET, [MARKET.assets[4]!, MARKET.assets[0]!]));
  });

  it("keeps Sparky's own facts free of the tags", () => {
    expect(marketFacts("EQLTY Desk", MARKET, "NVDA")).not.toMatch(/\[F\d+\]/);
  });
});

describe("candidates for an open question", () => {
  const market: DeskMarket = {
    ...MARKET,
    assets: [
      asset("AAPL", "Apple", { volume24hUsd: 5_000_000, change24hPct: 0.4 }),
      asset("NVDA", "NVIDIA", { volume24hUsd: 25_000_000, change24hPct: -1.5 }),
      asset("AMD", "AMD", { volume24hUsd: null, change24hPct: 3.1 }),
      asset("TSLA", "Tesla", { volume24hUsd: null, change24hPct: -4.2 }),
      asset("MSFT", "Microsoft", { volume24hUsd: 5_000_000, change24hPct: -2.0 }),
      asset("BE", "Bloom Energy", { volume24hUsd: null, change24hPct: null }),
      asset("AMC", "AMC Entertainment", { volume24hUsd: null, change24hPct: null }),
      asset("HOOD", "Robinhood", { volume24hUsd: 90_000_000, tradeable: false }),
      asset("COIN", "Coinbase", { volume24hUsd: 80_000_000, tradeable: null }),
      asset("PLTR", "Palantir", { volume24hUsd: 70_000_000, priceUsd: null }),
    ],
  };

  it("leaves out what the desk cannot trade or has not priced, and sorts by volume, then move, then ticker", () => {
    expect(candidates(market).map((a) => a.ticker)).toEqual(["NVDA", "MSFT", "AAPL", "TSLA", "AMD", "AMC", "BE"]);
  });

  it("stops at twelve", () => {
    const many: DeskMarket = { ...MARKET, assets: Array.from({ length: 20 }, (_, i) => asset(`T${String(i).padStart(2, "0")}`, `Company ${i}`, { volume24hUsd: i })) };
    expect(MAX_CANDIDATES).toBe(12);
    expect(candidates(many)).toHaveLength(12);
    expect(candidates(many)[0]?.ticker).toBe("T19");
    expect(candidates(many, 3).map((a) => a.ticker)).toEqual(["T19", "T18", "T17"]);
  });
});

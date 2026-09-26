/**
 * Uniswap's executable price as facts in a desk turn: the size the question
 * asks about, one line per quote, and nothing when a quote does not come back.
 */

import type { DeskQuote } from "@perkos/client";
import type { DeskAsset } from "@perkos/desk-contract";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SIZE, quoteLine, turnSize, uniswapFacts } from "../app/lib/uniswapFacts";

const quote = (ticker: string, extra: Partial<DeskQuote> = {}): DeskQuote => ({
  chainId: 4663,
  ticker,
  tokenIn: { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 },
  tokenOut: { symbol: ticker, address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
  amountIn: "50000000",
  amountOut: "274100000000000000",
  priceImpactPct: 0.1234,
  routing: "CLASSIC",
  protocols: ["V4"],
  requestId: "0f3c9a51-7d2e",
  quotedAt: null,
  gasFeeUsd: null,
  ...extra,
});
const asset = (ticker: string, tradeable = true): DeskAsset => ({
  ticker,
  name: ticker,
  address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  decimals: 18,
  priceUsd: 100,
  priceAt: null,
  change24hPct: null,
  volume24hUsd: null,
  tradeable,
  logoUrl: null,
});

describe("the turn's size", () => {
  it("reads the amount the question names, and keeps it under what one order may spend", () => {
    expect(turnSize("What should I buy with 50 USDG?")).toBe(50);
    expect(turnSize("Buy $25 of NVDA")).toBe(25);
    expect(turnSize("¿Qué compro con 30 dólares?")).toBe(30);
    expect(turnSize("How much NVDA do 12.5 usdg buy?")).toBe(12.5);
    expect(turnSize("Buy $500 of NVDA", 100)).toBe(100);
    expect(turnSize("How is NVDA doing today?")).toBe(DEFAULT_SIZE);
    expect(turnSize("How is NVDA doing today?", 20)).toBe(20);
  });
});

describe("a quote as a fact", () => {
  it("says what the size buys, at what price each, with the impact, the route and the request", () => {
    expect(quoteLine(quote("NVDA"), "NVDA")).toBe("Uniswap now: 50.00 USDG buys 0.2741 NVDA (182.42 USDG each), price impact 0.12%, V4 route, request 0f3c9a51-7d2e, chain 4663.");
    expect(quoteLine(quote("NVDA", { priceImpactPct: null, protocols: [], requestId: null }), "NVDA")).toBe("Uniswap now: 50.00 USDG buys 0.2741 NVDA (182.42 USDG each), CLASSIC route, chain 4663.");
  });

  it("quotes the first few tradeable assets in the turn's order, and leaves out the ones that do not come back", async () => {
    const trade = {
      quote: vi.fn(async (_module: string, ticker: string, _size: string) => {
        if (ticker === "AAPL") throw new Error("no route");
        return quote(ticker);
      }),
    };
    const lines = await uniswapFacts(trade, "stocks-robinhood", [asset("NVDA"), asset("HOLD", false), asset("AAPL"), asset("SPY"), asset("AMD")], 50);
    expect(trade.quote.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["NVDA", "50"],
      ["AAPL", "50"],
      ["SPY", "50"],
    ]);
    expect(lines.map((l) => l.split(" ").slice(5, 7).join(" "))).toEqual(["0.2741 NVDA", "0.2741 SPY"]);
  });
});

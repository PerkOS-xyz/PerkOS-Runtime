/**
 * How the Portfolio reads a desk's portfolio: signed money and percent, the
 * direction of a number beside its color, each position's share of the
 * whole, what a swap's status says, the sentences for what the view cannot
 * vouch for, and the launches the local route may answer.
 */

import type { DeskPortfolio, PortfolioPosition } from "@perkos/client";
import { describe, expect, it } from "vitest";

import { launchesOf, money, notesOf, perShare, shareOf, signedMoney, signedPct, SWAP_STATE, swapReachedChain, toneOf, usdgText, wholeText } from "../app/desks/portfolio";

const position = (o: Partial<PortfolioPosition> = {}): PortfolioPosition => ({
  ticker: "NVDA",
  name: "NVIDIA • Robinhood Token",
  address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  decimals: 18,
  amount: "100000000000000000",
  price: 180,
  change24hPct: 1.5,
  logoUrl: null,
  value: 18,
  spent: "30000000",
  received: "150000000000000000",
  avgCost: 200,
  cost: 20,
  pnl: -2,
  pnlPct: -10,
  buys: 2,
  lastBuyAt: "2026-09-22T10:00:00.000Z",
  ...o,
});

const portfolio = (o: Partial<DeskPortfolio> = {}): DeskPortfolio => ({
  delegated: true,
  wallet: "0x6732c0829808e8286012f53462013104289025b4",
  chainId: 4663,
  input: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  cash: null,
  gas: { ok: true, wei: "2000000000000000" },
  positions: [position()],
  totals: { value: 18, cost: 20, pnl: -2, pnlPct: -10, unpriced: 0, uncosted: 0 },
  swaps: [],
  marketAvailable: true,
  history: "complete",
  ...o,
});

describe("money and percent", () => {
  it("signs money and percent with a real minus, and keeps cents", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(-2)).toBe("−$2.00");
    expect(signedMoney(0.5)).toBe("+$0.50");
    expect(signedMoney(-2)).toBe("−$2.00");
    expect(signedMoney(0)).toBe("$0.00");
    expect(signedPct(1.1111)).toBe("+1.11%");
    expect(signedPct(-10)).toBe("−10.00%");
    expect(signedPct(0)).toBe("0.00%");
  });

  it("never reads an amount above zero as $0.00", () => {
    expect(money(0.00018)).toBe("$0.00018");
    expect(signedMoney(-0.0004)).toBe("−$0.00040");
    expect(usdgText("12500000", 6)).toBe("12.50");
    expect(usdgText("4000", 6)).toBe("less than 0.01");
    expect(usdgText("0", 6)).toBe("0.00");
    expect(wholeText("0.050000")).toBe("0.05");
    expect(wholeText("20")).toBe("20");
    expect(wholeText("0.0000001")).toBe("less than 0.000001");
  });

  it("prices a share as the market does: four decimals under a dollar", () => {
    expect(perShare(180)).toBe("$180.00");
    expect(perShare(0.4231)).toBe("$0.4231");
    expect(perShare(1234.5)).toBe("$1,234.50");
  });

  it("points a number up, down or flat, and flat without one", () => {
    expect([toneOf(0.5), toneOf(-2), toneOf(0), toneOf(null)]).toEqual(["up", "down", "flat", "flat"]);
  });
});

describe("each position's share", () => {
  it("is its value over the total, and nothing without a price or a total", () => {
    expect(shareOf({ value: 27.5 }, 50.5)).toBeCloseTo(0.5446, 4);
    expect(shareOf({ value: null }, 50.5)).toBeNull();
    expect(shareOf({ value: 5 }, 0)).toBeNull();
  });
});

describe("swaps", () => {
  it("says what each status means, and links only a swap that went out", () => {
    expect(SWAP_STATE.success).toEqual({ label: "Bought", tone: "done" });
    expect(SWAP_STATE.pending.label).toBe("Not confirmed");
    expect(SWAP_STATE.reverted.label).toBe("Reverted");
    expect(SWAP_STATE.not_sent.label).toBe("Not sent");
    expect(swapReachedChain("pending")).toBe(true);
    expect(swapReachedChain("not_sent")).toBe(false);
  });
});

describe("what the view cannot vouch for", () => {
  it("says nothing when every figure is there", () => {
    expect(notesOf(portfolio())).toEqual([]);
  });

  it("names the market and the log when they did not answer, before the figures they leave out", () => {
    const notes = notesOf(portfolio({ marketAvailable: false, history: "unavailable", positions: [position({ value: null, cost: null, pnl: null })] }));
    expect(notes.map((n) => n.tone)).toEqual(["warn", "warn"]);
    expect(notes[0]?.text).toContain("market did not answer");
    expect(notes[1]?.text).toContain("could not be read");
  });

  it("says when the log was read only in part", () => {
    expect(notesOf(portfolio({ history: "partial" }))).toEqual([{ tone: "warn", text: expect.stringContaining("some buys may be left out") }]);
  });

  it("names each stock with no price or no buy on record", () => {
    const notes = notesOf(
      portfolio({
        positions: [position(), position({ ticker: "TSLA", cost: null, pnl: null, pnlPct: null, avgCost: null }), position({ ticker: "AAPL", value: null, pnl: null, pnlPct: null })],
      }),
    );
    expect(notes).toEqual([
      { tone: "info", text: "No price right now for AAPL, so its value is left out of the totals." },
      { tone: "info", text: "No buy on record for TSLA, so it shows no cost or P&L. P&L counts the positions with both." },
    ]);
    const two = notesOf(portfolio({ positions: [position({ ticker: "TSLA", cost: null }), position({ ticker: "AAPL", cost: null }), position({ ticker: "MSFT", cost: null })] }));
    expect(two[0]?.text).toBe("No buy on record for TSLA, AAPL and MSFT, so they show no cost or P&L. P&L counts the positions with both.");
  });
});

describe("launches", () => {
  const TOKEN = "0x56663ecfbe0547b493d348d5fc30de521864eba3";

  it("reads a launch with its links and fees, and keeps only http(s) links", () => {
    expect(
      launchesOf({
        launches: [
          {
            tokenAddress: TOKEN,
            name: "Two-Table Cafe",
            symbol: "CAFE",
            poolId: "0xpool",
            pairedSymbol: "WETH",
            deployedAt: "2026-09-20T10:00:00.000Z",
            links: { uniswap: "https://app.uniswap.org/explore/tokens/base/0x", bankr: "javascript:alert(1)" },
            fees: { claimableUsd: 12.4, claimedUsd: 3.1 },
          },
        ],
      }),
    ).toEqual([
      {
        tokenAddress: TOKEN,
        name: "Two-Table Cafe",
        symbol: "CAFE",
        poolId: "0xpool",
        pairedSymbol: "WETH",
        deployedAt: "2026-09-20T10:00:00.000Z",
        links: { uniswap: "https://app.uniswap.org/explore/tokens/base/0x", bankr: null, explorer: null },
        fees: { claimableUsd: 12.4, claimedUsd: 3.1 },
      },
    ]);
  });

  it("reads none from an empty list, a 404 page or a launch without an address or a symbol", () => {
    expect(launchesOf({ launches: [] })).toEqual([]);
    expect(launchesOf(null)).toEqual([]);
    expect(launchesOf("<html>404</html>")).toEqual([]);
    expect(launchesOf({ launches: [{ symbol: "CAFE" }, { tokenAddress: TOKEN }, { tokenAddress: "0x12", symbol: "BAD" }] })).toEqual([]);
    expect(launchesOf({ launches: [{ tokenAddress: TOKEN, symbol: "CAFE", fees: {} }] })).toEqual([
      expect.objectContaining({ name: "CAFE", fees: null, links: { uniswap: null, bankr: null, explorer: null } }),
    ]);
  });
});

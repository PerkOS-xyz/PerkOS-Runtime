/**
 * How the Portfolio reads a desk's portfolio: money and percent with their
 * sign, which way a number points, how much of the whole each position is,
 * what a swap's status means in words, what the view cannot vouch for, and
 * the launches the owner made, when Runtime knows of any. Pure, so the sheet
 * and the tests read it the same way.
 */

import type { DeskPortfolio, PortfolioPosition, SwapStatus } from "@perkos/client";
import { formatUnits } from "viem";

/** Which way a number points: its color and its arrow. */
export type Tone = "up" | "down" | "flat";

export const toneOf = (n: number | null): Tone => (n === null || n === 0 ? "flat" : n > 0 ? "up" : "down");

/** The arrow beside a signed number, so its direction never rests on color alone. */
export const ARROW: Record<Tone, string> = { up: "▲", down: "▼", flat: "■" };

const MINUS = "−";

/** "$1,234.56". An amount too small for cents keeps two significant digits: "$0.00018". */
export function money(n: number): string {
  const abs = Math.abs(n);
  const text = abs > 0 && abs < 0.005 ? abs.toPrecision(2) : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? MINUS : ""}$${text}`;
}

/** "+$0.50", "−$2.00", "$0.00". */
export const signedMoney = (n: number): string => `${n > 0 ? "+" : ""}${money(n)}`;

/** "+1.11%", "−10.00%", "0.00%". */
export const signedPct = (n: number): string => `${n > 0 ? "+" : n < 0 ? MINUS : ""}${Math.abs(n).toFixed(2)}%`;

/** A price a share, as the market shows one: two decimals, four under a dollar. */
export const perShare = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;

/** USDG for reading, always with cents: "12.50", or "less than 0.01" for a balance above zero that would read 0. */
export function usdgText(amount: string, decimals: number): string {
  const n = Number(formatUnits(BigInt(amount), decimals));
  if (n > 0 && n < 0.005) return "less than 0.01";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A whole-unit amount PerkOS wrote ("0.050000"), cut to `digits` decimals without trailing zeros. */
export function wholeText(text: string, digits = 6): string {
  const [whole = "0", frac = ""] = text.split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  if (cut) return `${whole}.${cut}`;
  // Above zero but too small for these digits: never read as 0.
  return whole === "0" && /[1-9]/.test(frac) ? `less than 0.${"0".repeat(Math.max(0, digits - 1))}1` : whole;
}

/** How much of what the positions are worth this one is, from 0 to 1; null without a price. */
export function shareOf(p: Pick<PortfolioPosition, "value">, total: number): number | null {
  if (p.value === null || !(total > 0)) return null;
  return Math.min(1, Math.max(0, p.value / total));
}

/** "Apple • Robinhood Token" reads as "Apple" in a row. */
export const shortName = (name: string): string => name.split(" • ")[0] ?? name;

/** What a swap's status means for the owner, and how its row is lit. */
export const SWAP_STATE: Record<SwapStatus, { label: string; tone: "done" | "pending" | "failed" | "dim" }> = {
  success: { label: "Bought", tone: "done" },
  pending: { label: "Not confirmed", tone: "pending" },
  reverted: { label: "Reverted", tone: "failed" },
  not_sent: { label: "Not sent", tone: "dim" },
};

/** Only a swap that went out has a page on the explorer. */
export const swapReachedChain = (status: SwapStatus): boolean => status !== "not_sent";

/** "TSLA", "TSLA and AAPL", "TSLA, AAPL and MSFT". */
function listOf(tickers: string[]): string {
  if (tickers.length <= 1) return tickers[0] ?? "";
  return `${tickers.slice(0, -1).join(", ")} and ${tickers[tickers.length - 1]}`;
}

export interface PortfolioNote {
  /** "warn": part of the view could not be read. "info": a figure left out, and why. */
  tone: "warn" | "info";
  text: string;
}

/** What this view cannot vouch for, each in one sentence, in the order it matters. */
export function notesOf(p: DeskPortfolio): PortfolioNote[] {
  const notes: PortfolioNote[] = [];
  if (!p.marketAvailable) notes.push({ tone: "warn", text: "The desk's market did not answer, so a stock or a price may be missing. Refresh in a moment." });
  if (p.history === "unavailable") {
    notes.push({ tone: "warn", text: "The Trader's buys could not be read right now, so costs and P&L are missing. Refresh in a moment." });
  } else if (p.history === "partial") {
    notes.push({ tone: "warn", text: "The Trader's log is longer than one read, so some buys may be left out of the costs." });
  }
  const unpriced = p.positions.filter((x) => x.value === null).map((x) => x.ticker);
  if (unpriced.length && p.marketAvailable) {
    notes.push({ tone: "info", text: `No price right now for ${listOf(unpriced)}, so ${unpriced.length === 1 ? "its" : "their"} value is left out of the totals.` });
  }
  const uncosted = p.positions.filter((x) => x.cost === null).map((x) => x.ticker);
  if (uncosted.length && p.history !== "unavailable") {
    notes.push({
      tone: "info",
      text: `No buy on record for ${listOf(uncosted)}, so ${uncosted.length === 1 ? "it shows" : "they show"} no cost or P&L. P&L counts the positions with both.`,
    });
  }
  return notes;
}

/** A token the owner launched, as the local launches route answers it. */
export interface Launch {
  tokenAddress: string;
  name: string;
  symbol: string;
  poolId: string | null;
  pairedSymbol: string | null;
  deployedAt: string | null;
  links: { uniswap: string | null; bankr: string | null; explorer: string | null };
  fees: { claimableUsd: number | null; claimedUsd: number | null } | null;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const usd = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
/** A link the sheet may open: http(s) only. */
const link = (v: unknown): string | null => {
  const t = text(v);
  return t && /^https?:\/\//i.test(t) ? t : null;
};

/**
 * The launches in an answer from /api/launches: each one with an address and
 * a symbol, the rest as far as it goes. Anything else, a 404 page included,
 * reads as none.
 */
export function launchesOf(body: unknown): Launch[] {
  const list = isObject(body) && Array.isArray(body.launches) ? body.launches : [];
  return list.flatMap((v): Launch[] => {
    if (!isObject(v)) return [];
    const symbol = text(v.symbol);
    const tokenAddress = text(v.tokenAddress);
    if (!symbol || !tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) return [];
    const links = isObject(v.links) ? v.links : {};
    const fees = isObject(v.fees) ? { claimableUsd: usd(v.fees.claimableUsd), claimedUsd: usd(v.fees.claimedUsd) } : null;
    return [
      {
        tokenAddress,
        name: text(v.name) ?? symbol,
        symbol,
        poolId: text(v.poolId),
        pairedSymbol: text(v.pairedSymbol),
        deployedAt: text(v.deployedAt),
        links: { uniswap: link(links.uniswap), bankr: link(links.bankr), explorer: link(links.explorer) },
        fees: fees && (fees.claimableUsd !== null || fees.claimedUsd !== null) ? fees : null,
      },
    ];
  });
}

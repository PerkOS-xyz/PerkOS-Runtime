/** PerkOS API client for the signed-in wallet. */

import { Desks, PerkosClient, type DeskSummary } from "@perkos/client";
import type { DeskMarket, DeskSeries } from "@perkos/desk-contract";

import { sessions } from "./session";

/** A client that sends the current session token, or null when signed out. */
export async function perkosClient(): Promise<PerkosClient | null> {
  const session = await sessions.current();
  if (!session) return null;
  return new PerkosClient({
    ...(process.env.PERKOS_API_URL ? { baseUrl: process.env.PERKOS_API_URL } : {}),
    token: () => session.accessToken,
  });
}

const CATALOGUE_TTL_MS = 5 * 60_000;
let catalogue: { token: string; at: number; desks: DeskSummary[] } | null = null;

/**
 * Desk catalogue for Sparky's prompt, cached for a few minutes. Empty when
 * signed out; the last known list when PerkOS does not answer.
 */
export async function cachedDesks(): Promise<DeskSummary[]> {
  const session = await sessions.current();
  if (!session) return [];
  if (catalogue && catalogue.token === session.accessToken && Date.now() - catalogue.at < CATALOGUE_TTL_MS) {
    return catalogue.desks;
  }
  try {
    const client = new PerkosClient({
      ...(process.env.PERKOS_API_URL ? { baseUrl: process.env.PERKOS_API_URL } : {}),
      token: () => session.accessToken,
    });
    const desks = await new Desks(client).catalogue("en");
    catalogue = { token: session.accessToken, at: Date.now(), desks };
    return desks;
  } catch {
    return catalogue?.desks ?? [];
  }
}

const MARKET_TTL_MS = 30_000;
const markets = new Map<string, { at: number; market: DeskMarket }>();

/** A desk's market for Sparky's prompt, cached for half a minute. The last known one, or null, when the desk does not answer. */
export async function cachedMarket(module: string): Promise<DeskMarket | null> {
  const hit = markets.get(module);
  if (hit && Date.now() - hit.at < MARKET_TTL_MS) return hit.market;
  const client = await perkosClient();
  if (!client) return null;
  try {
    const market = await new Desks(client).market(module);
    markets.set(module, { at: Date.now(), market });
    return market;
  } catch {
    return hit?.market ?? null;
  }
}

/** Keeps a market the app just read, so Sparky's next answer in that desk does not wait for it. */
export function rememberMarket(module: string, market: DeskMarket): void {
  markets.set(module, { at: Date.now(), market });
}

/** Price history of a few tickers, for the facts Sparky cites. Empty when the desk does not answer. */
export async function deskSeries(module: string, tickers: string[]): Promise<DeskSeries[]> {
  if (!tickers.length) return [];
  const client = await perkosClient();
  if (!client) return [];
  return new Desks(client).series(module, tickers).catch(() => []);
}

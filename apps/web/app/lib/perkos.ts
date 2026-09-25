/** PerkOS API client for the signed-in wallet. */

import { Desks, PerkosClient, type DeskSummary } from "@perkos/client";

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

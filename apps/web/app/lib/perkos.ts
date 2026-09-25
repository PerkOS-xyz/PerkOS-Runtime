/** PerkOS API client for the signed-in wallet. */

import { PerkosClient } from "@perkos/client";

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

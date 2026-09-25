/**
 * PerkOS session on this machine.
 *
 * Tokens stay on the server side of the app, in <home>/session.json (0600).
 * The window only learns whether there is a session and for which wallet.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PerkosAuth, type PerkosSession } from "@perkos/client";

import { ensureHome, homeDir } from "./home";

export class SessionStore {
  constructor(
    private readonly auth: PerkosAuth,
    private readonly dir: () => string = homeDir,
  ) {}

  private file() {
    return join(this.dir(), "session.json");
  }

  async load(): Promise<PerkosSession | null> {
    try {
      const s = JSON.parse(await readFile(this.file(), "utf8")) as PerkosSession;
      return s && typeof s.accessToken === "string" && typeof s.wallet === "string" ? s : null;
    } catch {
      return null;
    }
  }

  async save(session: PerkosSession): Promise<void> {
    await ensureHome();
    await writeFile(this.file(), JSON.stringify(session), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.file(), { force: true });
  }

  /** A usable session, refreshed and saved when close to expiry. Null when the wallet has to sign again. */
  async current(): Promise<PerkosSession | null> {
    const stored = await this.load();
    if (!stored) return null;
    const fresh = await this.auth.fresh(stored);
    if (!fresh) return null;
    if (fresh !== stored) await this.save(fresh);
    return fresh;
  }
}

export const perkosAuth = new PerkosAuth({
  ...(process.env.PERKOS_API_URL ? { apiUrl: process.env.PERKOS_API_URL } : {}),
  ...(process.env.PERKOS_OAUTH_URL ? { oauthUrl: process.env.PERKOS_OAUTH_URL } : {}),
});

export const sessions = new SessionStore(perkosAuth);

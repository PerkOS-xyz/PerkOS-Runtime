/**
 * The person's Bankr API key, for token launches. Never sent to the window,
 * never logged.
 *
 * The desktop app hands the server a per-device secret that the OS keeps
 * (PERKOS_DEVICE_SECRET, through Electron safeStorage). With it, the key is
 * sealed with AES-256-GCM in <home>/bankr.json (0600) and survives a restart.
 * Without one the key lives in this process for the session only, as the
 * vault key does, and nothing is written.
 *
 * The session copy sits on `globalThis`, so every route and a module reload
 * of the dev server read the same one.
 */

import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isSealed, open, seal } from "@perkos/vault";

import { ensureHome, homeDir } from "./home";

const SECRET = /^[0-9a-f]{64}$/;
/** Binds the sealed key to what it is, so no other sealed value opens in its place. */
const AAD = "bankr-key";

/**
 * A Bankr user key: bk_usr_{keyId}_{secret}. Partner keys (bk_ptr_) deploy
 * on Base only, so they are refused here with their own message.
 */
export const BANKR_KEY = /^bk_usr_[A-Za-z0-9_-]{16,200}$/;
export const BANKR_PARTNER_KEY = /^bk_ptr_/;

interface Held {
  key: string | null;
}

const HELD = Symbol.for("perkos.runtime.bankrKey");

function shared(): Held {
  const g = globalThis as unknown as Record<symbol, Held | undefined>;
  let held = g[HELD];
  if (!held) {
    held = { key: null };
    g[HELD] = held;
  }
  return held;
}

export class BankrKeyStore {
  constructor(
    private readonly dir: () => string = homeDir,
    private readonly deviceSecret: () => string | undefined = () => process.env.PERKOS_DEVICE_SECRET,
    private readonly held: Held = shared(),
  ) {}

  /** True when the key survives a restart on this device. */
  persistent(): boolean {
    return SECRET.test(this.deviceSecret()?.trim() ?? "");
  }

  /** The key the device secret seals with: its own, never the vault's. */
  private sealingKey(): Buffer | null {
    const secret = this.deviceSecret()?.trim() ?? "";
    return SECRET.test(secret) ? createHash("sha256").update(`perkos-bankr-v1|${secret}`).digest() : null;
  }

  private file() {
    return join(this.dir(), "bankr.json");
  }

  async load(): Promise<string | null> {
    if (this.held.key) return this.held.key;
    const sealing = this.sealingKey();
    if (!sealing) return null;
    try {
      const sealed: unknown = JSON.parse(await readFile(this.file(), "utf8"));
      const key = isSealed(sealed) ? open<string>(sealing, sealed, AAD) : null;
      if (typeof key !== "string" || !key) return null;
      this.held.key = key;
      return key;
    } catch {
      return null;
    }
  }

  async save(apiKey: string): Promise<void> {
    this.held.key = apiKey;
    const sealing = this.sealingKey();
    if (!sealing) {
      // Nothing on disk without a device secret: a key sealed before stays out of reach anyway.
      await rm(this.file(), { force: true });
      return;
    }
    await ensureHome();
    await writeFile(this.file(), JSON.stringify(seal(sealing, apiKey, AAD)), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    this.held.key = null;
    await rm(this.file(), { force: true });
  }
}

export const bankrKey = new BankrKeyStore();

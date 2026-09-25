/**
 * Keeps the derived vault key across restarts, on macOS, Windows and Linux.
 *
 * The desktop app provides a per-device secret, protected by the OS through
 * Electron safeStorage (Keychain, DPAPI or libsecret), and passes it to the
 * server as PERKOS_DEVICE_SECRET. The vault key is sealed with it in
 * <dir>/vault-keys/<wallet>.json. Without a device secret the key lives in
 * memory for the session only, and the wallet signs again next time.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isSealed, open, seal } from "./seal.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const SECRET = /^[0-9a-f]{64}$/;

export class KeyStore {
  private readonly memory = new Map<string, Buffer>();

  constructor(
    private readonly dir: () => string,
    private readonly deviceSecret: () => string | undefined = () => process.env.PERKOS_DEVICE_SECRET,
  ) {}

  /** True when keys survive a restart on this device. */
  persistent(): boolean {
    return SECRET.test(this.deviceSecret()?.trim() ?? "");
  }

  private deviceKey(): Buffer | null {
    const secret = this.deviceSecret()?.trim() ?? "";
    return SECRET.test(secret) ? createHash("sha256").update(`perkos-device-v1|${secret}`).digest() : null;
  }

  private file(wallet: string) {
    return join(this.dir(), "vault-keys", `${wallet}.json`);
  }

  async load(wallet: string): Promise<Buffer | null> {
    const w = wallet.toLowerCase();
    const hit = this.memory.get(w);
    if (hit) return hit;
    const device = this.deviceKey();
    if (!device || !ADDRESS.test(w)) return null;
    try {
      const sealed: unknown = JSON.parse(await readFile(this.file(w), "utf8"));
      const hex = isSealed(sealed) ? open<string>(device, sealed, `vault-key|${w}`) : null;
      if (!hex || !SECRET.test(hex)) return null;
      const key = Buffer.from(hex, "hex");
      this.memory.set(w, key);
      return key;
    } catch {
      return null;
    }
  }

  async save(wallet: string, key: Buffer): Promise<void> {
    const w = wallet.toLowerCase();
    if (!ADDRESS.test(w)) throw new Error("Not a wallet address");
    this.memory.set(w, key);
    const device = this.deviceKey();
    if (!device) return;
    await mkdir(join(this.dir(), "vault-keys"), { recursive: true, mode: 0o700 });
    await writeFile(this.file(w), JSON.stringify(seal(device, key.toString("hex"), `vault-key|${w}`)), { mode: 0o600 });
  }

  /** Forget the key on this device. */
  async forget(wallet: string): Promise<void> {
    const w = wallet.toLowerCase();
    this.memory.delete(w);
    if (ADDRESS.test(w)) await rm(this.file(w), { force: true });
  }
}

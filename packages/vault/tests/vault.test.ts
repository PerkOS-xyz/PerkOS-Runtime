/**
 * Vault crypto: key derivation, sealing with a path binding, and the key store.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveVaultKey, isSealed, KeyStore, open, seal, vaultKeyMessage } from "../src/index.ts";

const WALLET = "0xAbC0000000000000000000000000000000000001";

describe("vault key", () => {
  it("names the wallet in the message and says it moves no funds", () => {
    const m = vaultKeyMessage(WALLET);
    expect(m).toContain(WALLET.toLowerCase());
    expect(m).toContain("moves no funds");
  });

  it("derives the same 32-byte key from the same signature, whatever the case", () => {
    const a = deriveVaultKey(WALLET, "0xABCDEF");
    const b = deriveVaultKey(WALLET.toLowerCase(), "0xabcdef");
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(deriveVaultKey(WALLET, "0xabcdee"))).toBe(false);
  });
});

describe("seal and open", () => {
  const key = deriveVaultKey(WALLET, "0x01");

  it("round-trips a value", () => {
    const sealed = seal(key, { title: "Journal", body: "Asked about NVDA." }, "user/journal/2026-09-26");
    expect(isSealed(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("NVDA");
    expect(open(key, sealed, "user/journal/2026-09-26")).toEqual({ title: "Journal", body: "Asked about NVDA." });
  });

  it("refuses the wrong key, the wrong path and a tampered ciphertext", () => {
    const sealed = seal(key, "secret", "a");
    expect(open(deriveVaultKey(WALLET, "0x02"), sealed, "a")).toBeNull();
    expect(open(key, sealed, "b")).toBeNull();
    const ct = Buffer.from(sealed.ct, "base64");
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(open(key, { ...sealed, ct: ct.toString("base64") }, "a")).toBeNull();
  });
});

describe("KeyStore", () => {
  const SECRET = "ab".repeat(32);
  const tmp = () => mkdtempSync(join(tmpdir(), "perkos-vault-"));

  it("keeps the key across restarts when the device provides a secret", async () => {
    const dir = tmp();
    const key = deriveVaultKey(WALLET, "0x01");
    const first = new KeyStore(() => dir, () => SECRET);
    expect(first.persistent()).toBe(true);
    await first.save(WALLET, key);
    const onDisk = readFileSync(join(dir, "vault-keys", `${WALLET.toLowerCase()}.json`), "utf8");
    expect(onDisk).not.toContain(key.toString("hex"));
    const again = await new KeyStore(() => dir, () => SECRET).load(WALLET);
    expect(again?.equals(key)).toBe(true);
  });

  it("cannot read the key with another device secret", async () => {
    const dir = tmp();
    await new KeyStore(() => dir, () => SECRET).save(WALLET, deriveVaultKey(WALLET, "0x01"));
    expect(await new KeyStore(() => dir, () => "cd".repeat(32)).load(WALLET)).toBeNull();
  });

  it("keeps the key in memory only without a device secret, and forgets", async () => {
    const dir = tmp();
    const store = new KeyStore(() => dir, () => undefined);
    expect(store.persistent()).toBe(false);
    await store.save(WALLET, deriveVaultKey(WALLET, "0x01"));
    expect(await store.load(WALLET)).not.toBeNull();
    expect(await new KeyStore(() => dir, () => undefined).load(WALLET)).toBeNull();
    await store.forget(WALLET);
    expect(await store.load(WALLET)).toBeNull();
  });
});

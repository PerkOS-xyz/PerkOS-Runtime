/**
 * /api/vault: unlock with the wallet's signature, persist with the device secret, lock.
 */

import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveVaultKey, NoteStore, vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET, POST } from "../app/api/vault/route";
import { memoryFor } from "../app/lib/memory";

const account = privateKeyToAccount(generatePrivateKey());
const wallet = account.address.toLowerCase();
const req = (method: string, body?: unknown) =>
  new Request("http://127.0.0.1:3100/api/vault", {
    method,
    headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  process.env.PERKOS_DEVICE_SECRET = "ab".repeat(32);
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
});
afterEach(async () => {
  // The key store keeps unlocked keys in memory for the process: lock between tests.
  await DELETE(req("DELETE"));
  delete process.env.PERKOS_HOME;
  delete process.env.PERKOS_DEVICE_SECRET;
});

describe("/api/vault", () => {
  it("starts locked and gives the message to sign", async () => {
    const body = await (await GET(req("GET"))).json();
    expect(body).toMatchObject({ unlocked: false, persistent: true, message: vaultKeyMessage(wallet) });
  });

  it("unlocks with the wallet's signature and keeps the key sealed on this device", async () => {
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
    const res = await POST(req("POST", { signature }));
    expect(await res.json()).toEqual({ unlocked: true, persistent: true });
    expect(await readdir(join(home, "vault-keys"))).toEqual([`${wallet}.json`]);
    expect(await (await GET(req("GET"))).json()).toMatchObject({ unlocked: true });
  });

  it("rejects a signature from another wallet", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: vaultKeyMessage(wallet) });
    const res = await POST(req("POST", { signature }));
    expect(res.status).toBe(400);
    expect(await (await GET(req("GET"))).json()).toMatchObject({ unlocked: false });
  }, 20_000);

  it("turns on again with the same signature after being turned off", async () => {
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
    await POST(req("POST", { signature }));
    await DELETE(req("DELETE"));
    expect((await POST(req("POST", { signature }))).status).toBe(200);
  });

  it("keeps a memory made with another key locked, and can start a new one", async () => {
    const oldKey = deriveVaultKey(wallet, "0x01");
    const before = new NoteStore(join(home, "vault", wallet), oldKey);
    await before.claim();
    await before.appendJournal("user", "from before");
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });

    const res = await POST(req("POST", { signature }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "other_key" });
    expect(await (await GET(req("GET"))).json()).toMatchObject({ unlocked: false });

    expect(await (await POST(req("POST", { signature, fresh: true }))).json()).toEqual({ unlocked: true, persistent: true });
    const aside = (await readdir(join(home, "vault"))).filter((d) => d !== wallet);
    expect(aside).toHaveLength(1);
    const kept = await new NoteStore(join(home, "vault", aside[0]!), oldKey).list();
    expect(kept.map((n) => n.body)).toEqual(["from before"]);
  });

  it("opens the notes only while memory is on", async () => {
    expect(await memoryFor(wallet)).toBeNull();
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
    await POST(req("POST", { signature }));
    const notes = await memoryFor(wallet);
    expect(notes).not.toBeNull();
    expect(await memoryFor(wallet)).toBe(notes);
    await DELETE(req("DELETE"));
    expect(await memoryFor(wallet)).toBeNull();
  });

  it("locks by forgetting the key on this device", async () => {
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
    await POST(req("POST", { signature }));
    await DELETE(req("DELETE"));
    expect(await readdir(join(home, "vault-keys"))).toEqual([]);
  });
});

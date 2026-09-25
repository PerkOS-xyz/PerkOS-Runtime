/**
 * Session store: file round trip, permissions and refresh.
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PerkosAuth, type PerkosSession } from "@perkos/client";

import { SessionStore } from "../app/lib/session";

const NOW = 1_800_000_000_000;

const session = (over: Partial<PerkosSession> = {}): PerkosSession => ({
  wallet: "0xabc0000000000000000000000000000000000001",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: NOW + 10 * 60_000,
  refreshExpiresAt: NOW + 86_400_000,
  ...over,
});

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

async function storeWith(http: ReturnType<typeof vi.fn> = vi.fn()) {
  const dir = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  const auth = new PerkosAuth({ fetchImpl: http as unknown as typeof fetch, now: () => NOW });
  return { dir, store: new SessionStore(auth, () => dir) };
}

describe("session store", () => {
  it("saves with owner-only permissions and loads it back", async () => {
    const { dir, store } = await storeWith();
    await store.save(session());
    expect((await stat(join(dir, "session.json"))).mode & 0o777).toBe(0o600);
    expect(await store.load()).toEqual(session());
  });

  it("returns null after clear or when nothing is stored", async () => {
    const { store } = await storeWith();
    expect(await store.load()).toBeNull();
    await store.save(session());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("refreshes a token close to expiry and saves the new one", async () => {
    const http = vi.fn(async () => reply(200, { access_token: "access-2", expires_in: 900 }));
    const { store } = await storeWith(http);
    await store.save(session({ expiresAt: NOW + 10_000 }));
    expect((await store.current())?.accessToken).toBe("access-2");
    expect((await store.load())?.accessToken).toBe("access-2");
  });

  it("returns null when the wallet has to sign again", async () => {
    const http = vi.fn(async () => reply(400, { error: "invalid_grant" }));
    const { store } = await storeWith(http);
    await store.save(session({ expiresAt: NOW }));
    expect(await store.current()).toBeNull();
  });
});

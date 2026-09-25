/**
 * Wallet sign-in: nonce, token exchange and refresh.
 */

import { describe, expect, it, vi } from "vitest";

import { PerkosApiError, PerkosAuth, WALLET_GRANT, type PerkosSession } from "../src/index.js";

const ADDRESS = "0xAbC0000000000000000000000000000000000001";
const NOW = 1_800_000_000_000;

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const authWith = (http: (url: string, init?: RequestInit) => Promise<Response>) =>
  new PerkosAuth({ fetchImpl: http as unknown as typeof fetch, now: () => NOW });

const session = (over: Partial<PerkosSession> = {}): PerkosSession => ({
  wallet: ADDRESS.toLowerCase(),
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: NOW + 10 * 60_000,
  refreshExpiresAt: NOW + 86_400_000,
  ...over,
});

describe("challenge", () => {
  it("requests a nonce for the lowercase address", async () => {
    const http = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.perkos.xyz/auth/nonce?address=${ADDRESS.toLowerCase()}`);
      return reply(200, { nonce: "n1", message: "PerkOS wants to sign you in.", expiresAt: NOW + 300_000 });
    });
    expect(await authWith(http).challenge(ADDRESS)).toEqual({ nonce: "n1", message: "PerkOS wants to sign you in." });
  });

  it("rejects a malformed address without a request", async () => {
    const http = vi.fn();
    await expect(authWith(http).challenge("0x123")).rejects.toMatchObject({ code: "PERKOS_ADDRESS" });
    expect(http).not.toHaveBeenCalled();
  });
});

describe("signIn", () => {
  it("sends the wallet grant and returns a session", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth.perkos.xyz/oauth2/token");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        grant_type: WALLET_GRANT,
        address: ADDRESS.toLowerCase(),
        nonce: "n1",
        signature: "0xsig",
      });
      return reply(200, { access_token: "a", expires_in: 900, refresh_token: "r", refresh_expires_in: 2_592_000, scope: "board:read" });
    });
    const out = await authWith(http).signIn({ address: ADDRESS, nonce: "n1", signature: "0xsig" });
    expect(out).toEqual({
      wallet: ADDRESS.toLowerCase(),
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW + 900_000,
      refreshExpiresAt: NOW + 2_592_000_000,
      scope: "board:read",
    });
  });

  it("maps 402 to INFRA_PAYMENT_REQUIRED", async () => {
    const http = vi.fn(async () => reply(402, { error: "payment_required" }));
    await expect(authWith(http).signIn({ address: ADDRESS, nonce: "n", signature: "s" })).rejects.toMatchObject({
      status: 402,
      code: "INFRA_PAYMENT_REQUIRED",
    });
  });

  it("keeps the OAuth error code and description", async () => {
    const http = vi.fn(async () => reply(400, { error: "invalid_grant", error_description: "Nonce expired" }));
    const err = await authWith(http).signIn({ address: ADDRESS, nonce: "n", signature: "s" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PerkosApiError);
    expect(err).toMatchObject({ code: "invalid_grant", message: "Nonce expired" });
  });
});

describe("fresh", () => {
  it("returns the session unchanged while the access token is valid", async () => {
    const http = vi.fn();
    const s = session();
    expect(await authWith(http).fresh(s)).toBe(s);
    expect(http).not.toHaveBeenCalled();
  });

  it("refreshes near expiry and keeps the refresh token when none is returned", async () => {
    const http = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1" });
      return reply(200, { access_token: "access-2", expires_in: 900 });
    });
    const out = await authWith(http).fresh(session({ expiresAt: NOW + 30_000 }));
    expect(out).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-1", expiresAt: NOW + 900_000 });
  });

  it("returns null when the refresh token has expired or is rejected", async () => {
    const http = vi.fn(async () => reply(400, { error: "invalid_grant" }));
    const auth = authWith(http);
    expect(await auth.fresh(session({ expiresAt: NOW, refreshExpiresAt: NOW - 1 }))).toBeNull();
    expect(http).not.toHaveBeenCalled();
    expect(await auth.fresh(session({ expiresAt: NOW }))).toBeNull();
  });

  it("throws when PerkOS is unreachable", async () => {
    const http = vi.fn(async () => Promise.reject(new Error("timed out")));
    await expect(authWith(http).fresh(session({ expiresAt: NOW }))).rejects.toMatchObject({ code: "PERKOS_UNREACHABLE" });
  });
});

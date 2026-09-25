/**
 * Grok sign-in by device code: start, poll, refresh and storage.
 */

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { XaiAuth } from "../app/lib/xai";

const NOW = 1_800_000_000_000;
const DISCOVERY = {
  device_authorization_endpoint: "https://auth.x.ai/oauth2/device",
  token_endpoint: "https://auth.x.ai/oauth2/token",
};

type Handler = (body: URLSearchParams) => { status: number; json: unknown };

function xai(tokenHandler: Handler, discovery: Record<string, string> = DISCOVERY) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status });
    if (url.endsWith("/.well-known/openid-configuration")) return reply(200, discovery);
    if (url === discovery.device_authorization_endpoint) {
      return reply(200, { device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "https://accounts.x.ai/device", expires_in: 600, interval: 5 });
    }
    const r = tokenHandler(new URLSearchParams(String(init?.body)));
    return reply(r.status, r.json);
  });
}

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
});
afterEach(() => {
  delete process.env.PERKOS_HOME;
});

describe("device sign-in", () => {
  it("starts a device login and keeps the device code on the server", async () => {
    const auth = new XaiAuth(xai(() => ({ status: 400, json: {} })) as unknown as typeof fetch, () => NOW);
    const start = await auth.start();
    expect(start).toEqual({ userCode: "ABCD-1234", verificationUri: "https://accounts.x.ai/device", expiresAt: NOW + 600_000, intervalMs: 5_000 });
    expect(JSON.stringify(start)).not.toContain("dev-1");
    expect((await stat(join(home, "xai-pending.json"))).mode & 0o777).toBe(0o600);
  });

  it("reports pending, then saves the tokens once approved", async () => {
    let approved = false;
    const auth = new XaiAuth(
      xai((body) => {
        expect(body.get("device_code")).toBe("dev-1");
        return approved
          ? { status: 200, json: { access_token: "a1", refresh_token: "r1", expires_in: 3600 } }
          : { status: 400, json: { error: "authorization_pending" } };
      }) as unknown as typeof fetch,
      () => NOW,
    );
    await auth.start();
    expect(await auth.poll()).toEqual({ status: "pending", intervalMs: 5_000 });
    approved = true;
    expect(await auth.poll()).toEqual({ status: "ok" });
    expect(JSON.parse(await readFile(join(home, "xai-oauth.json"), "utf8"))).toEqual({ accessToken: "a1", refreshToken: "r1", expiresAt: NOW + 3_600_000 });
    expect((await stat(join(home, "xai-oauth.json"))).mode & 0o777).toBe(0o600);
    // The device code is used once.
    expect(await auth.poll()).toEqual({ status: "expired" });
  });

  it("reports a denied login", async () => {
    const auth = new XaiAuth(xai(() => ({ status: 400, json: { error: "access_denied" } })) as unknown as typeof fetch, () => NOW);
    await auth.start();
    expect(await auth.poll()).toEqual({ status: "denied" });
  });

  it("says x.ai could not be reached on a network failure", async () => {
    const down = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    await expect(new XaiAuth(down as unknown as typeof fetch, () => NOW).start()).rejects.toThrow("Could not reach x.ai. Try again.");
  });

  it("rejects endpoints outside x.ai", async () => {
    const evil = { device_authorization_endpoint: "https://evil.example/device", token_endpoint: "https://auth.x.ai/token" };
    const auth = new XaiAuth(xai(() => ({ status: 400, json: {} }), evil) as unknown as typeof fetch, () => NOW);
    await expect(auth.start()).rejects.toThrow("not on an x.ai host");
  });
});

describe("access token", () => {
  it("refreshes near expiry and saves the rotated refresh token", async () => {
    let now = NOW;
    const auth = new XaiAuth(
      xai((body) => {
        if (body.get("grant_type") === "refresh_token") {
          expect(body.get("refresh_token")).toBe("r1");
          return { status: 200, json: { access_token: "a2", refresh_token: "r2", expires_in: 3600 } };
        }
        return { status: 200, json: { access_token: "a1", refresh_token: "r1", expires_in: 3600 } };
      }) as unknown as typeof fetch,
      () => now,
    );
    await auth.start();
    await auth.poll();
    expect(await auth.accessToken()).toBe("a1");
    now = NOW + 3_600_000;
    expect(await auth.accessToken()).toBe("a2");
    expect((await auth.loadTokens())?.refreshToken).toBe("r2");
  });

  it("returns null when signed out, and after sign out", async () => {
    const auth = new XaiAuth(xai(() => ({ status: 200, json: { access_token: "a1", refresh_token: "r1" } })) as unknown as typeof fetch, () => NOW);
    expect(await auth.accessToken()).toBeNull();
    await auth.start();
    await auth.poll();
    expect(await auth.signedIn()).toBe(true);
    await auth.signOut();
    expect(await auth.accessToken()).toBeNull();
  });
});

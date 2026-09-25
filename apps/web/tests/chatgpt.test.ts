/**
 * ChatGPT sign-in by the OpenAI device flow: start, poll, exchange, refresh.
 */

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatgptAuth, CHATGPT_VERIFICATION_URI } from "../app/lib/chatgpt";

const NOW = 1_800_000_000_000;
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

type Route = (init: RequestInit) => { status: number; json: unknown };

function openai(routes: Record<string, Route>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return new Response("{}", { status: 404 });
    const r = route(init ?? {});
    return new Response(JSON.stringify(r.json), { status: r.status });
  });
}

const usercode: Route = () => ({ status: 200, json: { user_code: "ABCD-EFGH", device_auth_id: "dev-1", interval: "5" } });

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
});
afterEach(() => {
  delete process.env.PERKOS_HOME;
});

describe("device sign-in", () => {
  it("starts with a user code and keeps the device ids on the server", async () => {
    const auth = new ChatgptAuth(openai({ "/api/accounts/deviceauth/usercode": usercode }) as unknown as typeof fetch, () => NOW);
    const start = await auth.start();
    expect(start).toEqual({ userCode: "ABCD-EFGH", verificationUri: CHATGPT_VERIFICATION_URI, expiresAt: NOW + 15 * 60_000, intervalMs: 5_000 });
    expect(JSON.stringify(start)).not.toContain("dev-1");
    expect((await stat(join(home, "chatgpt-pending.json"))).mode & 0o777).toBe(0o600);
  });

  it("stays pending until approved, then exchanges the code for tokens", async () => {
    let approved = false;
    const http = openai({
      "/api/accounts/deviceauth/usercode": usercode,
      "/api/accounts/deviceauth/token": (init) => {
        expect(JSON.parse(String(init.body))).toEqual({ device_auth_id: "dev-1", user_code: "ABCD-EFGH" });
        return approved ? { status: 200, json: { authorization_code: "code-1", code_verifier: "ver-1" } } : { status: 403, json: {} };
      },
      "/oauth/token": (init) => {
        const form = new URLSearchParams(String(init.body));
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code")).toBe("code-1");
        expect(form.get("code_verifier")).toBe("ver-1");
        expect(form.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
        return { status: 200, json: { access_token: jwt(NOW / 1000 + 3600), refresh_token: "r1" } };
      },
    });
    const auth = new ChatgptAuth(http as unknown as typeof fetch, () => NOW);
    await auth.start();
    expect(await auth.poll()).toEqual({ status: "pending", intervalMs: 5_000 });
    approved = true;
    expect(await auth.poll()).toEqual({ status: "ok" });
    const saved = JSON.parse(await readFile(join(home, "chatgpt-oauth.json"), "utf8"));
    expect(saved).toMatchObject({ refreshToken: "r1", expiresAt: NOW + 3_600_000 });
    expect((await stat(join(home, "chatgpt-oauth.json"))).mode & 0o777).toBe(0o600);
    expect(await auth.poll()).toEqual({ status: "expired" });
  });

  it("says OpenAI could not be reached on a network failure", async () => {
    const down = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    await expect(new ChatgptAuth(down as unknown as typeof fetch, () => NOW).start()).rejects.toThrow("Could not reach OpenAI. Try again.");
  });
});

describe("access token", () => {
  it("refreshes near expiry and keeps the rotated refresh token", async () => {
    let now = NOW;
    const http = openai({
      "/api/accounts/deviceauth/usercode": usercode,
      "/api/accounts/deviceauth/token": () => ({ status: 200, json: { authorization_code: "c", code_verifier: "v" } }),
      "/oauth/token": (init) => {
        const form = new URLSearchParams(String(init.body));
        if (form.get("grant_type") === "refresh_token") {
          expect(form.get("refresh_token")).toBe("r1");
          return { status: 200, json: { access_token: jwt(now / 1000 + 3600), refresh_token: "r2" } };
        }
        return { status: 200, json: { access_token: jwt(NOW / 1000 + 3600), refresh_token: "r1" } };
      },
    });
    const auth = new ChatgptAuth(http as unknown as typeof fetch, () => now);
    await auth.start();
    await auth.poll();
    const first = await auth.accessToken();
    now = NOW + 3_600_000;
    const second = await auth.accessToken();
    expect(second).not.toBe(first);
    expect((await auth.loadTokens())?.refreshToken).toBe("r2");
  });

  it("returns null when signed out", async () => {
    expect(await new ChatgptAuth(vi.fn() as unknown as typeof fetch, () => NOW).accessToken()).toBeNull();
  });
});

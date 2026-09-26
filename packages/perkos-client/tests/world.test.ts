import { describe, expect, it, vi } from "vitest";
import { PerkosClient } from "../src/client.ts";
import { readWorldRequest, readWorldStatus, World } from "../src/world.ts";

const request = { id: "request-1", status: "pending", provider: "oidc", purpose: "enroll", expiresAt: 2_000_000_000,
  verificationUrl: "https://sandbox.auth.world.org/authorize?state=public-nonce" };
describe("World API client boundary", () => {
  it("reads enabled providers and identities separately and removes unknown/private fields", () => {
    const publicStatus = { enabled: true, environment: "sandbox", providers: { idkit: true, oidc: true }, enrolled: { idkit: true, oidc: false } };
    expect(readWorldStatus({ ...publicStatus, access_token: "must-not-reach-renderer" })).toEqual(publicStatus);
    expect(readWorldRequest({ ...request, clientSecret: "secret", deviceCode: "secret", verifier: "secret", identity: "private-subject" })).toEqual(request);
    expect(() => readWorldStatus({ ...publicStatus, environment: "production" })).toThrow();
  });
  it("keeps only signed public RP fields while preserving the signal", () => {
    const rpContext = { rp_id: "rp_test", nonce: "n", created_at: 100, expires_at: 200, signature: "signed" };
    expect(readWorldRequest({ ...request, provider: "idkit", verificationUrl: undefined, appId: "app_test", rpContext: { ...rpContext, signingKey: "private" }, signal: "request-bound" }))
      .toEqual({ id: request.id, status: "pending", provider: "idkit", purpose: "enroll", expiresAt: request.expiresAt, appId: "app_test", rpContext, signal: "request-bound" });
  });
  it("rejects unknown terminal states, paths and foreign authorization links", async () => {
    for (const value of ["https://attacker.test/login", "javascript:alert(1)", "https://user:pass@sandbox.auth.world.org/login"]) expect(() => readWorldRequest({ ...request, verificationUrl: value })).toThrow();
    expect(() => readWorldRequest({ ...request, status: "connected" })).toThrow();
    const http = vi.fn(); const client = new World(new PerkosClient({ token: () => "session", fetchImpl: http }));
    await expect(client.request("../../other")).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it("uses the current PerkOS session and sends only enrollment parameters", async () => {
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer owner-session");
      expect(JSON.parse(init?.body as string)).toEqual({ provider: "oidc", purpose: "enroll", mode: "authorization_code" });
      return Response.json({ ...request, accessToken: "hidden" });
    });
    const client = new World(new PerkosClient({ token: () => "owner-session", fetchImpl: http }));
    expect(await client.enroll("oidc")).toEqual(request);
    expect(http.mock.calls[0]?.[0]).toBe("https://api.perkos.xyz/world/requests");
  });
  it("forwards the entire original IDKit result without adding client authority", async () => {
    const result = { protocol_version: "4.0", nested: { untouched: [1, 2] }, integrity_bundle: { opaque: "provider-evidence" } };
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ result });
      return Response.json({ ...request, provider: "idkit", status: "enrolled", verificationUrl: undefined });
    });
    await new World(new PerkosClient({ token: () => "owner-session", fetchImpl: http })).proof(request.id, result);
    expect(http.mock.calls[0]?.[0]).toBe("https://api.perkos.xyz/world/requests/request-1/proof");
  });
});

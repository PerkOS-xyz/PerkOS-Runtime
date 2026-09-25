/**
 * The cloud provider. The thing it must never do is leak the key: not in
 * health, not in an error, not anywhere a log could pick it up.
 */

import { describe, expect, it, vi } from "vitest";

import { CloudAiProvider } from "../src/cloud.js";

const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const make = (key: string | undefined, http: typeof fetch) =>
  new CloudAiProvider({ id: "xai", label: "Grok", baseUrl: "https://api.x.ai/v1/", apiKey: () => key, fetchImpl: http });

describe("a model somebody else runs", () => {
  it("says it is not connected before asking anyone", async () => {
    const http = vi.fn(async () => res(200));
    const health = await make(undefined, http as unknown as typeof fetch).health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("not connected");
    expect(http).not.toHaveBeenCalled();
  });

  it("sends the key as a bearer and never repeats it back", async () => {
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      expect(auth).toBe("Bearer sk-secret");
      return res(200, { data: [{ id: "grok-4.6" }] });
    });
    const provider = make("sk-secret", http as unknown as typeof fetch);
    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(JSON.stringify(health)).not.toContain("sk-secret");
    expect(await provider.models()).toEqual([{ id: "grok-4.6" }]);
  });

  it("tells a rejected key apart from a service that is down", async () => {
    const refused = await make("sk-old", vi.fn(async () => res(401)) as unknown as typeof fetch).health();
    expect(refused.detail).toContain("refused the key");
    const down = await make("sk-ok", vi.fn(async () => res(503)) as unknown as typeof fetch).health();
    expect(down.detail).toContain("503");
    const silent = await make("sk-ok", vi.fn(async () => Promise.reject(new Error("timeout"))) as unknown as typeof fetch).health();
    expect(silent.detail).toContain("did not answer");
  });

  it("refuses to chat with no key instead of sending an anonymous request", async () => {
    const http = vi.fn(async () => res(200));
    const provider = make(undefined, http as unknown as typeof fetch);
    await expect(async () => {
      for await (const _ of provider.chat({ model: "grok-4.6", messages: [] })) break;
    }).rejects.toMatchObject({ code: "AI_CLOUD_ABSENT" });
    expect(http).not.toHaveBeenCalled();
  });
});

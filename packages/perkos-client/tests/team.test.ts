/**
 * A desk's team on PerkOS: reading where it stands launches nothing, and a
 * team PerkOS describes in a way this version cannot read is refused.
 */

import { describe, expect, it, vi } from "vitest";

import { PerkosClient, Team } from "../src/index.ts";

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const teamWith = (http: typeof fetch) => new Team(new PerkosClient({ fetchImpl: http, token: () => "session-token" }));

const instance = {
  templateId: "eqlty-desk",
  status: "hibernated",
  agents: [
    { role: "scout", name: "eqlty-scout-1234abcd", state: "hibernated" },
    { role: "risk", name: "eqlty-risk-1234abcd", state: "hibernated", detail: "idle 20 min" },
    { role: "trader", name: "eqlty-trader-1234abcd", state: "sleepwalking" },
  ],
};

describe("a desk's team", () => {
  it("reads where the team stands without launching anything", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/project-templates/eqlty-desk/instance");
      expect(init?.method ?? "GET").toBe("GET");
      return reply(200, instance);
    });
    const team = await teamWith(http as unknown as typeof fetch).status("eqlty-desk");
    expect(team.status).toBe("hibernated");
    expect(team.agents.map((a) => a.role)).toEqual(["scout", "risk"]);
    expect(team.agents[1]?.detail).toBe("idle 20 min");
  });

  it("wakes the team with a POST, and keeps PerkOS's 402 for the screen", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/project-templates/eqlty-desk/instantiate");
      expect(init?.method).toBe("POST");
      return reply(200, { ...instance, status: "waking" });
    });
    expect((await teamWith(http as unknown as typeof fetch).wake("eqlty-desk")).status).toBe("waking");
    const broke = vi.fn(async () => reply(402, { error: { message: "Add desk time to run the team", code: "PAYMENT_REQUIRED" } }));
    await expect(teamWith(broke as unknown as typeof fetch).wake("eqlty-desk")).rejects.toMatchObject({ status: 402, code: "PAYMENT_REQUIRED" });
  });

  it("keeps how PerkOS addresses each agent, and gives waking more time than reading", async () => {
    const http = vi.fn(async () =>
      reply(200, {
        status: "ready",
        agents: [
          { role: "scout", name: "eqlty-scout-1234abcd", agentId: "agent-scout", state: "ready" },
          { role: "trader", name: "eqlty-trader-1234abcd", state: "planned" },
        ],
      }),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const team = await teamWith(http as unknown as typeof fetch).status("eqlty-desk");
      expect(team.agents[0]?.agentId).toBe("agent-scout");
      expect(team.agents[1]).not.toHaveProperty("agentId");
      await teamWith(http as unknown as typeof fetch).wake("eqlty-desk");
      expect(timeout.mock.calls.map((c) => c[0])).toEqual([30_000, 90_000]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("gives up waking when the caller stops waiting", async () => {
    const stop = new AbortController();
    const http = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = teamWith(http as unknown as typeof fetch).wake("eqlty-desk", { signal: stop.signal }).catch((e: unknown) => e);
    stop.abort();
    expect(await pending).toMatchObject({ code: "PERKOS_ABORTED" });
  });

  it("refuses a team it cannot read", async () => {
    const http = vi.fn(async () => reply(200, { status: "dancing", agents: [] }));
    await expect(teamWith(http as unknown as typeof fetch).status("eqlty-desk")).rejects.toMatchObject({ code: "TEAM_SHAPE" });
  });
});

/**
 * Asking one agent of a desk's team. PerkOS answers the question, refuses it
 * with a code, or never answers; each of those has to reach the turn as what
 * it is, because the turn labels every agent by it.
 */

import { describe, expect, it, vi } from "vitest";

import { Agents, PerkosApiError, PerkosClient } from "../src/index.ts";

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const agentsWith = (http: typeof fetch, token: () => string | undefined | Promise<string | undefined> = () => "session-token") =>
  new Agents(new PerkosClient({ fetchImpl: http, token }));

describe("asking one agent", () => {
  it("posts the prompt and the wait to the agent's task, and keeps what PerkOS answered", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/agents/agent-42/task");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: "How is NVDA doing?", timeoutMs: 55_000 });
      return reply(200, { ok: true, reply: "  @Trader @Auditor NVDA holds its range [F1].  ", detail: "reply len=44", agentId: "agent-42", agentName: "eqlty-scout-1234abcd" });
    });
    const answer = await agentsWith(http as unknown as typeof fetch).ask("agent-42", "How is NVDA doing?", { timeoutMs: 55_000 });
    expect(answer).toMatchObject({
      ok: true,
      reply: "@Trader @Auditor NVDA holds its range [F1].",
      detail: "reply len=44",
      agentId: "agent-42",
      agentName: "eqlty-scout-1234abcd",
    });
    expect(answer.ms).toBeGreaterThanOrEqual(0);
  });

  it("keeps a runtime's failure as an answer, not as an error", async () => {
    const http = vi.fn(async () => reply(200, { ok: false, reply: "", detail: "timed out after 55000ms", agentId: "a", agentName: "eqlty-risk-1" }));
    const answer = await agentsWith(http as unknown as typeof fetch).ask("a", "x");
    expect(answer).toMatchObject({ ok: false, reply: "", detail: "timed out after 55000ms" });
  });

  it("keeps the wait inside what PerkOS accepts", async () => {
    const sent: number[] = [];
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).timeoutMs);
      return reply(200, { ok: true, reply: "ok" });
    });
    const agents = agentsWith(http as unknown as typeof fetch);
    await agents.ask("a", "x", { timeoutMs: 1_000 });
    await agents.ask("a", "x", { timeoutMs: 600_000 });
    await agents.ask("a", "x");
    expect(sent).toEqual([5_000, 90_000, 55_000]);
  });

  it("stops waiting five seconds after the agent's own deadline, and calls that a timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const http = vi.fn(async () => reply(200, { ok: true, reply: "ok" }));
      await agentsWith(http as unknown as typeof fetch).ask("a", "x", { timeoutMs: 10_000 });
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
    }
    const late = vi.fn(async () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    expect(await agentsWith(late as unknown as typeof fetch).ask("a", "x").catch((e: unknown) => e)).toMatchObject({ status: 0, code: "PERKOS_TIMEOUT" });
  });

  it("stops waiting when the caller gives up, and says so", async () => {
    const stop = new AbortController();
    const http = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = agentsWith(http as unknown as typeof fetch).ask("a", "x", { signal: stop.signal }).catch((e: unknown) => e);
    stop.abort();
    expect(await pending).toMatchObject({ status: 0, code: "PERKOS_ABORTED" });
  });

  it("surfaces PerkOS's nested refusal code", async () => {
    const http = vi.fn(async () => reply(409, { error: { message: "Agent is not ready", code: "AGENT_NOT_READY" } }));
    await expect(agentsWith(http as unknown as typeof fetch).ask("a", "x")).rejects.toMatchObject({
      status: 409,
      code: "AGENT_NOT_READY",
      message: "Agent is not ready",
    });
  });

  it("reads the session token on every call, even when it has to be fetched", async () => {
    let n = 0;
    const seen: string[] = [];
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return reply(200, { ok: true, reply: "ok" });
    });
    const agents = agentsWith(http as unknown as typeof fetch, async () => `token-${++n}`);
    await agents.ask("a", "x");
    await agents.ask("a", "x");
    expect(seen).toEqual(["Bearer token-1", "Bearer token-2"]);
  });
});

describe("keeping an agent awake", () => {
  it("posts an empty body to its activity and accepts an answer with no content", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/agents/agent-42/activity");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({});
      return { ok: true, status: 204, json: async () => Promise.reject(new SyntaxError("no body")) } as unknown as Response;
    });
    await expect(agentsWith(http as unknown as typeof fetch).touch("agent-42")).resolves.toBeUndefined();
  });
});

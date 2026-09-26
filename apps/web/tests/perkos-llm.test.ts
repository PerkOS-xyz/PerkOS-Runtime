/**
 * PerkOS LLM as Sparky's model: offered only to a wallet with access, reached
 * through PerkOS's API with the session token, never with a gateway key.
 */

import { AiRegistry, PerkosAiProvider } from "@perkos/ai";
import { describe, expect, it, vi } from "vitest";

import { defaultRegistry, listSources, validateChoice } from "../app/lib/models";

const API = "https://api.perkos.xyz/llm/v1";
const MODELS = { object: "list", data: [{ id: "deepseek-v4-flash:cloud" }, { id: "kimi-k3:cloud" }] };
const SSE = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';

function perkos(reply: () => Response, token: string | null = "session-1") {
  const http = vi.fn(async (_url: string, _init?: RequestInit) => reply());
  return { http, provider: new PerkosAiProvider({ token: async () => token, fetchImpl: http as unknown as typeof fetch }) };
}

describe("PerkOS LLM for Sparky", () => {
  it("is offered to a wallet with access, with the models PerkOS lists, and can be chosen", async () => {
    const { http, provider } = perkos(() => Response.json(MODELS));
    expect(await listSources(new AiRegistry([provider]))).toEqual([
      { id: "perkos", label: "PerkOS LLM", ok: true, detail: "Included with your wallet's PerkOS access.", models: ["deepseek-v4-flash:cloud", "kimi-k3:cloud"] },
    ]);
    // One read serves the health check and the model list.
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe(`${API}/models`);
    expect((http.mock.calls[0]![1]?.headers as Record<string, string>).authorization).toBe("Bearer session-1");
    expect(await validateChoice(new AiRegistry([provider]), { provider: "perkos", model: "kimi-k3:cloud" })).toEqual({ provider: "perkos", model: "kimi-k3:cloud" });
  });

  it("is left off the list for a wallet without access, and when signed out", async () => {
    const denied = perkos(() => Response.json({ error: { code: "LLM_ACCESS_REQUIRED" } }, { status: 403 }));
    expect(await listSources(new AiRegistry([denied.provider]))).toEqual([]);
    expect(await validateChoice(new AiRegistry([denied.provider]), { provider: "perkos", model: "kimi-k3:cloud" })).toEqual({
      error: "This wallet does not have PerkOS LLM access.",
    });
    const signedOut = perkos(() => Response.json(MODELS), null);
    expect(await listSources(new AiRegistry([signedOut.provider]))).toEqual([]);
    expect(signedOut.http).not.toHaveBeenCalled();
  });

  it("stays on the list, down, when PerkOS does not answer", async () => {
    const { provider } = perkos(() => new Response("", { status: 503 }));
    expect(await listSources(new AiRegistry([provider]))).toEqual([
      { id: "perkos", label: "PerkOS LLM", ok: false, detail: "PerkOS LLM answered 503. Check again in a moment.", models: [] },
    ]);
  });

  it("streams a reply through PerkOS's API with the session, and says when the access is gone", async () => {
    const { http, provider } = perkos(() => new Response(SSE, { headers: { "content-type": "text/event-stream" } }));
    let text = "";
    for await (const piece of provider.chat({ model: "kimi-k3:cloud", messages: [{ role: "user", content: "Hi" }], maxTokens: 300 })) text += piece;
    expect(text).toBe("Hello");
    expect(http.mock.calls[0]![0]).toBe(`${API}/chat/completions`);
    expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual({
      model: "kimi-k3:cloud",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
      max_tokens: 300,
    });

    const gone = perkos(() => new Response("", { status: 403 }));
    const read = async () => {
      for await (const piece of gone.provider.chat({ model: "kimi-k3:cloud", messages: [{ role: "user", content: "Hi" }] })) void piece;
    };
    await expect(read()).rejects.toMatchObject({ code: "AI_PERKOS_ACCESS" });
  });

  it("is one of the sources the app looks at", () => {
    expect(defaultRegistry().get("perkos")?.label).toBe("PerkOS LLM");
  });
});

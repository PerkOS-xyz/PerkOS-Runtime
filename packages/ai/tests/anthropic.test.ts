/**
 * Claude provider: request shape, streamed text, model list and errors.
 */

import { describe, expect, it, vi } from "vitest";

import { ANTHROPIC_MODELS, AnthropicProvider, readAnthropicStream } from "../src/index.ts";

const sse = (events: Array<[string, unknown]>) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const [name, data] of events) c.enqueue(enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        c.close();
      },
    }),
    { status: 200 },
  );

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const piece of it) out += piece;
  return out;
}

const withKey = (http: unknown, key: string | null = "sk-ant-test") =>
  new AnthropicProvider({ apiKey: async () => key, fetchImpl: http as typeof fetch });

describe("AnthropicProvider", () => {
  it("reports whether a key is saved", async () => {
    expect((await withKey(vi.fn()).health()).ok).toBe(true);
    expect((await withKey(vi.fn(), null).health()).ok).toBe(false);
  });

  it("sends the system prompt separately and streams the text", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: "Be brief.",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      return sse([
        ["message_start", { type: "message_start" }],
        ["content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } }],
        ["content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: " there" } }],
        ["message_stop", { type: "message_stop" }],
      ]);
    });
    const text = await collect(
      withKey(http).chat({ model: "claude-sonnet-5", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] }),
    );
    expect(text).toBe("Hello there");
  });

  it("lists the Claude models the key can use", async () => {
    const http = vi.fn(async () => Response.json({ data: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5-5" }] }));
    expect((await withKey(http).models()).map((m) => m.id)).toEqual(["claude-sonnet-5", "claude-opus-5-5"]);
  });

  it("rejects a bad key and falls back to the known list on other failures", async () => {
    await expect(withKey(vi.fn(async () => new Response("", { status: 401 }))).models()).rejects.toMatchObject({
      code: "AI_ANTHROPIC_UNAUTHORIZED",
    });
    const down = vi.fn(async () => new Response("", { status: 500 }));
    expect((await withKey(down).models()).map((m) => m.id)).toEqual(ANTHROPIC_MODELS);
  });

  it("refuses to chat without a key", async () => {
    await expect(collect(withKey(vi.fn(), null).chat({ model: "m", messages: [] }))).rejects.toMatchObject({ code: "AI_ANTHROPIC_NO_KEY" });
  });
});

describe("readAnthropicStream", () => {
  it("throws on an error event", async () => {
    const res = sse([["error", { type: "error", error: { message: "overloaded" } }]]);
    await expect(collect(readAnthropicStream(res.body!))).rejects.toThrow("overloaded");
  });
});

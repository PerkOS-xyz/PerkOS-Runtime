/**
 * Grok provider: request shape, streamed deltas and errors.
 */

import { describe, expect, it, vi } from "vitest";

import { XaiProvider, readResponsesStream } from "../src/index.ts";

const sse = (events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const e of events) c.enqueue(enc.encode(`event: x\ndata: ${JSON.stringify(e)}\n\n`));
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

describe("XaiProvider", () => {
  it("reports whether a Grok session exists", async () => {
    expect((await new XaiProvider({ token: async () => "t" }).health()).ok).toBe(true);
    expect((await new XaiProvider({ token: async () => null }).health()).ok).toBe(false);
  });

  it("sends system messages as instructions and streams the text deltas", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.x.ai/v1/responses");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer t");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "grok-4.6",
        instructions: "Be brief.",
        input: [{ role: "user", content: "hi" }],
        reasoning: { effort: "low" },
        stream: true,
      });
      return sse([
        { type: "response.created" },
        { type: "response.output_text.delta", delta: "Hello" },
        { type: "response.output_text.delta", delta: " there" },
        { type: "response.completed" },
      ]);
    });
    const provider = new XaiProvider({ token: async () => "t", fetchImpl: http as unknown as typeof fetch });
    const text = await collect(
      provider.chat({ model: "grok-4.6", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] }),
    );
    expect(text).toBe("Hello there");
  });

  it("refuses to call without a session and reports a rejected one", async () => {
    await expect(collect(new XaiProvider({ token: async () => null }).chat({ model: "m", messages: [] }))).rejects.toMatchObject({
      code: "AI_XAI_SIGNED_OUT",
    });
    const http = vi.fn(async () => new Response("", { status: 401 }));
    const provider = new XaiProvider({ token: async () => "t", fetchImpl: http as unknown as typeof fetch });
    await expect(collect(provider.chat({ model: "m", messages: [] }))).rejects.toMatchObject({ code: "AI_XAI_UNAUTHORIZED" });
  });
});

describe("readResponsesStream", () => {
  it("throws on a failure event", async () => {
    const res = sse([{ type: "response.output_text.delta", delta: "a" }, { type: "response.failed", error: { message: "quota" } }]);
    await expect(collect(readResponsesStream(res.body!))).rejects.toThrow("quota");
  });

  it("handles frames split across reads", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"type":"response.output_text.del'));
        c.enqueue(enc.encode('ta","delta":"ok"}\n\n'));
        c.close();
      },
    });
    expect(await collect(readResponsesStream(body))).toBe("ok");
  });
});

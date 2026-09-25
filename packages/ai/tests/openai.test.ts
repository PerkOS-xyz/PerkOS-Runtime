/**
 * ChatGPT provider: identity headers, request shape, streamed text and errors.
 */

import { describe, expect, it, vi } from "vitest";

import { CHATGPT_ORIGINATOR, ChatgptProvider, chatgptAccountId } from "../src/index.ts";

const jwt = (claims: unknown) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const TOKEN = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });

const sse = (events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
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

describe("chatgptAccountId", () => {
  it("reads the account id from the token claims", () => {
    expect(chatgptAccountId(TOKEN)).toBe("acct-123");
    expect(chatgptAccountId("not-a-jwt")).toBeNull();
  });
});

describe("ChatgptProvider", () => {
  it("reports whether a ChatGPT session exists", async () => {
    expect((await new ChatgptProvider({ token: async () => TOKEN }).health()).ok).toBe(true);
    expect((await new ChatgptProvider({ token: async () => null }).health()).ok).toBe(false);
  });

  it("identifies the app, sends the account id and streams the text", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers.originator).toBe(CHATGPT_ORIGINATOR);
      expect(headers["ChatGPT-Account-ID"]).toBe("acct-123");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "gpt-5.5",
        instructions: "Be brief.",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
        ],
        store: false,
        stream: true,
      });
      return sse([
        { type: "response.output_text.delta", delta: "Sure" },
        { type: "response.output_text.delta", delta: "." },
        { type: "response.completed" },
      ]);
    });
    const provider = new ChatgptProvider({ token: async () => TOKEN, fetchImpl: http as unknown as typeof fetch });
    const text = await collect(
      provider.chat({
        model: "gpt-5.5",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "user", content: "again" },
        ],
      }),
    );
    expect(text).toBe("Sure.");
  });

  it("refuses to call without a session and reports a rejected one", async () => {
    await expect(collect(new ChatgptProvider({ token: async () => null }).chat({ model: "m", messages: [] }))).rejects.toMatchObject({
      code: "AI_OPENAI_SIGNED_OUT",
    });
    const http = vi.fn(async () => new Response("", { status: 401 }));
    const provider = new ChatgptProvider({ token: async () => TOKEN, fetchImpl: http as unknown as typeof fetch });
    await expect(collect(provider.chat({ model: "m", messages: [] }))).rejects.toMatchObject({ code: "AI_OPENAI_UNAUTHORIZED" });
  });

  it("names ChatGPT in a failure event from the stream", async () => {
    const http = vi.fn(async () => sse([{ type: "response.failed", error: { message: "usage limit" } }]));
    const provider = new ChatgptProvider({ token: async () => TOKEN, fetchImpl: http as unknown as typeof fetch });
    await expect(collect(provider.chat({ model: "m", messages: [] }))).rejects.toMatchObject({ code: "AI_OPENAI_UPSTREAM", message: "usage limit" });
  });
});

/**
 * The local provider, against the shapes a local runner really answers with.
 * What it must never do is claim a model is there when nothing is listening:
 * the landing offers this option, and a dead option is worse than none.
 */

import { describe, expect, it, vi } from "vitest";

import { LocalAiProvider, readSse } from "../src/local.ts";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const dead = () => Promise.reject(new Error("connection refused"));

const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });

describe("finding a model on this machine", () => {
  it("takes the first runner that answers", async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("11434")) return dead();
      return ok({ data: [{ id: "llama3.1" }] });
    });
    const found = await new LocalAiProvider({ fetchImpl: http as unknown as typeof fetch }).discover();
    expect(found?.label).toBe("LM Studio");
  });

  it("says what to do when nothing is listening", async () => {
    const http = vi.fn(dead);
    const health = await new LocalAiProvider({ fetchImpl: http as unknown as typeof fetch }).health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("Install Ollama");
  });

  it("does not call it healthy when the runner has no model yet", async () => {
    const http = vi.fn(async () => ok({ data: [] }));
    const health = await new LocalAiProvider({ fetchImpl: http as unknown as typeof fetch }).health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("no model yet");
  });

  it("uses the URL a person typed instead of looking around", async () => {
    const http = vi.fn(async (_url: string | URL | Request) => ok({ data: [{ id: "qwen3" }] }));
    const provider = new LocalAiProvider({ baseUrl: "http://127.0.0.1:9999/v1/", fetchImpl: http as unknown as typeof fetch });
    const health = await provider.health();
    expect(health.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(String(http.mock.calls[0]?.[0])).toBe("http://127.0.0.1:9999/v1/models");
  });
});

describe("reading the answer as it arrives", () => {
  it("yields the pieces in order and stops at the end marker", async () => {
    const body = stream([
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", Julio"}}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"nunca"}}]}\n\n',
    ]);
    const out: string[] = [];
    for await (const piece of readSse(body)) out.push(piece);
    expect(out.join("")).toBe("Hola, Julio");
  });

  it("survives a line that arrives split in two reads", async () => {
    const body = stream(['data: {"choices":[{"delta":{"cont', 'ent":"whole"}}]}\n\n']);
    const out: string[] = [];
    for await (const piece of readSse(body)) out.push(piece);
    expect(out).toEqual(["whole"]);
  });

  it("ignores a malformed line rather than dropping the answer", async () => {
    const body = stream(['data: not json\n\ndata: {"choices":[{"delta":{"content":"still here"}}]}\n\n']);
    const out: string[] = [];
    for await (const piece of readSse(body)) out.push(piece);
    expect(out).toEqual(["still here"]);
  });
});

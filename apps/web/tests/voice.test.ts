/**
 * Speech through the person's xAI account: requests, audio and errors.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { synthesize, transcribe, VoiceError } from "../app/lib/voice";

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
});
afterEach(() => {
  delete process.env.PERKOS_HOME;
});

async function signInGrok() {
  await writeFile(
    join(process.env.PERKOS_HOME!, "xai-oauth.json"),
    JSON.stringify({ accessToken: "grok-token", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }),
  );
}

describe("transcribe", () => {
  it("sends the audio to xAI with the Grok token and returns the text", async () => {
    await signInGrok();
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.x.ai/v1/stt");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer grok-token");
      const form = init?.body as FormData;
      expect(form.get("format")).toBe("true");
      expect(form.get("language")).toBe("en");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return Response.json({ text: " hello sparky " });
    });
    expect(await transcribe(new Blob(["x".repeat(10)]), "en", http as unknown as typeof fetch)).toBe("hello sparky");
  });

  it("asks for Grok when there is no session", async () => {
    await expect(transcribe(new Blob(["x"]), "en", vi.fn() as unknown as typeof fetch)).rejects.toMatchObject({ status: 401 });
  });
});

describe("synthesize", () => {
  it("returns the audio xAI produced", async () => {
    await signInGrok();
    const http = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Hi.", voice_id: "leo", language: "en" });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    });
    const res = await synthesize("Hi.", "leo", "en", http as unknown as typeof fetch);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reports a refused subscription as 403 so the window uses the system voice", async () => {
    await signInGrok();
    const http = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const err = await synthesize("Hi.", "leo", "en", http as unknown as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoiceError);
    expect(err).toMatchObject({ status: 403 });
  });
});

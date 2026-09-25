/**
 * Speech for Sparky, through the person's xAI account.
 *
 *   speech-to-text: POST {xai}/stt, multipart (file, format=true, language)
 *   text-to-speech: POST {xai}/tts, {text, voice_id, language} -> audio
 *
 * A subscription token may be refused for text-to-speech (403); the window
 * then falls back to the system voice.
 */

import { XAI_BASE_URL } from "@perkos/ai";

import { xaiAuth } from "./xai";

/** Voices tested against /v1/tts. Sparky speaks with a young voice. */
export const VOICES = ["leo", "rex", "sal", "gork", "eve", "ara", "una"] as const;
export const DEFAULT_VOICE = "leo";
const USER_AGENT = "PerkOS-Runtime";
const TIMEOUT_MS = 60_000;

export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function token(): Promise<string> {
  const t = await xaiAuth.accessToken().catch(() => null);
  if (!t) throw new VoiceError("Voice needs Grok. Sign in with Grok in Settings.", 401);
  return t;
}

export async function transcribe(file: Blob, language: string, http: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.set("file", file, file instanceof File && file.name ? file.name : "audio.webm");
  form.set("format", "true");
  if (language) form.set("language", language);
  const res = await http(`${XAI_BASE_URL}/stt`, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "user-agent": USER_AGENT },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new VoiceError(`Speech-to-text answered ${res.status}`, 502);
  try {
    const j = JSON.parse(raw) as { text?: unknown };
    return typeof j.text === "string" ? j.text.trim() : "";
  } catch {
    return raw.trim();
  }
}

export async function synthesize(text: string, voice: string, language: string, http: typeof fetch = fetch): Promise<Response> {
  const res = await http(`${XAI_BASE_URL}/tts`, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ text, voice_id: voice, language }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new VoiceError(`Text-to-speech answered ${res.status}`, res.status === 403 ? 403 : 502);
  return new Response(await res.arrayBuffer(), {
    headers: { "content-type": res.headers.get("content-type") || "audio/mpeg", "cache-control": "no-store" },
  });
}

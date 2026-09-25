import { guard } from "../../../lib/guard";
import { DEFAULT_VOICE, synthesize, VOICES, VoiceError } from "../../../lib/voice";

// POST { text, voice?, language? } -> audio. 403 means: use the system voice.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; voice?: unknown; language?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  if (!text) return Response.json({ error: "text" }, { status: 400 });
  const voice = typeof body.voice === "string" && (VOICES as readonly string[]).includes(body.voice) ? body.voice : DEFAULT_VOICE;
  const language = typeof body.language === "string" && body.language ? body.language.slice(0, 8) : "en";
  try {
    return await synthesize(text, voice, language);
  } catch (err) {
    const status = err instanceof VoiceError ? err.status : 502;
    return Response.json({ error: "tts_failed", message: (err as Error).message }, { status });
  }
}

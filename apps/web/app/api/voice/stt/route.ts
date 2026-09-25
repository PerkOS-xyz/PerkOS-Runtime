import { guard } from "../../../lib/guard";
import { transcribe, VoiceError } from "../../../lib/voice";

// POST multipart { file, language? } -> { text }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "file" }, { status: 400 });
  const language = typeof form?.get("language") === "string" ? String(form?.get("language")).slice(0, 8) : "";
  try {
    return Response.json({ text: await transcribe(file, language) });
  } catch (err) {
    const status = err instanceof VoiceError ? err.status : 502;
    return Response.json({ error: "stt_failed", message: (err as Error).message }, { status });
  }
}

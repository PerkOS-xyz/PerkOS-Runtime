import { guard } from "../../../lib/guard";
import { getXaiAccessToken, XAI_OAUTH_BASE_URL, XAI_USER_AGENT } from "../../../lib/xaiOAuth";
import { isVoice, loadSettings } from "../../../lib/settingsStore";

// TTS con la cuenta xAI del usuario. Forma de Hermes (tts_tool_providers._generate_xai_tts):
// POST /v1/tts {text, voice_id, language} -> mp3. Hermes documenta que con el bearer de
// suscripcion puede dar 403: el cliente cae a speechSynthesis y lo registra en el log.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string; language?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "text" }, { status: 400 });
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });
  // Voz: la del pedido (vista previa en Settings) o la guardada (Sparky habla con rex).
  const voice = isVoice(body.voice) ? body.voice : (await loadSettings()).voice;

  const res = await fetch(`${XAI_OAUTH_BASE_URL}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": XAI_USER_AGENT
    },
    body: JSON.stringify({ text, voice_id: voice, language: body.language?.trim() || "en" }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json({ error: `xai tts ${res.status}`, detail: detail.slice(0, 600) }, { status: res.status === 403 ? 403 : 502 });
  }
  const audio = await res.arrayBuffer();
  return new Response(audio, { headers: { "Content-Type": res.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" } });
}

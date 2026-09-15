import { getXaiAccessToken, XAI_OAUTH_BASE_URL, XAI_USER_AGENT } from "../../../lib/xaiOAuth";

// STT con la cuenta xAI del usuario. Forma de Hermes (transcription_cloud._transcribe_xai
// y voice-client-direct.ts): POST /v1/stt multipart, file + format=true (+language).
export async function POST(req: Request) {
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });
  const inForm = await req.formData().catch(() => null);
  const file = inForm?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "file" }, { status: 400 });
  const language = typeof inForm?.get("language") === "string" ? String(inForm?.get("language")) : "";

  const form = new FormData();
  const name = file instanceof File && file.name ? file.name : "audio.webm";
  form.set("file", file, name);
  form.set("format", "true");
  if (language) form.set("language", language);

  const t0 = Date.now();
  const res = await fetch(`${XAI_OAUTH_BASE_URL}/stt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": XAI_USER_AGENT },
    body: form,
    signal: AbortSignal.timeout(60_000)
  });
  const raw = await res.text().catch(() => "");
  const ms = Date.now() - t0;
  if (!res.ok) return Response.json({ error: `xai stt ${res.status}`, detail: raw.slice(0, 600) }, { status: 502 });
  let text = "";
  try {
    const j = JSON.parse(raw) as { text?: string };
    text = typeof j.text === "string" ? j.text : "";
  } catch {
    text = raw;
  }
  // Un 200 sin texto no distingue "silencio" de "xAI no entendio": se devuelve
  // el cuerpo crudo (recortado) y el tiempo para verlo en el panel de debug.
  const detail = text.trim() ? undefined : `${ms} ms · ${res.status} · ${raw.slice(0, 160) || "(no body)"}`;
  return Response.json({ text: text.trim(), ms, detail });
}

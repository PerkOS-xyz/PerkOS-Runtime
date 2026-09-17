import { guard } from "../../../../lib/guard";
import { hostLogo } from "../../../../lib/launchLogo";
import { getXaiAccessToken, XAI_OAUTH_BASE_URL, XAI_ORIGINATOR, XAI_USER_AGENT } from "../../../../lib/xaiOAuth";

// POST /api/launch/logo/generate { prompt } -> { url, prompt }
// El logo lo genera Grok (grok-imagine-image) con la misma sesion OAuth de xAI que usa el chat;
// la imagen se aloja en PerkOS y Bankr recibe la URL. Probado el 2026-09-17: JPEG en base64.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 600) : "";
  if (!prompt) return Response.json({ error: "prompt_required", detail: "Describe the logo in one line" }, { status: 400 });
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected", detail: "Connect Grok in Settings first" }, { status: 401 });
  // Marco fijo para que salga un logo y no una ilustracion: plano, centrado, sin texto (los simbolos
  // de texto generados salen mal y Bankr ya muestra el nombre al lado).
  const full = `${prompt}. Token logo: a single centered emblem, flat vector style with soft shading, bold simple shapes, high contrast, plain solid background, no text, no letters, no watermark, square composition.`;
  const r = await fetch(`${XAI_OAUTH_BASE_URL}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": XAI_USER_AGENT, originator: XAI_ORIGINATOR },
    body: JSON.stringify({ model: "grok-imagine-image", prompt: full, n: 1, response_format: "b64_json" }),
    signal: AbortSignal.timeout(90_000)
  });
  const j = (await r.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: string };
  const b64 = j.data?.[0]?.b64_json;
  if (!r.ok || !b64) return Response.json({ error: "image_failed", detail: typeof j.error === "string" ? j.error : `xAI ${r.status}` }, { status: 502 });
  const mime = b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("UklGR") ? "image/webp" : "image/jpeg";
  const hosted = await hostLogo(`data:${mime};base64,${b64}`);
  if ("error" in hosted) return Response.json({ error: hosted.error, detail: hosted.detail }, { status: hosted.status });
  return Response.json({ url: hosted.url, prompt: full });
}

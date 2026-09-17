import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { getPerkosIdToken, PERKOS_API_URL, PerkosApiError } from "../../../lib/perkosApi";

// POST /api/launch/logo { data: "data:image/png;base64,…" } -> { url }
// Bankr solo acepta una URL http(s) para la imagen del token (verificado: rechaza base64).
// El logo del laptop se sube a PerkOS API (Firebase Storage, lectura publica) con la
// sesion PerkOS de la wallet conectada, y la URL publica es la que viaja a Bankr.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { data?: unknown };
  const data = typeof body.data === "string" ? body.data : "";
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data)) return Response.json({ error: "image_required", detail: "Pick a PNG, JPG, WebP or GIF" }, { status: 400 });
  if (data.length > 2_900_000) return Response.json({ error: "too_big", detail: "Keep the logo under 2 MB" }, { status: 413 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const auth = await getPerkosIdToken(s.wallet).catch(() => null);
  if (!auth) return Response.json({ error: "perkos_session_required", detail: "Sign in to PerkOS first" }, { status: 401 });
  try {
    const res = await fetch(`${PERKOS_API_URL}/files/launch-logo`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${auth.idToken}` }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(30_000) });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
    if (!res.ok || !j.url) return Response.json({ error: j.error ?? "upload_failed", detail: j.message ?? `PerkOS API ${res.status}` }, { status: res.status === 401 ? 401 : 502 });
    return Response.json({ url: j.url });
  } catch (e) {
    const m = e instanceof PerkosApiError ? e.message : (e as Error).message;
    return Response.json({ error: "upload_failed", detail: m }, { status: 502 });
  }
}

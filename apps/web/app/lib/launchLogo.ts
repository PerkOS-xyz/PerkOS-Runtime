import { loadSettings } from "./settingsStore";
import { getPerkosIdToken, PERKOS_API_URL } from "./perkosApi";

// Aloja el logo de un token en PerkOS (Firebase Storage publico) y devuelve la URL http(s)
// que Bankr exige. Usado por la subida desde archivo y por la generacion con Grok.
export async function hostLogo(dataUrl: string): Promise<{ url: string } | { error: string; detail: string; status: number }> {
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return { error: "image_required", detail: "Pick a PNG, JPG, WebP or GIF", status: 400 };
  if (dataUrl.length > 2_900_000) return { error: "too_big", detail: "Keep the logo under 2 MB", status: 413 };
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return { error: "wallet_required", detail: "Sign in first", status: 401 };
  const auth = await getPerkosIdToken(s.wallet).catch(() => null);
  if (!auth) return { error: "perkos_session_required", detail: "Sign in to PerkOS first", status: 401 };
  const res = await fetch(`${PERKOS_API_URL}/files/launch-logo`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${auth.idToken}` }, body: JSON.stringify({ data: dataUrl }), signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!res.ok || !j.url) return { error: j.error ?? "upload_failed", detail: j.message ?? `PerkOS API ${res.status}`, status: res.status === 401 ? 401 : 502 };
  return { url: j.url };
}

import { loadSettings } from "../../../lib/settingsStore";
import { getPerkosIdToken, perkosRequest, PerkosApiError } from "../../../lib/perkosApi";

// POST /api/perkos/pay-session -> { url, expiresAt }
// Tras un 402 de PerkOS, Floor pide una billing session (API #253) y abre
// la URL en el browser del sistema (pay.perkos.xyz). El id viaja en la URL;
// Floor nunca le pasa el bearer a Pay. Luego hace polling de /api/perkos/billing.
export async function POST() {
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const t = await getPerkosIdToken(s.wallet);
    if (!t) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const r = await perkosRequest<{ sessionId: string; url: string; expiresAt: string }>("/billing/sessions", {
      idToken: t.idToken,
      method: "POST",
      body: JSON.stringify({ source: "floor" }),
      timeoutMs: 15_000
    });
    return Response.json({ url: r.url, expiresAt: r.expiresAt });
  } catch (e) {
    if (e instanceof PerkosApiError) return Response.json({ error: e.code ?? "pay_session_failed", detail: e.message }, { status: e.status });
    return Response.json({ error: "pay_session_failed", detail: (e as Error).message }, { status: 502 });
  }
}

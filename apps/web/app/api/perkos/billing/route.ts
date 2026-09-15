import { loadSettings } from "../../../lib/settingsStore";
import { getPerkosIdToken, perkosRequest, PerkosApiError } from "../../../lib/perkosApi";

// GET /api/perkos/billing -> { creditsUsd, allowed, reason }
// Lo que Floor consulta mientras la persona paga en pay.perkos.xyz.
export async function GET() {
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const t = await getPerkosIdToken(s.wallet);
    if (!t) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const r = await perkosRequest<{ creditsUsd: number; infra: { allowed: boolean; reason: string } }>("/billing/me", {
      idToken: t.idToken,
      timeoutMs: 15_000
    });
    return Response.json({ creditsUsd: r.creditsUsd, allowed: r.infra.allowed, reason: r.infra.reason });
  } catch (e) {
    if (e instanceof PerkosApiError) return Response.json({ error: e.code ?? "billing_failed", detail: e.message }, { status: e.status });
    return Response.json({ error: "billing_failed", detail: (e as Error).message }, { status: 502 });
  }
}

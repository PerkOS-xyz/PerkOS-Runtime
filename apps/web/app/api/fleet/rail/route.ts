import { loadSettings } from "../../../lib/settingsStore";
import { enrolRail, railStatus } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// Rail de gasto 1Claw del Trader (paso "Spend rail" del wizard).
//   GET  /api/fleet/rail          -> RailState
//   POST /api/fleet/rail {email}  -> RailState (claimUrl mientras falte el claim)

function fail(e: unknown) {
  if (e instanceof PerkosApiError) {
    if (e.status === 401) return Response.json({ error: "perkos_session_required", detail: e.message }, { status: 401 });
    return Response.json({ error: e.code ?? "rail_failed", detail: e.message }, { status: e.status });
  }
  return Response.json({ error: "rail_failed", detail: (e as Error).message }, { status: 502 });
}

async function who(): Promise<{ wallet: string; templateId: string }> {
  const s = await loadSettings();
  if (!s.wallet) throw new PerkosApiError(401, "NO_WALLET", "Sign in first");
  return { wallet: s.wallet, templateId: s.fleetTemplateId };
}

export async function GET() {
  try { const w = await who(); return Response.json(await railStatus(w.wallet, w.templateId)); } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: "email" }, { status: 400 });
  try { const w = await who(); return Response.json(await enrolRail(w.wallet, email, w.templateId)); } catch (e) { return fail(e); }
}

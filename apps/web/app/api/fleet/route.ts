import { loadSettings } from "../../lib/settingsStore";
import { fleetStatus, hibernateFleet, wakeFleet } from "../../lib/fleet";
import { PerkosApiError } from "../../lib/perkosApi";

function fail(e: unknown) {
  if (e instanceof PerkosApiError) {
    if (e.status === 402) return Response.json({ error: "infra_payment_required", detail: e.message }, { status: 402 });
    if (e.status === 401) return Response.json({ error: "perkos_session_required", detail: e.message }, { status: 401 });
    // El template floor-desk aun no esta publicado desde Admin.
    if (e.status === 404) return Response.json({ error: "template_unpublished", detail: e.message }, { status: 404 });
    return Response.json({ error: e.code ?? "fleet_failed", detail: e.message }, { status: e.status });
  }
  return Response.json({ error: "fleet_failed", detail: (e as Error).message }, { status: 502 });
}

async function wallet(): Promise<string> {
  const s = await loadSettings();
  if (!s.wallet) throw new PerkosApiError(401, "NO_WALLET", "Sign in first");
  return s.wallet;
}

// GET /api/fleet -> estado de las 4 orbs
export async function GET() {
  try { return Response.json(await fleetStatus(await wallet())); } catch (e) { return fail(e); }
}

// POST /api/fleet { action: "wake" | "hibernate" }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    const w = await wallet();
    if (body.action === "wake") return Response.json(await wakeFleet(w));
    if (body.action === "hibernate") return Response.json(await hibernateFleet(w));
    return Response.json({ error: "action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

import { loadSettings, saveSettings } from "../../lib/settingsStore";
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

async function who(): Promise<{ wallet: string; templateId: string }> {
  const s = await loadSettings();
  if (!s.wallet) throw new PerkosApiError(401, "NO_WALLET", "Sign in first");
  return { wallet: s.wallet, templateId: s.fleetTemplateId };
}

// GET /api/fleet -> estado de las orbs del template elegido
export async function GET() {
  try { const w = await who(); return Response.json(await fleetStatus(w.wallet, w.templateId)); } catch (e) { return fail(e); }
}

// POST /api/fleet { action: "wake" | "hibernate", templateId? }
// wake con templateId lo guarda como el template del usuario (la card elegida).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; templateId?: string };
  try {
    const w = await who();
    if (body.action === "wake") {
      let templateId = w.templateId;
      if (typeof body.templateId === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(body.templateId) && body.templateId !== w.templateId) {
        templateId = body.templateId;
        const s = await loadSettings();
        await saveSettings({ ...s, fleetTemplateId: templateId });
      }
      return Response.json(await wakeFleet(w.wallet, templateId));
    }
    if (body.action === "hibernate") return Response.json(await hibernateFleet(w.wallet));
    return Response.json({ error: "action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

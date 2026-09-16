import { guard } from "../../lib/guard";
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

const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,63}$/;

// GET /api/fleet[?templateId=] -> estado de las orbs del desk elegido (o de otro, para el switcher)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("templateId") ?? "";
  try {
    const w = await who();
    return Response.json(await fleetStatus(w.wallet, TEMPLATE_ID.test(q) ? q : w.templateId));
  } catch (e) { return fail(e); }
}

// POST /api/fleet { action: "wake" | "hibernate" | "select", templateId? }
// wake/select con templateId lo guarda como el desk del usuario (quick switch
// en el header); select solo cambia y devuelve el estado, sin despertar.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
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
    if (body.action === "select") {
      if (typeof body.templateId !== "string" || !TEMPLATE_ID.test(body.templateId)) return Response.json({ error: "templateId" }, { status: 400 });
      const s = await loadSettings();
      if (body.templateId !== s.fleetTemplateId) await saveSettings({ ...s, fleetTemplateId: body.templateId });
      return Response.json(await fleetStatus(w.wallet, body.templateId));
    }
    if (body.action === "hibernate") return Response.json(await hibernateFleet(w.wallet));
    return Response.json({ error: "action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

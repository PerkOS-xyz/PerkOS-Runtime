import { loadSettings } from "../../../lib/settingsStore";
import { listDeskTemplates } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// GET /api/fleet/templates?lang=es -> { templates: DeskTemplate[], selected }
// Una card por template fleet publicado en PerkOS. Hoy: floor-desk.
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") || "en";
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const templates = await listDeskTemplates(s.wallet, lang);
    return Response.json({ templates, selected: s.fleetTemplateId });
  } catch (e) {
    if (e instanceof PerkosApiError) {
      if (e.status === 401) return Response.json({ error: "perkos_session_required", detail: e.message }, { status: 401 });
      return Response.json({ error: e.code ?? "templates_failed", detail: e.message }, { status: e.status });
    }
    return Response.json({ error: "templates_failed", detail: (e as Error).message }, { status: 502 });
  }
}

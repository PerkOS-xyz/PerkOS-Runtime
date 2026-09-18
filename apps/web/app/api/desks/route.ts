import { guard } from "../../lib/guard";
import { loadSettings } from "../../lib/settingsStore";
import { listDeskTemplates, listProjects } from "../../lib/fleet";
import { PerkosApiError } from "../../lib/perkosApi";

// GET /api/desks?lang=es -> { templates, desks, selected }
// La pantalla de desks: el catalogo de PerkOS a un lado y mis desks al otro. Un desk es un
// proyecto de la wallet (`fleet-<templateId>`), asi que los dos lados salen de PerkOS.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const lang = new URL(req.url).searchParams.get("lang") || "en";
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    const [templates, projects] = await Promise.all([
      listDeskTemplates(s.wallet, lang),
      listProjects(s.wallet).catch(() => [])
    ]);
    const desks = projects.filter((p) => p.templateId);
    return Response.json({ templates, desks, selected: s.fleetTemplateId });
  } catch (e) {
    if (e instanceof PerkosApiError) {
      if (e.status === 401) return Response.json({ error: "perkos_session_required", detail: e.message }, { status: 401 });
      return Response.json({ error: e.code ?? "desks_failed", detail: e.message }, { status: e.status });
    }
    return Response.json({ error: "desks_failed", detail: (e as Error).message }, { status: 502 });
  }
}

import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { renameProject } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// POST /api/desks/name { templateId, name } -> { ok }
// El desk es un proyecto de la wallet (`fleet-<templateId>`): ponerle nombre es renombrar ese
// proyecto. Solo el nombre; nada mas se toca y nada se gasta.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { templateId?: unknown; name?: unknown };
  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(templateId)) return Response.json({ error: "template" }, { status: 400 });
  if (!name || name.length > 120) return Response.json({ error: "name", detail: "1 to 120 characters" }, { status: 400 });
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    await renameProject(s.wallet, `fleet-${templateId}`, name);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof PerkosApiError) return Response.json({ error: e.code ?? "rename_failed", detail: e.message }, { status: e.status });
    return Response.json({ error: "rename_failed", detail: (e as Error).message }, { status: 502 });
  }
}

import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { deleteDesk } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// POST /api/desks/delete { templateId } -> { ok, wallet, agents, projectId }
// Deshacer un desk: sus agentes y su proyecto. Va con la sesion de PerkOS de esta ventana,
// asi que solo puede borrar lo de la wallet que entro. Destructivo y sin vuelta atras.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { templateId?: string };
  const templateId = (body.templateId || s.fleetTemplateId || "").trim();
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(templateId)) return Response.json({ error: "templateId" }, { status: 400 });
  try {
    const r = await deleteDesk(s.wallet, templateId);
    return Response.json({ ok: true, wallet: s.wallet, ...r });
  } catch (e) {
    if (e instanceof PerkosApiError) return Response.json({ error: e.code ?? "delete_failed", detail: e.message }, { status: e.status });
    return Response.json({ error: "delete_failed", detail: (e as Error).message }, { status: 502 });
  }
}

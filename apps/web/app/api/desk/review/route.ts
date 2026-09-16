import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { listOutlooks, reviewDue, reviewOutlook } from "../../../lib/review";

// GET  /api/desk/review            -> outlooks del desk con su fecha de revision y resultado
// POST /api/desk/review { id?, force? } -> revisa uno (force: antes del mes) o todos los vencidos
export async function GET() {
  const s = await loadSettings();
  const outlooks = await listOutlooks(s.fleetTemplateId);
  return Response.json({ desk: s.fleetTemplateId, due: outlooks.filter((o) => o.due).length, outlooks });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; force?: unknown };
  if (typeof body.id === "string" && body.id) {
    const r = await reviewOutlook(body.id, body.force === true);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  return Response.json(await reviewDue(s.fleetTemplateId));
}

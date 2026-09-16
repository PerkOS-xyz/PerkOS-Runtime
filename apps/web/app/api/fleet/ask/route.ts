import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { askFleet, FLEET_ROLES, type FleetRole } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// POST /api/fleet/ask { text, roles? } -> { replies: [{role, ok, reply, detail, ms}] }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { text?: string; roles?: string[] };
  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "text" }, { status: 400 });
  const roles = (body.roles ?? FLEET_ROLES).filter((r): r is FleetRole => (FLEET_ROLES as string[]).includes(r));
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const t0 = Date.now();
    const replies = await askFleet(s.wallet, text, roles, 45_000, req.signal);
    return Response.json({ replies, ms: Date.now() - t0 });
  } catch (e) {
    if (e instanceof PerkosApiError) return Response.json({ error: e.code ?? "fleet_failed", detail: e.message }, { status: e.status });
    return Response.json({ error: "fleet_failed", detail: (e as Error).message }, { status: 502 });
  }
}

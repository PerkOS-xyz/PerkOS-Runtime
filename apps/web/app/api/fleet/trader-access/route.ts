import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { revokeTraderAccess, traderAccess, traderAccessLink } from "../../../lib/agentWallet";
import { PerkosApiError } from "../../../lib/perkosApi";

export const dynamic = "force-dynamic";

// GET    /api/fleet/trader-access          the card: delegated wallet, funds, limits
// POST   /api/fleet/trader-access {mode}   a one-shot link to grant or edit (opens in the browser)
// DELETE /api/fleet/trader-access          revoke from the desk
// The delegated share never passes through Floor: PerkOS keeps it sealed and
// signs one approved step at a time.

function fail(e: unknown): Response {
  const err = e as PerkosApiError;
  return Response.json({ error: err.message, code: err.code }, { status: err.status || 500 });
}

export async function GET() {
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    return Response.json({ ...(await traderAccess(s.wallet, s.fleetTemplateId)), payWith: s.payWith });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
  try {
    const url = await traderAccessLink(s.wallet, body.mode === "edit" ? "edit" : "grant", s.fleetTemplateId);
    return Response.json({ ok: true, url });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    await revokeTraderAccess(s.wallet);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

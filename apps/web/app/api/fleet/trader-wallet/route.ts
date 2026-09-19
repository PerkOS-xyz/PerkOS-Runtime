import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { ensureTraderWallet, traderWalletState } from "../../../lib/agentWallet";
import { PerkosApiError } from "../../../lib/perkosApi";

export const dynamic = "force-dynamic";

// GET  /api/fleet/trader-wallet  → the Trader's Dynamic wallet: address, funds, limits
// POST /api/fleet/trader-wallet  → create it (the Trader must exist on the desk)
// Floor never holds this wallet's key: PerkOS signs through Dynamic after the
// person approves on the desk.

function fail(e: unknown): Response {
  const err = e as PerkosApiError;
  return Response.json({ error: err.message, code: err.code }, { status: err.status || 500 });
}

export async function GET() {
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    return Response.json({ ...(await traderWalletState(s.wallet, s.fleetTemplateId)), payWith: s.payWith });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  try {
    const wallet = await ensureTraderWallet(s.wallet, s.fleetTemplateId);
    return Response.json({ ok: true, wallet });
  } catch (e) {
    return fail(e);
  }
}

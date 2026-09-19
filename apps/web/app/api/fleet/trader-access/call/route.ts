import { guard } from "../../../../lib/guard";
import { loadSettings } from "../../../../lib/settingsStore";
import { traderAgentId, traderWalletCall } from "../../../../lib/agentWallet";
import { PerkosApiError } from "../../../../lib/perkosApi";

export const dynamic = "force-dynamic";

// POST /api/fleet/trader-access/call { to, data, value?, label, reason }
// One step of a buy the person just approved (Hold). PerkOS signs it through
// the wallet the person delegated to the Trader, after checking it against the
// agent policy; a refusal comes back as 403 with the reason and nothing is sent.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { to?: unknown; data?: unknown; value?: unknown; label?: unknown; reason?: unknown };
  if (typeof body.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.to) || typeof body.data !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.data)) {
    return Response.json({ error: "bad_step" }, { status: 400 });
  }
  try {
    // Resolved here, never taken from the window: the step is signed for this desk's Trader only.
    const agentId = await traderAgentId(s.wallet, s.fleetTemplateId);
    if (!agentId) return Response.json({ error: "no_trader", detail: "Start the desk first" }, { status: 409 });
    const out = await traderWalletCall(s.wallet, agentId, {
      to: body.to,
      data: body.data,
      value: typeof body.value === "string" ? body.value : undefined,
      label: typeof body.label === "string" ? body.label.slice(0, 32) : "",
      reason: typeof body.reason === "string" ? body.reason.slice(0, 280) : ""
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    const err = e as PerkosApiError;
    return Response.json({ error: err.message, code: err.code }, { status: err.status || 500 });
  }
}

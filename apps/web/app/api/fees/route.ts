import { guard } from "../../lib/guard";
import { loadSettings } from "../../lib/settingsStore";
import { creatorFees } from "../../lib/bankrFees";

// GET /api/fees?days=30 -> CreatorFees de la wallet conectada (lectura publica de Bankr).
// Lo que ganan los tokens que la persona lanzo (o donde es beneficiaria).
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30) || 30;
  try {
    return Response.json(await creatorFees(s.wallet, days));
  } catch (e) {
    return Response.json({ error: "fees_failed", detail: (e as Error).message }, { status: 502 });
  }
}

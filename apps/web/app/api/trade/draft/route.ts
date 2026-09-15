import { loadSettings } from "../../../lib/settingsStore";
import { draftBuy } from "../../../lib/uniswap";

// POST /api/trade/draft { amountUsd } -> TradeDraft (cotizacion + calldata).
// Nada se firma aqui: la wallet de la persona firma en Floor (Approve orb).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { amountUsd?: unknown };
  const amountUsd = typeof body.amountUsd === "number" ? body.amountUsd : Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 100) return Response.json({ error: "amount", detail: "amountUsd must be 0 < x <= 100" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  try {
    return Response.json(await draftBuy(s.wallet as `0x${string}`, amountUsd));
  } catch (e) {
    return Response.json({ error: "quote_failed", detail: (e as Error).message }, { status: 502 });
  }
}

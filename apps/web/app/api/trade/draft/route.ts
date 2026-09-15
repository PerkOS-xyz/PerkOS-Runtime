import { loadSettings } from "../../../lib/settingsStore";
import { draftTrade, TradeError } from "../../../lib/uniswap";

// POST /api/trade/draft { side?, stock?, amountUsd?, amountToken?, fraction? } -> TradeDraft
// side default "buy", stock default NVDAc. Nada se firma aqui: la wallet de la
// persona firma en Floor (Approve orb).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { side?: unknown; stock?: unknown; amountUsd?: unknown; amountToken?: unknown; fraction?: unknown };
  const side = body.side === "sell" ? "sell" : "buy";
  const stock = typeof body.stock === "string" && body.stock.trim() ? body.stock.trim().slice(0, 40) : undefined;
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const amountUsd = num(body.amountUsd);
  const amountToken = num(body.amountToken);
  const fraction = num(body.fraction);
  if ([amountUsd, amountToken, fraction].some((n) => n !== undefined && !Number.isFinite(n))) return Response.json({ error: "amount" }, { status: 400 });
  if (side === "buy" && !(amountUsd !== undefined && amountUsd > 0 && amountUsd <= 100)) return Response.json({ error: "amount", detail: "amountUsd must be 0 < x <= 100" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  try {
    return Response.json(await draftTrade({ recipient: s.wallet as `0x${string}`, side, stock, amountUsd, amountToken, fraction }));
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.code.toLowerCase(), detail: e.message }, { status: 422 });
    return Response.json({ error: "quote_failed", detail: (e as Error).message }, { status: 502 });
  }
}

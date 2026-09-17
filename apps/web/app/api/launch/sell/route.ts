import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { TradeError } from "../../../lib/uniswap";
import { draftLaunchSell } from "../../../lib/launchBuy";

// POST /api/launch/sell { token, fraction? | amountToken? } -> TradeDraft (token -> ETH en Base).
// El token tiene que ser un launch de Bankr. Vender pide permiso de Permit2 al router (monto exacto,
// 30 minutos); el swap se simula en el cliente justo antes de firmarlo. Nada se firma aqui.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; fraction?: unknown; amountToken?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const fraction = body.fraction === undefined ? undefined : Number(body.fraction);
  const amountToken = body.amountToken === undefined ? undefined : Number(body.amountToken);
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return Response.json({ error: "token" }, { status: 400 });
  if (fraction !== undefined && !(fraction > 0 && fraction <= 1)) return Response.json({ error: "amount", detail: "fraction must be 0 < x <= 1" }, { status: 400 });
  if (amountToken !== undefined && !(amountToken > 0)) return Response.json({ error: "amount", detail: "amountToken must be positive" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  try {
    const r = await fetch(`https://api.bankr.bot/token-launches/${token}`, { signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { launch?: { txHash?: string; chain?: string }; txHash?: string; chain?: string };
    const rec = j.launch ?? j;
    if (!r.ok || !rec.txHash || !/^0x[0-9a-fA-F]{64}$/.test(rec.txHash)) return Response.json({ error: "unknown_launch", detail: "Bankr has no launch record for this token" }, { status: 422 });
    if (rec.chain && rec.chain !== "base") return Response.json({ error: "chain", detail: "This desk only trades on Base" }, { status: 422 });
    const d = await draftLaunchSell({ recipient: s.wallet as `0x${string}`, token: token as `0x${string}`, deployTx: rec.txHash as `0x${string}`, fraction: amountToken === undefined ? fraction ?? 1 : undefined, amountToken });
    return Response.json(d);
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.code.toLowerCase(), detail: e.message }, { status: 422 });
    return Response.json({ error: "quote_failed", detail: (e as Error).message.split("\n")[0].slice(0, 200) }, { status: 502 });
  }
}

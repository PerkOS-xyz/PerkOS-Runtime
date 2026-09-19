import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { draftTrade, TradeError } from "../../../lib/uniswap";
import { bankrQuote } from "../../../lib/bankr";
import { traderAccess } from "../../../lib/agentWallet";

// POST /api/trade/draft { side?, stock?, amountUsd?, amountToken?, fraction? } -> TradeDraft
// side default "buy", stock default NVDAc. Nada se firma aqui: la wallet de la
// persona firma en Floor (Approve orb). Con Settings "Pays for buys: Delegated
// wallet" la compra se arma para la wallet Dynamic que la persona delego al
// Trader (recipient = esa wallet) y PerkOS firma despues del Hold. Una venta
// sigue siendo de la wallet conectada.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
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
  let recipient = s.wallet as `0x${string}`;
  let payer: { kind: "trader"; address: `0x${string}`; provider: "dynamic"; maxUsd: number } | undefined;
  if (s.payWith === "trader" && side === "buy") {
    const ta = await traderAccess(s.wallet, s.fleetTemplateId).catch(() => null);
    if (!ta?.delegated || !ta.walletAddress) return Response.json({ error: "trader_access_missing", detail: "Delegate a wallet to the Trader in Settings first, or pay with your own wallet." }, { status: 409 });
    const maxUsd = ta.limits?.maxUsdc ?? 25;
    // Dynamic's enclave and the PerkOS policy would refuse it anyway; the card should never offer it.
    if (amountUsd !== undefined && amountUsd > maxUsd) return Response.json({ error: "amount", detail: `Your limit for the Trader is $${maxUsd} per order. Edit it in Settings.` }, { status: 400 });
    recipient = ta.walletAddress as `0x${string}`;
    payer = { kind: "trader", address: recipient, provider: "dynamic", maxUsd };
  }
  try {
    const d = await draftTrade({ recipient, side, stock, amountUsd, amountToken, fraction });
    if (payer) d.payer = payer;
    // Segunda cotizacion: mismo lado y monto en Bankr (read-only). Si tarda o
    // falla, el draft sale igual solo con Uniswap.
    d.bankr = await bankrQuote({ side, stockAddress: d.stock.address, stockDecimals: d.stock.decimals, amountInHuman: d.amountInHuman });
    return Response.json(d);
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.code.toLowerCase(), detail: e.message }, { status: 422 });
    return Response.json({ error: "quote_failed", detail: (e as Error).message }, { status: 502 });
  }
}

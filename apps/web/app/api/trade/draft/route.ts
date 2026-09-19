import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { draftTrade, TradeError } from "../../../lib/uniswap";
import { bankrQuote } from "../../../lib/bankr";
import { traderWalletState } from "../../../lib/agentWallet";

// POST /api/trade/draft { side?, stock?, amountUsd?, amountToken?, fraction? } -> TradeDraft
// side default "buy", stock default NVDAc. Nada se firma aqui: la wallet de la
// persona firma en Floor (Approve orb). Con Settings "Pay with: Trader" una
// compra se arma para la wallet Dynamic del Trader (recipient = esa wallet) y la
// firma PerkOS despues del Hold. Una venta sigue siendo de la persona.
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
    const tw = await traderWalletState(s.wallet, s.fleetTemplateId).catch(() => null);
    if (!tw?.wallet) return Response.json({ error: "trader_wallet_missing", detail: "Create the Trader wallet in Settings first, or pay with your own wallet." }, { status: 409 });
    const maxUsd = tw.wallet.limits.maxStablePerOrder;
    // La API rechazaria la orden de todas formas; mejor que la tarjeta nunca la muestre.
    if (amountUsd !== undefined && amountUsd > maxUsd) return Response.json({ error: "amount", detail: `The Trader wallet pays up to $${maxUsd} per order.` }, { status: 400 });
    recipient = tw.wallet.address as `0x${string}`;
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

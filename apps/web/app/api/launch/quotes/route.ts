import { guard } from "../../../lib/guard";
import { bankrLaunchConfigured, bankrWallet, launchQuotes, myLaunches } from "../../../lib/bankrLaunch";

// GET /api/launch/quotes -> { configured, stocks[], wallet, last24h }
// Lo que Floor puede emparejar en Base (acciones B20) y el estado de la
// wallet Bankr de la persona. Solo lectura; cache 1 h para el registro.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!bankrLaunchConfigured()) return Response.json({ configured: false, stocks: [], wallet: null, last24h: 0 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const [all, wallet] = await Promise.all([launchQuotes(), bankrWallet(force)]);
    const stocks = all.filter((t) => t.kind === "stock").map((t) => ({ address: t.address, symbol: t.symbol, name: t.name, illiquid: t.illiquid === true }));
    const mine = wallet ? await myLaunches(wallet.evm) : { all: [], last24h: 0 };
    return Response.json({ configured: true, stocks, wallet, last24h: mine.last24h, launches: mine.all.slice(0, 20) });
  } catch (e) {
    return Response.json({ error: "bankr_quotes_failed", detail: (e as Error).message }, { status: 502 });
  }
}

import { listStocks, marketRows } from "../../../lib/stocks";

// GET /api/market/stocks[?q=nvidia][&depth=1] -> acciones tokenizadas en Base
// (Uniswap Data API + respaldo B20). depth=1 agrega el pool USDC (solo para
// las que se muestran). Para la pantalla Market y para que el equipo
// responda "que puedo operar" con datos reales.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
  if (u.searchParams.get("depth") === "1") {
    const rows = await marketRows(Number(u.searchParams.get("limit") ?? 24) || 24);
    const stocks = q ? rows.filter((s) => [s.symbol, s.ticker, s.name].some((v) => v.toLowerCase().includes(q))) : rows;
    return Response.json({ count: stocks.length, stocks });
  }
  const all = await listStocks();
  const stocks = (q ? all.filter((s) => [s.symbol, s.ticker, s.name].some((v) => v.toLowerCase().includes(q))) : all)
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return Response.json({ count: stocks.length, stocks });
}

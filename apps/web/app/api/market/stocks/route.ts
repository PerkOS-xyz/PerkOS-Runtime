import { listStocks } from "../../../lib/stocks";

// GET /api/market/stocks[?q=nvidia] -> acciones tokenizadas en Base (Uniswap
// Data API + respaldo B20). Para la escena y para que el equipo responda
// "que puedo operar" con datos reales.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const all = await listStocks();
  const stocks = (q ? all.filter((s) => [s.symbol, s.ticker, s.name].some((v) => v.toLowerCase().includes(q))) : all)
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return Response.json({ count: stocks.length, stocks });
}

import { marketScan } from "../../../lib/scan";

// GET /api/market/scan[?force=1] -> una linea por activo operable (precio, 24 h,
// rango, Chainlink, venue, profundidad). Insumo de la mesa para preguntas
// abiertas ("what should I buy for a month"). Cache 10 min.
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    return Response.json(await marketScan(force));
  } catch (e) {
    return Response.json({ error: "scan_failed", detail: (e as Error).message }, { status: 502 });
  }
}

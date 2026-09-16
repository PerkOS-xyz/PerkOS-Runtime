import { cachedNews, newsFor } from "../../../lib/news";

// POST /api/market/news { ticker, name, force? } -> { text, sources[], at, cached }
// Que movio la accion en 24 h, con fuentes (Grok web_search + x_search).
// Una busqueda por activo cada 15 min; ver lib/news.ts.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: unknown; name?: unknown; force?: unknown };
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase().slice(0, 12) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : ticker;
  if (!ticker) return Response.json({ error: "ticker" }, { status: 400 });
  const hit = body.force ? undefined : cachedNews(ticker);
  if (hit) return Response.json({ ...hit, cached: true });
  const r = await newsFor(ticker, name, body.force === true);
  if ("error" in r) return Response.json({ error: r.error, detail: r.detail }, { status: r.status });
  return Response.json({ ...r, cached: false });
}

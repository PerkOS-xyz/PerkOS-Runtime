import { loadSettings } from "../../../lib/settingsStore";
import { searchLocal } from "../../../lib/kb";

// GET /api/kb/search?q=&ticker=&k= -> hits BM25 del vault local (desk activo + app)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return Response.json({ hits: [] });
  const s = await loadSettings();
  const hits = await searchLocal(q, { desk: s.fleetTemplateId, ticker: u.searchParams.get("ticker") ?? undefined, k: Number(u.searchParams.get("k") ?? 8) || 8 });
  return Response.json({ hits });
}

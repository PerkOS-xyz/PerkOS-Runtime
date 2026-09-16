import { guard } from "../../../lib/guard";
import { assetProfile, cachedProfile } from "../../../lib/profile";

// POST /api/market/profile { ticker, name, force? } -> perfil de valuacion
// (P/E, beta, cap, proxima fecha de earnings, dividendo, consenso) con la
// linea lista para los hechos de la mesa. Cache 24 h; Knowledge antes que Grok.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { ticker?: unknown; name?: unknown; force?: unknown };
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase().slice(0, 12) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : ticker;
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) return Response.json({ error: "ticker" }, { status: 400 });
  const cached = body.force ? undefined : await cachedProfile(ticker);
  const p = cached ?? await assetProfile(ticker, name, body.force === true);
  if (!p) return Response.json({ error: "profile_unavailable", detail: "No cached profile, nothing in PerkOS Knowledge, and no Grok session to search." }, { status: 404 });
  return Response.json({ ...p, cached: Boolean(cached) });
}

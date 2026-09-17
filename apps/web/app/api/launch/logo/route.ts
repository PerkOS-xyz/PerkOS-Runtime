import { guard } from "../../../lib/guard";
import { hostLogo } from "../../../lib/launchLogo";

// POST /api/launch/logo { data: "data:image/png;base64,…" } -> { url }
// Bankr solo acepta una URL http(s) para la imagen del token (verificado: rechaza base64).
// El logo del laptop se sube a PerkOS API (Firebase Storage, lectura publica) con la
// sesion PerkOS de la wallet conectada, y la URL publica es la que viaja a Bankr.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { data?: unknown };
  const hosted = await hostLogo(typeof body.data === "string" ? body.data : "");
  if ("error" in hosted) return Response.json({ error: hosted.error, detail: hosted.detail }, { status: hosted.status });
  return Response.json({ url: hosted.url });
}

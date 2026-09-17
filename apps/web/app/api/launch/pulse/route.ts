import { guard } from "../../../lib/guard";
import { launchPulse } from "../../../lib/launchPulse";

// GET /api/launch/pulse[?fresh=1] -> LaunchPulse | { error }
// Que esta pasando en los launches de Bankr (registro publico + DexScreener). Solo lectura, sin keys.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const p = await launchPulse(fresh).catch(() => null);
  return p ? Response.json(p) : Response.json({ error: "unavailable" }, { status: 503 });
}

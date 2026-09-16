import { loadSettings } from "../../../lib/settingsStore";
import { marketBrief } from "../../../lib/market";

// GET /api/market/brief?asset=nvidia -> MarketBrief (precio, 24 h, pool,
// Chainlink vs pool, swaps 24 h, tenencia). Instantaneo, sin agentes.
export async function GET(req: Request) {
  const asset = (new URL(req.url).searchParams.get("asset") ?? "").trim().slice(0, 40);
  if (!asset) return Response.json({ error: "asset" }, { status: 400 });
  const s = await loadSettings();
  const wallet = /^0x[0-9a-fA-F]{40}$/.test(s.wallet) ? (s.wallet as `0x${string}`) : undefined;
  try {
    const b = await marketBrief(asset, wallet);
    if (!b) return Response.json({ error: "unknown_stock", detail: `No tokenized stock matches "${asset}" on Base` }, { status: 404 });
    return Response.json(b);
  } catch (e) {
    return Response.json({ error: "brief_failed", detail: (e as Error).message }, { status: 502 });
  }
}

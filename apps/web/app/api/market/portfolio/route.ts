import { loadSettings } from "../../../lib/settingsStore";
import { portfolio } from "../../../lib/stocks";

// GET /api/market/portfolio -> posiciones de la wallet en acciones tokenizadas (Base)
export async function GET() {
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  try {
    const positions = await portfolio(s.wallet as `0x${string}`);
    return Response.json({ positions, totalUsd: positions.reduce((a, p) => a + p.valueUsd, 0) });
  } catch (e) {
    return Response.json({ error: "portfolio_failed", detail: (e as Error).message }, { status: 502 });
  }
}

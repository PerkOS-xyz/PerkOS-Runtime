import { loadSettings } from "../../../lib/settingsStore";
import { poolsFor, portfolio, usdcBalance, VENUE_LABEL, type StockPool } from "../../../lib/stocks";

// GET /api/market/portfolio -> posiciones de la wallet en acciones tokenizadas (Base)
// Cada posicion trae DONDE se negocia: el venue con mas profundidad (Aerodrome
// o Uniswap V3), su pool, fee y USDC, y el otro venue cuando existe. Es lo que
// la mesa usara al redactar una venta, asi que la pantalla lo dice antes.
type VenueInfo = { venue: string; label: string; pool: string; feePct: number; usdcDepth: number; url: string };
const info = (p: StockPool): VenueInfo => ({
  venue: p.venue, label: VENUE_LABEL[p.venue], pool: p.address, feePct: p.fee / 10_000, usdcDepth: p.usdcDepth,
  url: `https://basescan.org/address/${p.address}`
});

export async function GET() {
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  try {
    const [positions, usdc] = await Promise.all([portfolio(s.wallet as `0x${string}`), usdcBalance(s.wallet as `0x${string}`).catch(() => undefined)]);
    const totalUsd = positions.reduce((a, p) => a + p.valueUsd, 0);
    const rows = [];
    for (const p of positions) {
      const pools = await poolsFor(p.address).catch(() => null);
      const best = pools?.best ? info(pools.best) : null;
      const otherPool = pools?.best ? [pools.uniswap, pools.aerodrome].find((x) => x && x.venue !== pools.best!.venue) ?? null : null;
      rows.push({ ...p, sharePct: totalUsd > 0 ? (p.valueUsd / totalUsd) * 100 : 0, venue: best, otherVenue: otherPool ? info(otherPool) : null, tradeable: Boolean(best && best.usdcDepth >= 100) });
    }
    // Cambio de 24 h del portafolio, ponderado por valor (solo posiciones con dato).
    const withChg = rows.filter((r) => typeof r.priceChange24hPct === "number" && r.valueUsd > 0);
    const chgBase = withChg.reduce((a, r) => a + r.valueUsd, 0);
    const change24hPct = chgBase > 0 ? withChg.reduce((a, r) => a + (r.priceChange24hPct as number) * r.valueUsd, 0) / chgBase : undefined;
    return Response.json({ positions: rows, totalUsd, usdc, change24hPct, wallet: s.wallet });
  } catch (e) {
    return Response.json({ error: "portfolio_failed", detail: (e as Error).message }, { status: 502 });
  }
}

import { DiskCache } from "./diskCache";

// Mercado de un token lanzado: precio, 24 h, volumen, liquidez y el pool
// (DexScreener), velas de 24 h para el sparkline (GeckoTerminal) y las
// ganancias por dia del creador (Bankr, publico). Todo sin key; cache 60 s.
export type LaunchMarket = {
  priceUsd?: number; change24hPct?: number; change1hPct?: number; volume24hUsd?: number; liquidityUsd?: number; fdvUsd?: number;
  pool?: { id: string; dex: string; label: string; quote: string; venueUrl: string; dexscreenerUrl: string; geckoUrl: string };
  sparkline?: number[]; earnings?: Array<{ date: string; weth: string }>; lifetimeEarnedWeth?: string; at: string;
};

const cache = new DiskCache<LaunchMarket>("launch-market", 60_000);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

export async function launchMarket(token: string, poolIdHint?: string): Promise<LaunchMarket> {
  const key = token.toLowerCase();
  const hit = await cache.get(key); if (hit) return hit;
  const out: LaunchMarket = { at: new Date().toISOString() };
  const dex = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { pairs?: Array<Record<string, unknown>> } | null;
  const pairs = (dex?.pairs ?? []).filter((p) => p.chainId === "base");
  // El pool con mas liquidez es el que Bankr creo (Uniswap V4 via Doppler).
  const p = pairs.sort((a, b) => (num((b.liquidity as { usd?: unknown })?.usd) ?? 0) - (num((a.liquidity as { usd?: unknown })?.usd) ?? 0))[0];
  let poolId = poolIdHint;
  if (p) {
    out.priceUsd = num(p.priceUsd);
    out.change24hPct = num((p.priceChange as Record<string, unknown>)?.h24);
    out.change1hPct = num((p.priceChange as Record<string, unknown>)?.h1);
    out.volume24hUsd = num((p.volume as Record<string, unknown>)?.h24);
    out.liquidityUsd = num((p.liquidity as Record<string, unknown>)?.usd);
    out.fdvUsd = num(p.fdv);
    poolId = String(p.pairAddress ?? poolIdHint ?? "");
    const labels = Array.isArray(p.labels) ? (p.labels as string[]) : [];
    const dexId = String(p.dexId ?? "uniswap");
    const label = dexId === "uniswap" ? `Uniswap ${labels[0]?.toUpperCase() ?? "V4"}` : dexId;
    out.pool = {
      id: poolId, dex: dexId, label, quote: String((p.quoteToken as { symbol?: unknown })?.symbol ?? ""),
      venueUrl: dexId === "uniswap" ? `https://app.uniswap.org/explore/pools/base/${poolId}` : String(p.url ?? ""),
      dexscreenerUrl: String(p.url ?? `https://dexscreener.com/base/${poolId}`),
      geckoUrl: `https://www.geckoterminal.com/base/pools/${poolId}`
    };
  } else if (poolId) {
    out.pool = { id: poolId, dex: "uniswap", label: "Uniswap V4", quote: "", venueUrl: `https://app.uniswap.org/explore/pools/base/${poolId}`, dexscreenerUrl: `https://dexscreener.com/base/${poolId}`, geckoUrl: `https://www.geckoterminal.com/base/pools/${poolId}` };
  }
  const [candles, fees] = await Promise.all([
    poolId ? fetch(`https://api.geckoterminal.com/api/v2/networks/base/pools/${poolId}/ohlcv/minute?aggregate=15&limit=96&currency=usd`, { signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    fetch(`https://api.bankr.bot/public/doppler/token-fees/${token}?days=14`, { signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ]) as [{ data?: { attributes?: { ohlcv_list?: number[][] } } } | null, { dailyEarnings?: Array<{ date: string; weth: string }>; lifetimeEarnedWeth?: string } | null];
  const list = candles?.data?.attributes?.ohlcv_list ?? [];
  // GeckoTerminal devuelve la vela mas reciente primero; el sparkline va en orden temporal (cierres).
  if (list.length >= 2) out.sparkline = [...list].reverse().map((c) => c[4]).filter((v) => Number.isFinite(v));
  if (fees?.dailyEarnings) { out.earnings = fees.dailyEarnings; out.lifetimeEarnedWeth = fees.lifetimeEarnedWeth; }
  await cache.set(key, out);
  return out;
}

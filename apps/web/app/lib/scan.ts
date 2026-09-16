import { marketRows, VENUE_LABEL, type MarketRow } from "./stocks";
import { chainlinkRef } from "./market";

// Scan del mercado: lo que Floor sabe de TODOS los activos operables antes de
// una pregunta abierta ("que compro para un mes"). Una linea por activo con
// precio, 24 h, rango, referencia Chainlink (y su frescura), venue y
// profundidad. Sin LLM. Cache de 10 min. Es el insumo del modo "advise".

export type ScanRow = {
  symbol: string; ticker: string; name: string; priceUsd?: number; change24hPct?: number;
  low24h?: number; high24h?: number; volume24hUsd?: number;
  chainlinkUsd?: number; chainlinkAgeMin?: number; chainlinkStale?: boolean; premiumPct?: number;
  venue?: string; usdcDepth?: number; line: string;
};
export type MarketScan = { at: string; rows: ScanRow[]; lines: string[] };

let cache: { at: number; scan: MarketScan } | null = null;

export async function marketScan(force = false): Promise<MarketScan> {
  if (cache && !force && Date.now() - cache.at < 10 * 60_000) return cache.scan;
  const all = await marketRows(24);
  const tradeable = all.filter((r) => r.tradeable);
  const rows: ScanRow[] = [];
  for (let i = 0; i < tradeable.length; i += 4) {
    const batch = await Promise.all(tradeable.slice(i, i + 4).map((r) => scanRow(r)));
    rows.push(...batch);
  }
  // Los que mas se movieron primero: es lo que un desk mira de entrada.
  rows.sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0));
  const scan = { at: new Date().toISOString(), rows, lines: rows.map((r) => r.line) };
  cache = { at: Date.now(), scan };
  return scan;
}

async function scanRow(r: MarketRow): Promise<ScanRow> {
  const sp = r.sparkline ?? [];
  const low = sp.length ? Math.min(...sp) : undefined;
  const high = sp.length ? Math.max(...sp) : undefined;
  const cl = await chainlinkRef(r.ticker).catch(() => undefined);
  const premiumPct = cl && r.priceUsd ? ((r.priceUsd / cl.priceUsd) - 1) * 100 : undefined;
  const venue = r.pool ? VENUE_LABEL[r.pool.venue] : undefined;
  const parts = [
    `${r.symbol} (${r.name}): $${r.priceUsd?.toFixed(2) ?? "?"}${r.priceChange24hPct !== undefined ? ` ${r.priceChange24hPct > 0 ? "+" : ""}${r.priceChange24hPct.toFixed(2)}% 24h` : ""}`,
    low !== undefined && high !== undefined ? `range $${low.toFixed(2)} to $${high.toFixed(2)}` : "",
    cl ? `Chainlink $${cl.priceUsd.toFixed(2)}${cl.stale ? ` (frozen ${cl.ageMin} min, market closed)` : ""}${premiumPct !== undefined ? `, pool ${premiumPct > 0 ? "+" : ""}${premiumPct.toFixed(2)}% vs ref` : ""}` : "no Chainlink feed",
    r.pool ? `${venue} pool $${Math.round(r.pool.usdcDepth).toLocaleString("en-US")} USDC` : "no pool",
    r.volume24hUsd !== undefined ? `volume $${Math.round(r.volume24hUsd).toLocaleString("en-US")} across venues` : ""
  ].filter(Boolean);
  return {
    symbol: r.symbol, ticker: r.ticker, name: r.name, priceUsd: r.priceUsd, change24hPct: r.priceChange24hPct,
    low24h: low, high24h: high, volume24hUsd: r.volume24hUsd,
    chainlinkUsd: cl?.priceUsd, chainlinkAgeMin: cl?.ageMin, chainlinkStale: cl?.stale, premiumPct,
    venue, usdcDepth: r.pool?.usdcDepth, line: parts.join(", ") + "."
  };
}

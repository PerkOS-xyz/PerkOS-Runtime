import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { base } from "viem/chains";

// Catalogo de acciones tokenizadas en Base y sus pools USDC en Uniswap V3.
// Fuente: la Data API de Uniswap (la misma de la pestana Stocks de Uniswap,
// que EQLTY usaba en Robinhood Chain), con cache de 5 min y respaldo en la
// lista B20 de docs.base.org. Preferimos el token de Coinbase (B20) cuando
// hay varios emisores; el resto queda disponible por simbolo exacto.

export const BASE_CHAIN_ID = 8453;
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;
const V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
const FEES = [500, 3000, 10000] as const;
const RWA_URL = "https://entry-gateway.backend-prod.api.uniswap.org/data.v1.DataApiService/ListRankedRwas";

export type Stock = {
  symbol: string;      // on-chain symbol, e.g. NVDAc
  ticker: string;      // underlying, e.g. NVDA
  name: string;        // Nvidia
  issuer: string;      // coinbase | dinari | anchored | st0x
  address: `0x${string}`;
  decimals: number;
  priceUsd?: number;
  volume24hUsd?: number;
  priceChange24hPct?: number;
  logoUrl?: string;
  /** Ultimas 24 h, un punto por hora (Uniswap Data API). */
  sparkline?: number[];
};
export type Venue = "uniswap" | "aerodrome";
export const VENUE_LABEL: Record<Venue, string> = { uniswap: "Uniswap V3", aerodrome: "Aerodrome" };
export type StockPool = { venue: Venue; address: `0x${string}`; fee: number; tickSpacing?: number; usdcDepth: number };
// Aerodrome Slipstream, deployment "Gauges V3" (el mas nuevo; los pools B20/USDC
// viven ahi). README aerodrome-finance/slipstream, verificado on-chain 2026-09-16.
export const AERO_FACTORY = "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef" as const;
export const AERO_QUOTER = "0x514c8B5f54112481E28028F1166Bd78501089259" as const;
export const AERO_ROUTER = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F" as const;
const AERO_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;
const aeroFactoryAbi = parseAbi(["function getPool(address,address,int24) view returns (address)", "function fee(address) view returns (uint24)"]);

// Respaldo: B20 de Coinbase (docs.base.org, 2026-09-15). 8 decimales.
const B20: Array<[string, string, `0x${string}`]> = [
  ["AAPL", "Apple", "0xb200000000000000000000C2e324d24d7eEcd1fb"],
  ["AMZN", "Amazon", "0xb200000000000000000000d9192b6B456483C2E8"],
  ["GOOGL", "Alphabet", "0xb2000000000000000000002D0BA3164cc74f58B7"],
  ["META", "Meta Platforms", "0xb2000000000000000000008bC8786B856E61707C"],
  ["MSFT", "Microsoft", "0xB200000000000000000000Ab99cFa739E253872B"],
  ["MSTR", "MicroStrategy", "0xb2000000000000000000004884b426556b92883d"],
  ["NVDA", "Nvidia", "0xb20000000000000000000078ee7ce2fE4908108C"],
  ["SNDK", "SanDisk", "0xb200000000000000000000397293Cb8cda9a10c5"],
  ["SPCX", "SpaceX", "0xb2000000000000000000007b9fcbd005511aCBd5"],
  ["TSLA", "Tesla", "0xb2000000000000000000001e800a7f5189430cD0"]
];
const FALLBACK: Stock[] = B20.map(([t, n, a]) => ({ symbol: `${t}c`, ticker: t, name: n, issuer: "coinbase", address: a, decimals: 8 }));

function client() {
  const url = process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
  return createPublicClient({ chain: base, transport: http(url, { retryCount: 2 }) });
}

type Spark = { points?: Array<{ timestampS?: string; value?: number }> };
type RwaItem = {
  symbol: string; name: string; logoUrl?: string; priceUsd?: number; volume24hUsd?: number; priceChange24hPct?: number; sparkline1d?: Spark;
  issuerTokens?: Array<{ symbol: string; name: string; logoUrl?: string; issuer?: string; priceUsd?: number; volume24hUsd?: number; priceChange24hPct?: number; sparkline1d?: Spark; chainTokens?: Array<{ chainId: number; address: string }> }>;
};
const sparkOf = (sp?: Spark) => (sp?.points ?? []).map((p) => Number(p.value)).filter((v) => Number.isFinite(v));

let cache: { at: number; stocks: Stock[] } | null = null;
const decimalsCache = new Map<string, number>();
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);

/** Todas las acciones tokenizadas en Base (una entrada por token emisor). */
export async function listStocks(): Promise<Stock[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.stocks;
  try {
    const res = await fetch(RWA_URL, {
      method: "POST",
      headers: { accept: "application/json", "connect-protocol-version": "1", "content-type": "application/json", "x-request-source": "perkos-floor" },
      body: JSON.stringify({ category: "RWA_CATEGORY_STOCKS", chainIds: [BASE_CHAIN_ID], includeSparkline1d: true, useSubstreamData: true }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) throw new Error(`rwa ${res.status}`);
    const j = (await res.json()) as { rwas?: RwaItem[] };
    const out: Stock[] = [];
    for (const r of j.rwas ?? []) {
      for (const t of r.issuerTokens ?? []) {
        const ct = t.chainTokens?.find((c) => c.chainId === BASE_CHAIN_ID);
        if (!ct || !/^0x[0-9a-fA-F]{40}$/.test(ct.address)) continue;
        const issuer = (t.issuer ?? "").toLowerCase() || "unknown";
        const b20 = B20.find(([, , a]) => a.toLowerCase() === ct.address.toLowerCase());
        out.push({
          symbol: b20 ? `${b20[0]}c` : t.symbol.toUpperCase(),
          ticker: r.symbol.toUpperCase(),
          name: r.name,
          issuer,
          address: ct.address as `0x${string}`,
          decimals: b20 ? 8 : -1,
          priceUsd: t.priceUsd ?? r.priceUsd,
          volume24hUsd: t.volume24hUsd ?? r.volume24hUsd,
          priceChange24hPct: t.priceChange24hPct ?? r.priceChange24hPct,
          logoUrl: t.logoUrl ?? r.logoUrl,
          sparkline: (() => { const a = sparkOf(t.sparkline1d); return a.length >= 2 ? a : sparkOf(r.sparkline1d); })()
        });
      }
    }
    // Los B20 que la API no liste igual estan.
    for (const f of FALLBACK) if (!out.some((s) => s.address.toLowerCase() === f.address.toLowerCase())) out.push(f);
    cache = { at: Date.now(), stocks: out };
    return out;
  } catch {
    return cache?.stocks ?? FALLBACK;
  }
}

const ALIASES: Record<string, string> = {
  nvidia: "NVDA", apple: "AAPL", amazon: "AMZN", google: "GOOGL", alphabet: "GOOGL", meta: "META", facebook: "META",
  microsoft: "MSFT", microstrategy: "MSTR", strategy: "MSTR", nvidiac: "NVDA", tesla: "TSLA", spacex: "SPCX", sandisk: "SNDK",
  coinbase: "COIN", circle: "CRCL", intel: "INTC", nike: "NKE", amd: "AMD"
};

/** "nvidia", "NVDA", "NVDAc", "Apple", "aapl" → el token preferido (Coinbase B20 si existe, si no el de mas volumen). */
export async function resolveStock(query: string): Promise<Stock | null> {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return null;
  const stocks = await listStocks();
  // Un simbolo on-chain exacto (NVDAc, ANVDA, WTGRND) gana; "NVDA" solo es el
  // ticker (Dinari tambien lo usa como simbolo), asi que se resuelve por
  // ticker con preferencia por el B20 de Coinbase.
  const exact = stocks.filter((s) => s.symbol.toLowerCase() === q);
  const ticker = (ALIASES[q] ?? q.replace(/c$/, "")).toUpperCase();
  const byTicker = stocks.filter((s) => s.ticker === ticker || s.ticker.toLowerCase() === q || s.name.toLowerCase().replace(/[^a-z0-9]/g, "") === q);
  const pool = byTicker.length ? byTicker : exact;
  if (!pool.length) return null;
  const pick =
    pool.find((s) => s.issuer === "coinbase") ??
    exact[0] ??
    [...pool].sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))[0];
  return withDecimals(pick);
}

async function withDecimals(s: Stock): Promise<Stock> {
  if (s.decimals >= 0) return s;
  const key = s.address.toLowerCase();
  let d = decimalsCache.get(key);
  if (d === undefined) {
    d = Number(await client().readContract({ address: s.address, abi: erc20, functionName: "decimals" }));
    decimalsCache.set(key, d);
  }
  return { ...s, decimals: d };
}

/** Pool USDC/token mas profundo en Uniswap V3 (por USDC en el pool). null si no hay ninguno. */
export async function findUsdcPool(token: `0x${string}`): Promise<StockPool | null> {
  const c = client();
  let best: StockPool | null = null;
  for (const fee of FEES) {
    const pool = await c.readContract({ address: V3_FACTORY, abi: factoryAbi, functionName: "getPool", args: [USDC, token, fee] });
    if (!pool || pool === "0x0000000000000000000000000000000000000000") continue;
    const bal = await c.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [pool] });
    const usdcDepth = Number(formatUnits(bal, USDC_DECIMALS));
    if (!best || usdcDepth > best.usdcDepth) best = { venue: "uniswap", address: pool, fee, usdcDepth };
  }
  return best;
}

/** Pool USDC/token mas profundo en Aerodrome Slipstream (CL, por tick spacing). */
export async function findAeroPool(token: `0x${string}`): Promise<StockPool | null> {
  const c = client();
  let best: StockPool | null = null;
  for (const ts of AERO_TICK_SPACINGS) {
    const pool = await c.readContract({ address: AERO_FACTORY, abi: aeroFactoryAbi, functionName: "getPool", args: [USDC, token, ts] }).catch(() => null);
    if (!pool || pool === "0x0000000000000000000000000000000000000000") continue;
    const [bal, fee] = await Promise.all([
      c.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [pool] }),
      c.readContract({ address: AERO_FACTORY, abi: aeroFactoryAbi, functionName: "fee", args: [pool] }).catch(() => 500)
    ]);
    const usdcDepth = Number(formatUnits(bal, USDC_DECIMALS));
    if (!best || usdcDepth > best.usdcDepth) best = { venue: "aerodrome", address: pool, fee: Number(fee), tickSpacing: ts, usdcDepth };
  }
  return best;
}

export type StockPools = { uniswap: StockPool | null; aerodrome: StockPool | null; best: StockPool | null };

// Pools por token en los dos venues, con cache de 5 min (varias llamadas RPC
// por token, asi que solo para los que se muestran o se cotizan).
const poolCache = new Map<string, { at: number; pools: StockPools }>();
export async function poolsFor(token: `0x${string}`): Promise<StockPools> {
  const k = token.toLowerCase();
  const c = poolCache.get(k);
  if (c && Date.now() - c.at < 5 * 60_000) return c.pools;
  const [uniswap, aerodrome] = await Promise.all([findUsdcPool(token).catch(() => null), findAeroPool(token).catch(() => null)]);
  const best = [uniswap, aerodrome].filter((p): p is StockPool => Boolean(p)).sort((a, b) => b.usdcDepth - a.usdcDepth)[0] ?? null;
  const pools = { uniswap, aerodrome, best };
  poolCache.set(k, { at: Date.now(), pools });
  return pools;
}
/** El pool mas profundo entre venues (compat con market brief y filas). */
export async function poolFor(token: `0x${string}`): Promise<StockPool | null> {
  return (await poolsFor(token)).best;
}

export type MarketRow = Stock & { pool: StockPool | null; tradeable: boolean };

/** Acciones para la pantalla Market: catalogo + pool USDC para las visibles. */
export async function marketRows(limit = 24): Promise<MarketRow[]> {
  const all = await listStocks();
  const shown = [...all]
    .sort((a, b) => Number(b.issuer === "coinbase") - Number(a.issuer === "coinbase") || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, limit);
  const rows: MarketRow[] = [];
  // Concurrencia corta: el RPC publico limita.
  for (let i = 0; i < shown.length; i += 3) {
    const batch = await Promise.all(shown.slice(i, i + 3).map(async (s) => {
      const pool = await poolFor(s.address);
      return { ...s, pool, tradeable: Boolean(pool && pool.usdcDepth >= 100) };
    }));
    rows.push(...batch);
  }
  return rows.sort((a, b) => (b.pool?.usdcDepth ?? 0) - (a.pool?.usdcDepth ?? 0) || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
}

export type Position = Stock & { balance: string; balanceRaw: string; valueUsd: number };

/** Saldo USDC de la wallet en Base (lo que la mesa puede gastar). */
export async function usdcBalance(wallet: `0x${string}`): Promise<number> {
  const c = client();
  const bal = await c.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [wallet] });
  return Number(bal) / 10 ** USDC_DECIMALS;
}

/** Posiciones de la wallet en acciones tokenizadas (un multicall). */
export async function portfolio(wallet: `0x${string}`): Promise<Position[]> {
  const all = await listStocks();
  const c = client();
  const res = await c.multicall({
    contracts: all.map((s) => ({ address: s.address, abi: erc20, functionName: "balanceOf" as const, args: [wallet] as const })),
    allowFailure: true
  });
  const out: Position[] = [];
  for (let i = 0; i < all.length; i++) {
    const r = res[i];
    if (!r || r.status !== "success" || !r.result || (r.result as bigint) === 0n) continue;
    const s = await withDecimals(all[i]);
    const bal = Number(formatUnits(r.result as bigint, s.decimals));
    out.push({ ...s, balance: bal.toFixed(Math.min(6, s.decimals)), balanceRaw: (r.result as bigint).toString(), valueUsd: bal * (s.priceUsd ?? 0) });
  }
  return out.sort((a, b) => b.valueUsd - a.valueUsd);
}

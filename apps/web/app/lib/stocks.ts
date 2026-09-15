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
};
export type StockPool = { address: `0x${string}`; fee: number; usdcDepth: number };

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

type RwaItem = {
  symbol: string; name: string; priceUsd?: number; volume24hUsd?: number;
  issuerTokens?: Array<{ symbol: string; name: string; issuer?: string; priceUsd?: number; volume24hUsd?: number; chainTokens?: Array<{ chainId: number; address: string }> }>;
};

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
      body: JSON.stringify({ category: "RWA_CATEGORY_STOCKS", chainIds: [BASE_CHAIN_ID], includeSparkline1d: false, useSubstreamData: true }),
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
          volume24hUsd: t.volume24hUsd ?? r.volume24hUsd
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
    if (!best || usdcDepth > best.usdcDepth) best = { address: pool, fee, usdcDepth };
  }
  return best;
}

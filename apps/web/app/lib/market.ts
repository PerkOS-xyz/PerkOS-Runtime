import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { USDC, USDC_DECIMALS, poolFor, resolveStock, type Stock, type StockPool } from "./stocks";

// Market brief de un activo: lo que Floor sabe ANTES de preguntarle al equipo.
// Uniswap Data API (precio, 24 h, sparkline) + pool V3 on-chain (precio
// implicito) + Chainlink (precio "oficial" total-return de la accion, 24/5)
// + swaps de 24 h (si el RPC es de archivo) + tenencia de la wallet.

// Feeds Chainlink por B20 en Base (docs.base.org, 2026-09-15). 8 decimales,
// heartbeat 24 h, desviacion 0.5 %, valores total-return (ajustados por
// splits/dividendos). Se congelan fuera del horario de mercado.
const CHAINLINK: Record<string, `0x${string}`> = {
  AAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZN: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGL: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  META: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFT: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  MSTR: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
  NVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  SNDK: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
  SPCX: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
  TSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"
};

const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256 answer,uint256,uint256 updatedAt,uint80)"]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

function client() {
  const url = process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
  return createPublicClient({ chain: base, transport: http(url, { retryCount: 2 }) });
}

export type MarketBrief = {
  at: string;
  stock: Pick<Stock, "symbol" | "ticker" | "name" | "issuer" | "address" | "decimals">;
  priceUsd?: number;
  change24hPct?: number;
  range24h?: { low: number; high: number; open: number; last: number };
  volume24hUsd?: number;
  sparkline?: number[];
  pool: (StockPool & { priceUsd?: number }) | null;
  chainlink?: { priceUsd: number; updatedAt: string; ageMin: number; stale: boolean };
  premiumPct?: number;        // pool vs Chainlink
  swaps24h?: { count: number; usdcVolume: number; buys: number; sells: number };
  holding?: { balance: string; valueUsd: number };
  /** Lineas listas para el prompt de la mesa y para leer en voz alta. */
  lines: string[];
};

export async function marketBrief(assetQuery: string, wallet?: `0x${string}`): Promise<MarketBrief | null> {
  const stock = await resolveStock(assetQuery);
  if (!stock) return null;
  const c = client();
  const pool = await poolFor(stock.address);
  const sp = stock.sparkline ?? [];
  const range24h = sp.length >= 2 ? { low: Math.min(...sp), high: Math.max(...sp), open: sp[0], last: sp[sp.length - 1] } : undefined;

  const [poolPrice, cl, holding, swaps] = await Promise.all([
    pool ? poolPriceUsd(c, pool.address, stock) : Promise.resolve(undefined),
    chainlink(c, stock.ticker),
    wallet ? c.readContract({ address: stock.address, abi: erc20, functionName: "balanceOf", args: [wallet] }).catch(() => 0n) : Promise.resolve(0n),
    pool ? swaps24h(c, pool.address, stock).catch(() => undefined) : Promise.resolve(undefined)
  ]);
  const premiumPct = poolPrice !== undefined && cl ? ((poolPrice / cl.priceUsd) - 1) * 100 : undefined;
  const bal = Number(formatUnits(holding, stock.decimals));
  const b: MarketBrief = {
    at: new Date().toISOString(),
    stock: { symbol: stock.symbol, ticker: stock.ticker, name: stock.name, issuer: stock.issuer, address: stock.address, decimals: stock.decimals },
    priceUsd: stock.priceUsd,
    change24hPct: stock.priceChange24hPct,
    range24h,
    volume24hUsd: stock.volume24hUsd,
    sparkline: sp,
    pool: pool ? { ...pool, priceUsd: poolPrice } : null,
    chainlink: cl,
    premiumPct,
    swaps24h: swaps,
    holding: bal > 0 ? { balance: bal.toFixed(Math.min(6, stock.decimals)), valueUsd: bal * (stock.priceUsd ?? 0) } : undefined,
    lines: []
  };
  b.lines = briefLines(b);
  return b;
}

async function poolPriceUsd(c: ReturnType<typeof client>, pool: `0x${string}`, stock: Stock): Promise<number | undefined> {
  try {
    const [s, t0] = await Promise.all([
      c.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      c.readContract({ address: pool, abi: poolAbi, functionName: "token0" })
    ]);
    const sqrt = Number(s[0]) / 2 ** 96;
    const p = sqrt * sqrt; // token1 per token0, raw units
    const usdcIs0 = t0.toLowerCase() === USDC.toLowerCase();
    // USDC per share, corrigiendo decimales.
    return usdcIs0 ? (1 / p) * 10 ** (stock.decimals - USDC_DECIMALS) : p * 10 ** (stock.decimals - USDC_DECIMALS);
  } catch {
    return undefined;
  }
}

async function chainlink(c: ReturnType<typeof client>, ticker: string): Promise<MarketBrief["chainlink"]> {
  const feed = CHAINLINK[ticker.toUpperCase()];
  if (!feed) return undefined;
  try {
    const rd = await c.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const updated = Number(rd[3]);
    const ageMin = Math.max(0, Math.round((Date.now() / 1000 - updated) / 60));
    return { priceUsd: Number(rd[1]) / 1e8, updatedAt: new Date(updated * 1000).toISOString(), ageMin, stale: ageMin > 90 };
  } catch {
    return undefined;
  }
}

async function swaps24h(c: ReturnType<typeof client>, pool: `0x${string}`, stock: Stock): Promise<MarketBrief["swaps24h"]> {
  // ~43 200 bloques de 2 s. Requiere RPC de archivo (Alchemy); con el RPC
  // publico falla y el brief sigue sin esta linea.
  const head = await c.getBlockNumber();
  const t0 = await c.readContract({ address: pool, abi: poolAbi, functionName: "token0" });
  const usdcIs0 = t0.toLowerCase() === USDC.toLowerCase();
  const logs = await c.getLogs({ address: pool, event: poolAbi[2], fromBlock: head - 43_200n, toBlock: head });
  let usdcVolume = 0, buys = 0, sells = 0;
  for (const l of logs) {
    const usdcAmt = Number(usdcIs0 ? l.args.amount0 : l.args.amount1) / 10 ** USDC_DECIMALS;
    usdcVolume += Math.abs(usdcAmt);
    // USDC entrando al pool (positivo) = compra de la accion.
    if (usdcAmt > 0) buys++; else sells++;
  }
  void stock;
  return { count: logs.length, usdcVolume: Math.round(usdcVolume), buys, sells };
}

function briefLines(b: MarketBrief): string[] {
  const L: string[] = [];
  const issuer = b.stock.issuer === "coinbase" ? "Coinbase B20" : b.stock.issuer;
  L.push(`${b.stock.name} (${b.stock.symbol}, ${issuer}) on Base: $${b.priceUsd?.toFixed(2) ?? "?"}${b.change24hPct !== undefined ? ` (${b.change24hPct > 0 ? "+" : ""}${b.change24hPct.toFixed(2)}% in 24h)` : ""}.`);
  if (b.range24h) L.push(`24h range $${b.range24h.low.toFixed(2)} to $${b.range24h.high.toFixed(2)}, opened $${b.range24h.open.toFixed(2)}, last $${b.range24h.last.toFixed(2)}.`);
  if (b.volume24hUsd !== undefined) L.push(`24h volume across venues: $${Math.round(b.volume24hUsd).toLocaleString("en-US")}.`);
  if (b.chainlink) L.push(`Chainlink reference price for the stock: $${b.chainlink.priceUsd.toFixed(2)}, updated ${b.chainlink.ageMin} min ago${b.chainlink.stale ? " (market closed, feed frozen)" : ""}.`);
  if (b.pool) L.push(`Uniswap V3 pool ${b.pool.fee / 10_000}% holds $${Math.round(b.pool.usdcDepth).toLocaleString("en-US")} USDC${b.pool.priceUsd ? `, pool price $${b.pool.priceUsd.toFixed(2)}` : ""}${b.premiumPct !== undefined ? ` (${b.premiumPct > 0 ? "+" : ""}${b.premiumPct.toFixed(2)}% vs Chainlink)` : ""}.`);
  else L.push("No USDC pool on Uniswap V3 Base: not tradeable from this desk.");
  if (b.swaps24h) L.push(`${b.swaps24h.count} swaps in the last 24h on that pool ($${b.swaps24h.usdcVolume.toLocaleString("en-US")} USDC): ${b.swaps24h.buys} buys, ${b.swaps24h.sells} sells.`);
  if (b.holding) L.push(`The human holds ${b.holding.balance} ${b.stock.symbol} (~$${b.holding.valueUsd.toFixed(2)}).`);
  else L.push(`The human holds no ${b.stock.symbol}.`);
  return L;
}

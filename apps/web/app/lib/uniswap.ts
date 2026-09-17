import type { BankrQuote } from "./bankr";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";
import { AERO_QUOTER, AERO_ROUTER, BASE_CHAIN_ID, USDC, USDC_DECIMALS, VENUE_LABEL, poolsFor, resolveStock, type Stock, type StockPool, type Venue } from "./stocks";

// Compra/venta de acciones tokenizadas con USDC en Base mainnet, en dos venues:
// Uniswap V3 y Aerodrome Slipstream (CL). Floor COTIZA en los dos, elige el
// mejor precio y ARMA las transacciones; las firma la wallet de la persona
// (MetaMask por WalletConnect). Nada aqui tiene llaves. Ruta = un unico pool
// USDC/token por venue (el mas profundo), descubierto en stocks.ts.

export { BASE_CHAIN_ID, USDC, USDC_DECIMALS };
export const NVDAC = "0xb20000000000000000000078ee7ce2fE4908108C" as const;
export const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
export const SWAP_ROUTER_02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
]);
// Slipstream: mismo diseno que Uniswap V3 pero el pool se identifica por tickSpacing.
const aeroQuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);
const aeroRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
]);
export type VenueQuote = { venue: Venue; label: string; pool: string; fee: number; tickSpacing?: number; usdcDepth: number; out: string; outHuman: string; priceUsd: number };
const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
]);

function client() {
  const url = process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
  return createPublicClient({ chain: base, transport: http(url, { retryCount: 2 }) });
}

export type TradeSide = "buy" | "sell";
export type TradeTx = { to: `0x${string}`; data: Hex; value: `0x${string}`; label: "approve" | "permit" | "swap"; /** Simular justo antes de pedir la firma (depende de las anteriores). */ simulate?: boolean };
export type TradeDraft = {
  id: string;
  chainId: number;
  recipient: `0x${string}`;
  side: TradeSide;
  stock: Pick<Stock, "symbol" | "ticker" | "name" | "issuer" | "address" | "decimals">;
  pool: string;
  fee: number;
  poolUsdcDepth: number;
  tokenIn: { address: string; symbol: string; decimals: number };
  tokenOut: { address: string; symbol: string; decimals: number };
  amountIn: string;        // raw
  amountInHuman: string;
  amountInUsd: number;     // buy: lo que pagas; sell: valor estimado de lo que vendes
  quoteOut: string;        // raw
  quoteOutHuman: string;
  minOut: string;          // raw, con slippage
  slippageBps: number;
  impliedPriceUsd: number; // USD por accion
  gasEstimate: string;
  deadline: number;
  quotedAt: string;
  needsApproval: boolean;
  balanceUsdc: string;
  balanceToken: string;
  txs: TradeTx[];
  /** Venue elegido (mejor precio entre los pools con profundidad) y todas las cotizaciones. */
  venue: Venue;
  venueLabel: string;
  tickSpacing?: number;
  venues: VenueQuote[];
  /** Segunda cotizacion (Bankr, read-only). null si no hay key o fallo. */
  bankr?: BankrQuote | null;
  /** Compra de un token lanzado: se paga con ETH (no USDC) y la ruta se describe en una linea. */
  payWith?: { symbol: string; amountHuman: string; balanceHuman: string; priceUsd: number };
  /** Venta de un token lanzado: lo que entra a la wallet es ETH. */
  receive?: { symbol: string; amountHuman: string; minHuman: string; usd: number };
  route?: string;
};

export class TradeError extends Error {
  constructor(public code: "UNKNOWN_STOCK" | "NO_POOL" | "THIN_POOL" | "AMOUNT" | "NO_BALANCE", message: string) {
    super(message);
  }
}

type DraftArgs = {
  recipient: `0x${string}`;
  side: TradeSide;
  /** "NVDA", "nvidia", "AAPLc"… default NVDAc. */
  stock?: string;
  amountUsd?: number;        // buy: USDC a gastar; sell: se convierte a tokens con el precio del pool
  amountToken?: number;      // sell: tokens a vender
  fraction?: number;         // sell: 0..1 del saldo (half = 0.5, all = 1)
  slippageBps?: number;
};

/** Cotiza y arma approve (si falta) + swap para `recipient`, buy o sell. */
export async function draftTrade(a: DraftArgs): Promise<TradeDraft> {
  const slippageBps = a.slippageBps ?? 100;
  const stock = await resolveStock(a.stock?.trim() || "NVDAc");
  if (!stock) throw new TradeError("UNKNOWN_STOCK", `No tokenized stock matches "${a.stock}" on Base`);
  const pools = await poolsFor(stock.address);
  const candidates = [pools.uniswap, pools.aerodrome].filter((p): p is StockPool => Boolean(p));
  if (!candidates.length) throw new TradeError("NO_POOL", `${stock.symbol} has no USDC pool on Uniswap V3 or Aerodrome on Base`);
  const deep = candidates.filter((p) => p.usdcDepth >= 100);
  if (!deep.length) throw new TradeError("THIN_POOL", `${stock.symbol}'s deepest USDC pool holds only $${Math.max(...candidates.map((p) => p.usdcDepth)).toFixed(0)}; too thin to trade`);
  const pool0 = pools.best!;
  const c = client();
  const [balUsdc, balToken] = await Promise.all([
    c.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a.recipient] }),
    c.readContract({ address: stock.address, abi: erc20Abi, functionName: "balanceOf", args: [a.recipient] })
  ]);

  const tokenIn = a.side === "buy" ? { address: USDC, symbol: "USDC", decimals: USDC_DECIMALS } : { address: stock.address, symbol: stock.symbol, decimals: stock.decimals };
  const tokenOut = a.side === "buy" ? { address: stock.address, symbol: stock.symbol, decimals: stock.decimals } : { address: USDC, symbol: "USDC", decimals: USDC_DECIMALS };

  let amountIn: bigint;
  if (a.side === "buy") {
    const usd = Number(a.amountUsd);
    if (!(usd > 0 && usd <= 100)) throw new TradeError("AMOUNT", "amountUsd must be between 0 and 100 USD");
    amountIn = BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
  } else {
    if (a.fraction !== undefined) {
      const f = Math.min(1, Math.max(0, Number(a.fraction)));
      amountIn = (balToken * BigInt(Math.round(f * 10_000))) / 10_000n;
    } else if (a.amountToken !== undefined) {
      amountIn = BigInt(Math.round(Number(a.amountToken) * 10 ** stock.decimals));
    } else if (a.amountUsd !== undefined) {
      // USD → tokens al precio del pool (cotizacion inversa de 1 USDC).
      const one = await quote(c, USDC, stock.address, BigInt(10 ** USDC_DECIMALS), pool0);
      amountIn = (one.out * BigInt(Math.round(Number(a.amountUsd) * 1000))) / 1000n;
    } else throw new TradeError("AMOUNT", "sell needs amountToken, amountUsd or fraction");
    if (amountIn <= 0n) throw new TradeError("NO_BALANCE", `You hold no ${stock.symbol} on Base`);
    if (amountIn > balToken) throw new TradeError("NO_BALANCE", `You hold ${formatUnits(balToken, stock.decimals)} ${stock.symbol}; the draft needs ${formatUnits(amountIn, stock.decimals)}`);
  }

  // Cotizar en cada venue con profundidad; el Trader elige el mejor precio.
  const quoted = (await Promise.all(deep.map(async (p) => {
    try {
      const r = await quote(c, tokenIn.address as `0x${string}`, tokenOut.address as `0x${string}`, amountIn, p);
      return { pool: p, q: r };
    } catch { return null; }
  }))).filter((x): x is { pool: StockPool; q: { out: bigint; gas: bigint } } => Boolean(x));
  if (!quoted.length) throw new TradeError("NO_POOL", `No venue returned a quote for ${stock.symbol}`);
  quoted.sort((x, y) => (y.q.out > x.q.out ? 1 : y.q.out < x.q.out ? -1 : 0));
  const pool = quoted[0].pool;
  const q = quoted[0].q;
  const router = pool.venue === "aerodrome" ? AERO_ROUTER : SWAP_ROUTER_02;
  const allowance = await c.readContract({ address: tokenIn.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [a.recipient, router] });
  const minOut = (q.out * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const needsApproval = allowance < amountIn;
  const txs: TradeTx[] = [];
  if (needsApproval) {
    txs.push({ label: "approve", to: tokenIn.address as `0x${string}`, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, amountIn] }) });
  }
  txs.push({
    label: "swap",
    to: router,
    value: "0x0",
    data: pool.venue === "aerodrome"
      ? encodeFunctionData({
          abi: aeroRouterAbi,
          functionName: "exactInputSingle",
          args: [{ tokenIn: tokenIn.address as `0x${string}`, tokenOut: tokenOut.address as `0x${string}`, tickSpacing: pool.tickSpacing ?? 10, recipient: a.recipient, deadline: BigInt(deadline), amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }]
        })
      : encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [{ tokenIn: tokenIn.address as `0x${string}`, tokenOut: tokenOut.address as `0x${string}`, fee: pool.fee, recipient: a.recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }]
        })
  });
  const inHuman = Number(formatUnits(amountIn, tokenIn.decimals));
  const outHuman = Number(formatUnits(q.out, tokenOut.decimals));
  const venues: VenueQuote[] = quoted.map(({ pool: p, q: r }) => {
    const oh = Number(formatUnits(r.out, tokenOut.decimals));
    const usdV = a.side === "buy" ? inHuman : oh;
    const sharesV = a.side === "buy" ? oh : inHuman;
    return { venue: p.venue, label: VENUE_LABEL[p.venue], pool: p.address, fee: p.fee, tickSpacing: p.tickSpacing, usdcDepth: p.usdcDepth, out: r.out.toString(), outHuman: oh.toFixed(a.side === "buy" ? 6 : 2), priceUsd: sharesV > 0 ? usdV / sharesV : 0 };
  });
  const usd = a.side === "buy" ? inHuman : outHuman;
  const shares = a.side === "buy" ? outHuman : inHuman;
  return {
    id: `draft-${Date.now().toString(36)}`,
    chainId: BASE_CHAIN_ID,
    recipient: a.recipient,
    side: a.side,
    stock: { symbol: stock.symbol, ticker: stock.ticker, name: stock.name, issuer: stock.issuer, address: stock.address, decimals: stock.decimals },
    pool: pool.address,
    fee: pool.fee,
    poolUsdcDepth: pool.usdcDepth,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    amountInHuman: inHuman.toFixed(a.side === "buy" ? 2 : 6),
    amountInUsd: Number(usd.toFixed(2)),
    quoteOut: q.out.toString(),
    quoteOutHuman: outHuman.toFixed(a.side === "buy" ? 6 : 2),
    minOut: minOut.toString(),
    slippageBps,
    impliedPriceUsd: shares > 0 ? usd / shares : 0,
    gasEstimate: q.gas.toString(),
    deadline,
    quotedAt: new Date().toISOString(),
    needsApproval,
    balanceUsdc: formatUnits(balUsdc, USDC_DECIMALS),
    balanceToken: formatUnits(balToken, stock.decimals),
    txs,
    venue: pool.venue,
    venueLabel: VENUE_LABEL[pool.venue],
    tickSpacing: pool.tickSpacing,
    venues
  };
}

async function quote(c: ReturnType<typeof client>, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, pool: StockPool): Promise<{ out: bigint; gas: bigint }> {
  if (pool.venue === "aerodrome") {
    const r = await c.simulateContract({ address: AERO_QUOTER, abi: aeroQuoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, tickSpacing: pool.tickSpacing ?? 10, sqrtPriceLimitX96: 0n }] });
    return { out: r.result[0], gas: r.result[3] };
  }
  const r = await c.simulateContract({ address: QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }] });
  return { out: r.result[0], gas: r.result[3] };
}

/** Compat: compra de NVDAc con USDC (el camino del demo). */
export function draftBuy(recipient: `0x${string}`, amountUsd: number, slippageBps = 100): Promise<TradeDraft> {
  return draftTrade({ recipient, side: "buy", stock: "NVDAc", amountUsd, slippageBps });
}

export type TradeReceipt = { hash: string; status: "pending" | "success" | "reverted"; blockNumber?: string; gasUsed?: string; explorer: string };

export async function txReceipt(hash: `0x${string}`): Promise<TradeReceipt> {
  const explorer = `https://basescan.org/tx/${hash}`;
  try {
    const r = await client().getTransactionReceipt({ hash });
    return { hash, status: r.status === "success" ? "success" : "reverted", blockNumber: r.blockNumber.toString(), gasUsed: r.gasUsed.toString(), explorer };
  } catch {
    return { hash, status: "pending", explorer };
  }
}

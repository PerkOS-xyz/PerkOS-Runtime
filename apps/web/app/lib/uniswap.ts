import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID, USDC, USDC_DECIMALS, findUsdcPool, resolveStock, type Stock, type StockPool } from "./stocks";

// Compra/venta de acciones tokenizadas con USDC en Uniswap V3 Base mainnet.
// Floor solo COTIZA y ARMA las transacciones; las firma la wallet de la persona
// (MetaMask por WalletConnect). Nada aqui tiene llaves. La ruta es siempre un
// unico pool USDC/token (el mas profundo), elegido en stocks.ts.

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
export type TradeTx = { to: `0x${string}`; data: Hex; value: "0x0"; label: "approve" | "swap" };
export type TradeDraft = {
  id: string;
  chainId: number;
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
  const pool = await findUsdcPool(stock.address);
  if (!pool) throw new TradeError("NO_POOL", `${stock.symbol} has no USDC pool on Uniswap V3 Base`);
  if (pool.usdcDepth < 100) throw new TradeError("THIN_POOL", `${stock.symbol}'s USDC pool holds only $${pool.usdcDepth.toFixed(0)}; too thin to trade`);
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
      const one = await quote(c, USDC, stock.address, BigInt(10 ** USDC_DECIMALS), pool.fee);
      amountIn = (one.out * BigInt(Math.round(Number(a.amountUsd) * 1000))) / 1000n;
    } else throw new TradeError("AMOUNT", "sell needs amountToken, amountUsd or fraction");
    if (amountIn <= 0n) throw new TradeError("NO_BALANCE", `You hold no ${stock.symbol} on Base`);
    if (amountIn > balToken) throw new TradeError("NO_BALANCE", `You hold ${formatUnits(balToken, stock.decimals)} ${stock.symbol}; the draft needs ${formatUnits(amountIn, stock.decimals)}`);
  }

  const [q, allowance] = await Promise.all([
    quote(c, tokenIn.address as `0x${string}`, tokenOut.address as `0x${string}`, amountIn, pool.fee),
    c.readContract({ address: tokenIn.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [a.recipient, SWAP_ROUTER_02] })
  ]);
  const minOut = (q.out * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const needsApproval = allowance < amountIn;
  const txs: TradeTx[] = [];
  if (needsApproval) {
    txs.push({ label: "approve", to: tokenIn.address as `0x${string}`, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER_02, amountIn] }) });
  }
  txs.push({
    label: "swap",
    to: SWAP_ROUTER_02,
    value: "0x0",
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: tokenIn.address as `0x${string}`, tokenOut: tokenOut.address as `0x${string}`, fee: pool.fee, recipient: a.recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }]
    })
  });
  const inHuman = Number(formatUnits(amountIn, tokenIn.decimals));
  const outHuman = Number(formatUnits(q.out, tokenOut.decimals));
  const usd = a.side === "buy" ? inHuman : outHuman;
  const shares = a.side === "buy" ? outHuman : inHuman;
  return {
    id: `draft-${Date.now().toString(36)}`,
    chainId: BASE_CHAIN_ID,
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
    txs
  };
}

async function quote(c: ReturnType<typeof client>, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, fee: number): Promise<{ out: bigint; gas: bigint }> {
  const r = await c.simulateContract({ address: QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }] });
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

import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";

// Compra de NVDAc (B20 tokenized stock) con USDC en Uniswap V3 Base mainnet.
// Floor solo COTIZA y ARMA las transacciones; las firma la wallet de la persona
// (MetaMask por WalletConnect). Nada aqui tiene llaves. Pool verificado
// on-chain 2026-09-15: USDC/NVDAc 0.3%, ~$11k USDC de liquidez.

export const BASE_CHAIN_ID = 8453;
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const NVDAC = "0xb20000000000000000000078ee7ce2fE4908108C" as const;
export const POOL = "0x60661b315553EB81872deEA9a66d567Cf0CCd33B" as const;
export const POOL_FEE = 3000;
export const QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
export const SWAP_ROUTER_02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
export const USDC_DECIMALS = 6;
export const NVDAC_DECIMALS = 8;

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

export type TradeTx = { to: `0x${string}`; data: Hex; value: "0x0"; label: "approve" | "swap" };
export type TradeDraft = {
  id: string;
  chainId: number;
  pool: string;
  fee: number;
  tokenIn: { address: string; symbol: "USDC"; decimals: number };
  tokenOut: { address: string; symbol: "NVDAc"; decimals: number };
  amountIn: string;        // raw (6 dec)
  amountInUsd: number;
  quoteOut: string;        // raw (8 dec)
  quoteOutHuman: string;
  minOut: string;          // raw, con slippage
  slippageBps: number;
  impliedPriceUsd: number;
  gasEstimate: string;
  deadline: number;        // unix s
  quotedAt: string;
  needsApproval: boolean;
  balanceUsdc: string;
  txs: TradeTx[];
};

/** Cotiza y arma approve (si falta) + swap para `recipient`. */
export async function draftBuy(recipient: `0x${string}`, amountUsd: number, slippageBps = 100): Promise<TradeDraft> {
  if (!(amountUsd > 0 && amountUsd <= 100)) throw new Error("amount must be between 0 and 100 USD");
  const c = client();
  const amountIn = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  const [quote, allowance, balance] = await Promise.all([
    c.simulateContract({
      address: QUOTER_V2,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: USDC, tokenOut: NVDAC, amountIn, fee: POOL_FEE, sqrtPriceLimitX96: 0n }]
    }),
    c.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [recipient, SWAP_ROUTER_02] }),
    c.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [recipient] })
  ]);
  const amountOut = quote.result[0];
  const minOut = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const needsApproval = allowance < amountIn;
  const txs: TradeTx[] = [];
  if (needsApproval) {
    txs.push({
      label: "approve",
      to: USDC,
      value: "0x0",
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER_02, amountIn] })
    });
  }
  txs.push({
    label: "swap",
    to: SWAP_ROUTER_02,
    value: "0x0",
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: USDC, tokenOut: NVDAC, fee: POOL_FEE, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }]
    })
  });
  const outHuman = Number(formatUnits(amountOut, NVDAC_DECIMALS));
  return {
    id: `draft-${Date.now().toString(36)}`,
    chainId: BASE_CHAIN_ID,
    pool: POOL,
    fee: POOL_FEE,
    tokenIn: { address: USDC, symbol: "USDC", decimals: USDC_DECIMALS },
    tokenOut: { address: NVDAC, symbol: "NVDAc", decimals: NVDAC_DECIMALS },
    amountIn: amountIn.toString(),
    amountInUsd: amountUsd,
    quoteOut: amountOut.toString(),
    quoteOutHuman: outHuman.toFixed(6),
    minOut: minOut.toString(),
    slippageBps,
    impliedPriceUsd: outHuman > 0 ? amountUsd / outHuman : 0,
    gasEstimate: quote.result[3].toString(),
    deadline,
    quotedAt: new Date().toISOString(),
    needsApproval,
    balanceUsdc: formatUnits(balance, USDC_DECIMALS),
    txs
  };
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

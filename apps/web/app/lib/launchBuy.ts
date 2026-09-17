// Compra de un token lanzado con Bankr (pool Uniswap V4 de Doppler) desde el desk, pagando con ETH
// en Base. Una sola transaccion al Universal Router de Uniswap: WRAP_ETH, el tramo V3 hasta el
// token del par (WETH -> NVDAc, o WETH -> USDC -> NVDAc si cotiza mejor) y el swap V4 contra el
// pool del launch. Sin approvals ni Permit2: el ETH viaja en `value`. La transaccion exacta se
// simula contra la cadena antes de devolver el draft; si revierte, no hay draft.
// Nada se firma aqui: la wallet de la persona firma en el cliente, igual que una orden.
import { createPublicClient, decodeEventLog, encodeAbiParameters, encodeFunctionData, encodePacked, formatUnits, http, parseAbi, parseEther, type Hex } from "viem";
import { base } from "viem/chains";
import { DiskCache } from "./diskCache";
import { BASE_CHAIN_ID, USDC, USDC_DECIMALS, QUOTER_V2, TradeError, type TradeDraft } from "./uniswap";

export const UNIVERSAL_ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43" as const;
export const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b" as const;
export const V4_QUOTER = "0x0d5e0F971ED27FBfF6c2837bf31316121532048D" as const;
export const WETH = "0x4200000000000000000000000000000000000006" as const;

type Addr = `0x${string}`;
export type PoolKey = { currency0: Addr; currency1: Addr; fee: number; tickSpacing: number; hooks: Addr };

const initAbi = parseAbi(["event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"]);
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function name() view returns (string)", "function balanceOf(address) view returns (uint256)"]);
const quoterV2 = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
]);
const v4Quoter = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)"
]);
const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

// Comandos del Universal Router y acciones de v4-periphery (los mismos bytes que usan los swaps reales del pool).
const CMD = { V3_SWAP_EXACT_IN: "00", SWEEP: "04", WRAP_ETH: "0b", V4_SWAP: "10" } as const;
const ACT = { SWAP_EXACT_IN_SINGLE: "06", SETTLE: "0b", TAKE_ALL: "0f" } as const;
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as const;
const CONTRACT_BALANCE = 1n << 255n; // "lo que tenga el router": salida del tramo anterior
const OPEN_DELTA = 0n;               // "todo el credito abierto" tras el SETTLE

function client() {
  const url = process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
  return createPublicClient({ chain: base, transport: http(url, { retryCount: 2 }) });
}

const keyCache = new DiskCache<PoolKey>("launch-pool-key", 365 * 24 * 60 * 60_000);

/** La clave del pool V4 sale del evento Initialize del PoolManager en la transaccion de deploy. */
export async function poolKeyFromDeploy(txHash: Hex, token: Addr): Promise<PoolKey> {
  const hit = await keyCache.get(txHash); if (hit) return hit;
  const rc = await client().getTransactionReceipt({ hash: txHash });
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== POOL_MANAGER.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: initAbi, data: l.data, topics: l.topics });
      const a = e.args;
      if (a.currency0.toLowerCase() !== token.toLowerCase() && a.currency1.toLowerCase() !== token.toLowerCase()) continue;
      const key: PoolKey = { currency0: a.currency0, currency1: a.currency1, fee: a.fee, tickSpacing: a.tickSpacing, hooks: a.hooks };
      await keyCache.set(txHash, key);
      return key;
    } catch { /* otro evento del PoolManager */ }
  }
  throw new TradeError("NO_POOL", "The deploy transaction has no Uniswap V4 pool for this token");
}

const v3Path = (hops: Array<Addr | number>): Hex => encodePacked(hops.map((h) => (typeof h === "number" ? "uint24" : "address")), hops);

export type LaunchBuyArgs = { recipient: Addr; token: Addr; deployTx: Hex; amountUsd: number; slippageBps?: number };

/** Draft de compra con ETH: cotiza los dos tramos, arma la llamada al router y la simula. */
export async function draftLaunchBuy(a: LaunchBuyArgs): Promise<TradeDraft> {
  const usd = Number(a.amountUsd);
  if (!(usd > 0 && usd <= 100)) throw new TradeError("AMOUNT", "amountUsd must be between 0 and 100 USD");
  const slippageBps = a.slippageBps ?? 300;
  const c = client();
  const key = await poolKeyFromDeploy(a.deployTx, a.token);
  const pair = (key.currency0.toLowerCase() === a.token.toLowerCase() ? key.currency1 : key.currency0) as Addr;
  const zeroForOne = key.currency0.toLowerCase() === pair.toLowerCase(); // entra el par, sale el token
  const [symbol, name, decimals, pairSymbol, pairDecimals, ethBal] = await Promise.all([
    c.readContract({ address: a.token, abi: erc20, functionName: "symbol" }),
    c.readContract({ address: a.token, abi: erc20, functionName: "name" }),
    c.readContract({ address: a.token, abi: erc20, functionName: "decimals" }),
    pair.toLowerCase() === WETH.toLowerCase() ? Promise.resolve("WETH") : c.readContract({ address: pair, abi: erc20, functionName: "symbol" }),
    pair.toLowerCase() === WETH.toLowerCase() ? Promise.resolve(18) : c.readContract({ address: pair, abi: erc20, functionName: "decimals" }),
    c.getBalance({ address: a.recipient })
  ]);

  // Cuanto ETH son esos dolares: 1 ETH en USDC por el pool WETH/USDC 0.05 % de Uniswap V3.
  const oneEth = await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInputSingle", args: [{ tokenIn: WETH, tokenOut: USDC, amountIn: parseEther("1"), fee: 500, sqrtPriceLimitX96: 0n }] });
  const ethUsd = Number(formatUnits(oneEth.result[0], USDC_DECIMALS));
  if (!(ethUsd > 0)) throw new TradeError("NO_POOL", "No ETH price on Base right now");
  const amountIn = parseEther((usd / ethUsd).toFixed(18));

  // Tramo V3 hasta el token del par: se cotizan las rutas y gana la que mas entrega.
  let pairIn = amountIn, path: Hex | null = null, routeLabel = "ETH";
  if (pair.toLowerCase() !== WETH.toLowerCase()) {
    const routes: Array<{ label: string; path: Hex }> = [
      { label: `ETH → ${pairSymbol}`, path: v3Path([WETH, 3000, pair]) },
      { label: `ETH → USDC → ${pairSymbol}`, path: v3Path([WETH, 500, USDC, 3000, pair]) }
    ];
    const quoted = (await Promise.all(routes.map(async (r) => {
      try { const q = await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInput", args: [r.path, amountIn] }); return { ...r, out: q.result[0] }; } catch { return null; }
    }))).filter((x): x is { label: string; path: Hex; out: bigint } => Boolean(x && x.out > 0n));
    if (!quoted.length) throw new TradeError("NO_POOL", `No Uniswap V3 route from ETH to ${pairSymbol} on Base`);
    quoted.sort((x, y) => (y.out > x.out ? 1 : y.out < x.out ? -1 : 0));
    pairIn = quoted[0].out; path = quoted[0].path; routeLabel = quoted[0].label;
  }

  // Tramo V4 contra el pool del launch (hook de Doppler, fee dinamico).
  const q4 = await c.simulateContract({ address: V4_QUOTER, abi: v4Quoter, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: pairIn, hookData: "0x" }] }).catch(() => null);
  if (!q4 || q4.result[0] <= 0n) throw new TradeError("NO_POOL", `The ${symbol} pool did not return a quote`);
  const out = q4.result[0];
  const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const keyTuple = { type: "tuple", components: [{ type: "address", name: "currency0" }, { type: "address", name: "currency1" }, { type: "uint24", name: "fee" }, { type: "int24", name: "tickSpacing" }, { type: "address", name: "hooks" }] } as const;
  const swapParams = encodeAbiParameters(
    [{ type: "tuple", components: [{ ...keyTuple, name: "poolKey" }, { type: "bool", name: "zeroForOne" }, { type: "uint128", name: "amountIn" }, { type: "uint128", name: "amountOutMinimum" }, { type: "bytes", name: "hookData" }] }],
    [{ poolKey: key, zeroForOne, amountIn: OPEN_DELTA, amountOutMinimum: minOut, hookData: "0x" }]
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [pair, CONTRACT_BALANCE, false]);
  const takeAll = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a.token, minOut]);
  const v4Input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [`0x${ACT.SETTLE}${ACT.SWAP_EXACT_IN_SINGLE}${ACT.TAKE_ALL}`, [settle, swapParams, takeAll]]);

  const commands: string[] = [CMD.WRAP_ETH];
  const inputs: Hex[] = [encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [UNIVERSAL_ROUTER, amountIn])];
  if (path) {
    // El 1 % de holgura del tramo V3 no protege el precio final: eso lo hace minOut en el TAKE_ALL.
    commands.push(CMD.V3_SWAP_EXACT_IN);
    inputs.push(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], [UNIVERSAL_ROUTER, amountIn, (pairIn * 9_900n) / 10_000n, path, false]));
  }
  commands.push(CMD.V4_SWAP); inputs.push(v4Input);
  // Lo que sobre en el router (polvo de WETH o del par) vuelve a quien firma.
  commands.push(CMD.SWEEP); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [WETH, MSG_SENDER, 0n]));
  if (path) { commands.push(CMD.SWEEP); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [pair, MSG_SENDER, 0n])); }
  const data = encodeFunctionData({ abi: routerAbi, functionName: "execute", args: [`0x${commands.join("")}`, inputs, BigInt(deadline)] });

  // La transaccion exacta, simulada desde la wallet de la persona (con saldo de sobra para que un
  // saldo corto no tape un fallo de ruta). Si revierte, no se ofrece nada para firmar.
  try {
    await c.call({ account: a.recipient, to: UNIVERSAL_ROUTER, data, value: amountIn, stateOverride: [{ address: a.recipient, balance: parseEther("10") }] });
  } catch (e) {
    throw new TradeError("NO_POOL", `The buy did not pass simulation: ${((e as Error).message || "reverted").split("\n")[0].slice(0, 160)}`);
  }

  const outHuman = Number(formatUnits(out, decimals));
  const ethHuman = Number(formatUnits(amountIn, 18));
  return {
    id: `draft-${Date.now().toString(36)}`,
    chainId: BASE_CHAIN_ID,
    recipient: a.recipient,
    side: "buy",
    stock: { symbol, ticker: symbol, name, issuer: "Bankr launch", address: a.token, decimals },
    pool: key.hooks,
    fee: 0,
    poolUsdcDepth: 0,
    tokenIn: { address: WETH, symbol: "ETH", decimals: 18 },
    tokenOut: { address: a.token, symbol, decimals },
    amountIn: amountIn.toString(),
    amountInHuman: ethHuman.toFixed(6),
    amountInUsd: Number(usd.toFixed(2)),
    quoteOut: out.toString(),
    quoteOutHuman: outHuman >= 1000 ? Math.round(outHuman).toString() : outHuman.toFixed(4),
    minOut: minOut.toString(),
    slippageBps,
    impliedPriceUsd: outHuman > 0 ? usd / outHuman : 0,
    gasEstimate: q4.result[1].toString(),
    deadline,
    quotedAt: new Date().toISOString(),
    needsApproval: false,
    balanceUsdc: "0",
    balanceToken: "0",
    txs: [{ label: "swap", to: UNIVERSAL_ROUTER, value: `0x${amountIn.toString(16)}`, data }],
    venue: "uniswap",
    venueLabel: "Uniswap V4",
    venues: [],
    bankr: null,
    payWith: { symbol: "ETH", amountHuman: ethHuman.toFixed(6), balanceHuman: Number(formatUnits(ethBal, 18)).toFixed(6), priceUsd: ethUsd },
    route: `${routeLabel} → ${symbol} · one transaction through Uniswap's Universal Router · simulated on Base`
  };
}

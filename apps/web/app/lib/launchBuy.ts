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
const permit2Abi = parseAbi(["function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)", "function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const allowanceAbi = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);
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
const CMD = { V3_SWAP_EXACT_IN: "00", SWEEP: "04", WRAP_ETH: "0b", UNWRAP_WETH: "0c", V4_SWAP: "10" } as const;
const ACT = { SWAP_EXACT_IN_SINGLE: "06", SETTLE: "0b", SETTLE_ALL: "0c", TAKE: "0e", TAKE_ALL: "0f" } as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
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

// La liquidez de cada accion tokenizada vive en un tier distinto (NVDAc en 0.3 %, SPCXc en 1 %) y un
// pool pequeno puede vaciarse con una sola compra. No se asume ninguno: se cotizan todos los tiers,
// directo contra WETH y pasando por USDC, y gana la ruta que mas entrega.
const FEE_TIERS = [100, 500, 3000, 10000] as const;
const tierLabel = (fee: number) => `${fee / 10_000}%`;
async function bestV3Route(c: ReturnType<typeof client>, side: "toPair" | "fromPair", pair: Addr, pairSymbol: string, amountIn: bigint): Promise<{ label: string; path: Hex; out: bigint } | null> {
  const routes: Array<{ label: string; path: Hex }> = [];
  for (const fee of FEE_TIERS) {
    if (side === "toPair") {
      routes.push({ label: `ETH → ${pairSymbol} (${tierLabel(fee)})`, path: v3Path([WETH, fee, pair]) });
      routes.push({ label: `ETH → USDC → ${pairSymbol} (${tierLabel(fee)})`, path: v3Path([WETH, 500, USDC, fee, pair]) });
    } else {
      routes.push({ label: `${pairSymbol} → ETH (${tierLabel(fee)})`, path: v3Path([pair, fee, WETH]) });
      routes.push({ label: `${pairSymbol} → USDC → ETH (${tierLabel(fee)})`, path: v3Path([pair, fee, USDC, 500, WETH]) });
    }
  }
  const quoted = (await Promise.all(routes.map(async (r) => {
    try { const q = await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInput", args: [r.path, amountIn] }); return { ...r, out: q.result[0] }; } catch { return null; }
  }))).filter((x): x is { label: string; path: Hex; out: bigint } => Boolean(x && x.out > 0n));
  if (!quoted.length) return null;
  quoted.sort((x, y) => (y.out > x.out ? 1 : y.out < x.out ? -1 : 0));
  return quoted[0];
}

/** Impacto de precio de toda la ruta: se cotiza una vigesima parte y se compara. Un pool casi vacio
    entrega una fraccion de lo justo aunque la cotizacion "funcione": por encima del tope no hay draft. */
const MAX_IMPACT = 0.12;
const impactOf = (outFull: bigint, outSmall: bigint, parts: bigint) => (outSmall > 0n ? Math.max(0, 1 - Number(outFull) / Number(outSmall * parts)) : 1);

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
    const best = await bestV3Route(c, "toPair", pair, pairSymbol, amountIn);
    if (!best) throw new TradeError("NO_POOL", `No Uniswap V3 route from ETH to ${pairSymbol} on Base`);
    pairIn = best.out; path = best.path; routeLabel = best.label;
  }

  // Tramo V4 contra el pool del launch (hook de Doppler, fee dinamico).
  const q4 = await c.simulateContract({ address: V4_QUOTER, abi: v4Quoter, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: pairIn, hookData: "0x" }] }).catch(() => null);
  if (!q4 || q4.result[0] <= 0n) throw new TradeError("NO_POOL", `The ${symbol} pool did not return a quote`);
  const out = q4.result[0];
  // La misma ruta con una vigesima parte del monto: si el monto completo rinde mucho menos, el camino es demasiado fino.
  const smallIn = amountIn / 20n;
  const smallPair = path ? await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInput", args: [path, smallIn] }).then((r) => r.result[0]).catch(() => 0n) : smallIn;
  const smallOut = smallPair > 0n ? await c.simulateContract({ address: V4_QUOTER, abi: v4Quoter, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: smallPair, hookData: "0x" }] }).then((r) => r.result[0]).catch(() => 0n) : 0n;
  const impact = impactOf(out, smallOut, 20n);
  if (impact > MAX_IMPACT) throw new TradeError("THIN_POOL", `This buy would move the price about ${Math.round(impact * 100)}%: the route to ${pairSymbol} is too thin for $${usd}. Try a smaller amount.`);
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
  // Tambien el USDC intermedio: si un pool se queda sin liquidez a mitad del swap, el salto consume
  // solo una parte y el resto queda en el router, donde cualquiera puede llevarselo. Paso una vez.
  if (path) { commands.push(CMD.SWEEP); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [USDC, MSG_SENDER, 0n])); }
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
    route: `${routeLabel} → ${symbol} · price impact about ${(impact * 100).toFixed(1)}% · one transaction through Uniswap's Universal Router · simulated on Base`
  };
}

export type LaunchSellArgs = { recipient: Addr; token: Addr; deployTx: Hex; fraction?: number; amountToken?: number; slippageBps?: number };

/** Draft de venta a ETH: token -> par (V4) -> WETH (V3) -> ETH a la wallet. Vender un ERC-20 pide permiso:
    approve del token a Permit2 (una vez por token) y permiso de Permit2 al router por el monto exacto
    y 30 minutos. La llamada final se simula en el cliente justo antes de firmarla. */
export async function draftLaunchSell(a: LaunchSellArgs): Promise<TradeDraft> {
  const slippageBps = a.slippageBps ?? 300;
  const c = client();
  const key = await poolKeyFromDeploy(a.deployTx, a.token);
  const pair = (key.currency0.toLowerCase() === a.token.toLowerCase() ? key.currency1 : key.currency0) as Addr;
  const zeroForOne = key.currency0.toLowerCase() === a.token.toLowerCase(); // entra el token, sale el par
  const isWeth = pair.toLowerCase() === WETH.toLowerCase();
  const [symbol, name, decimals, pairSymbol, bal, ethBal, tokenAllowance, p2] = await Promise.all([
    c.readContract({ address: a.token, abi: erc20, functionName: "symbol" }),
    c.readContract({ address: a.token, abi: erc20, functionName: "name" }),
    c.readContract({ address: a.token, abi: erc20, functionName: "decimals" }),
    isWeth ? Promise.resolve("WETH") : c.readContract({ address: pair, abi: erc20, functionName: "symbol" }),
    c.readContract({ address: a.token, abi: erc20, functionName: "balanceOf", args: [a.recipient] }),
    c.getBalance({ address: a.recipient }),
    c.readContract({ address: a.token, abi: allowanceAbi, functionName: "allowance", args: [a.recipient, PERMIT2] }),
    c.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [a.recipient, a.token, UNIVERSAL_ROUTER] })
  ]);
  if (bal <= 0n) throw new TradeError("NO_BALANCE", `You hold no ${symbol} on Base`);
  let amountIn: bigint;
  if (a.amountToken !== undefined) amountIn = BigInt(Math.round(Number(a.amountToken) * 1e6)) * 10n ** BigInt(decimals) / 1_000_000n;
  else { const f = Math.min(1, Math.max(0, Number(a.fraction ?? 1))); amountIn = f >= 1 ? bal : (bal * BigInt(Math.round(f * 10_000))) / 10_000n; }
  if (amountIn <= 0n) throw new TradeError("AMOUNT", "Nothing to sell");
  if (amountIn > bal) throw new TradeError("NO_BALANCE", `You hold ${formatUnits(bal, decimals)} ${symbol}; the draft needs ${formatUnits(amountIn, decimals)}`);
  if (amountIn >= 1n << 160n) throw new TradeError("AMOUNT", "Amount too large for one draft");

  // Tramo V4: token -> par.
  const q4 = await c.simulateContract({ address: V4_QUOTER, abi: v4Quoter, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }] }).catch(() => null);
  if (!q4 || q4.result[0] <= 0n) throw new TradeError("NO_POOL", `The ${symbol} pool did not return a quote`);
  const pairOut = q4.result[0];
  // Tramo V3: par -> WETH, la ruta que mas entregue.
  let ethOut = pairOut, path: Hex | null = null, routeLabel = "ETH";
  if (!isWeth) {
    const best = await bestV3Route(c, "fromPair", pair, pairSymbol, pairOut);
    if (!best) throw new TradeError("NO_POOL", `No Uniswap V3 route from ${pairSymbol} to ETH on Base`);
    ethOut = best.out; path = best.path; routeLabel = best.label;
  }
  const smallTok = amountIn / 20n;
  const smallPairOut = smallTok > 0n ? await c.simulateContract({ address: V4_QUOTER, abi: v4Quoter, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: smallTok, hookData: "0x" }] }).then((r) => r.result[0]).catch(() => 0n) : 0n;
  const smallEth = path && smallPairOut > 0n ? await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInput", args: [path, smallPairOut] }).then((r) => r.result[0]).catch(() => 0n) : smallPairOut;
  const impact = impactOf(ethOut, smallEth, 20n);
  if (impact > MAX_IMPACT) throw new TradeError("THIN_POOL", `This sale would move the price about ${Math.round(impact * 100)}%: the route is too thin for that amount. Try a smaller share.`);
  const minEth = (ethOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const oneEth = await c.simulateContract({ address: QUOTER_V2, abi: quoterV2, functionName: "quoteExactInputSingle", args: [{ tokenIn: WETH, tokenOut: USDC, amountIn: parseEther("1"), fee: 500, sqrtPriceLimitX96: 0n }] });
  const ethUsd = Number(formatUnits(oneEth.result[0], USDC_DECIMALS));
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const keyTuple = { type: "tuple", components: [{ type: "address", name: "currency0" }, { type: "address", name: "currency1" }, { type: "uint24", name: "fee" }, { type: "int24", name: "tickSpacing" }, { type: "address", name: "hooks" }] } as const;
  const swapParams = encodeAbiParameters(
    [{ type: "tuple", components: [{ ...keyTuple, name: "poolKey" }, { type: "bool", name: "zeroForOne" }, { type: "uint128", name: "amountIn" }, { type: "uint128", name: "amountOutMinimum" }, { type: "bytes", name: "hookData" }] }],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: (pairOut * BigInt(10_000 - slippageBps)) / 10_000n, hookData: "0x" }]
  );
  const settleAll = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a.token, amountIn]);          // paga quien firma, via Permit2
  const take = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [pair, UNIVERSAL_ROUTER, OPEN_DELTA]); // el par queda en el router
  const v4Input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [`0x${ACT.SWAP_EXACT_IN_SINGLE}${ACT.SETTLE_ALL}${ACT.TAKE}`, [swapParams, settleAll, take]]);
  const commands: string[] = [CMD.V4_SWAP];
  const inputs: Hex[] = [v4Input];
  if (path) { commands.push(CMD.V3_SWAP_EXACT_IN); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], [UNIVERSAL_ROUTER, CONTRACT_BALANCE, 0n, path, false])); }
  commands.push(CMD.UNWRAP_WETH); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [MSG_SENDER, minEth])); // el minimo en ETH protege toda la ruta
  if (path) { commands.push(CMD.SWEEP); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [pair, MSG_SENDER, 0n])); }
  if (path) { commands.push(CMD.SWEEP); inputs.push(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [USDC, MSG_SENDER, 0n])); } // nada se queda en el router
  const data = encodeFunctionData({ abi: routerAbi, functionName: "execute", args: [`0x${commands.join("")}`, inputs, BigInt(deadline)] });

  const txs: TradeDraft["txs"] = [];
  const needsToken = tokenAllowance < amountIn;
  const now = Math.floor(Date.now() / 1000);
  const needsPermit = p2[0] < amountIn || Number(p2[1]) < now + 10 * 60;
  if (needsToken) txs.push({ label: "approve", to: a.token, value: "0x0", data: encodeFunctionData({ abi: allowanceAbi, functionName: "approve", args: [PERMIT2, (1n << 256n) - 1n] }) });
  if (needsPermit) txs.push({ label: "permit", to: PERMIT2, value: "0x0", data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [a.token, UNIVERSAL_ROUTER, amountIn, now + 30 * 60] }) });
  txs.push({ label: "swap", to: UNIVERSAL_ROUTER, value: "0x0", data, simulate: true });

  const inHuman = Number(formatUnits(amountIn, decimals));
  const ethHuman = Number(formatUnits(ethOut, 18));
  const usd = ethHuman * ethUsd;
  return {
    id: `draft-${Date.now().toString(36)}`,
    chainId: BASE_CHAIN_ID,
    recipient: a.recipient,
    side: "sell",
    stock: { symbol, ticker: symbol, name, issuer: "Bankr launch", address: a.token, decimals },
    pool: key.hooks, fee: 0, poolUsdcDepth: 0,
    tokenIn: { address: a.token, symbol, decimals },
    tokenOut: { address: WETH, symbol: "ETH", decimals: 18 },
    amountIn: amountIn.toString(),
    amountInHuman: inHuman >= 1000 ? Math.round(inHuman).toString() : inHuman.toFixed(4),
    amountInUsd: Number(usd.toFixed(2)),
    quoteOut: ethOut.toString(),
    quoteOutHuman: ethHuman.toFixed(6),
    minOut: minEth.toString(),
    slippageBps,
    impliedPriceUsd: inHuman > 0 ? usd / inHuman : 0,
    gasEstimate: q4.result[1].toString(),
    deadline,
    quotedAt: new Date().toISOString(),
    needsApproval: needsToken || needsPermit,
    balanceUsdc: "0",
    balanceToken: formatUnits(bal, decimals),
    txs,
    venue: "uniswap", venueLabel: "Uniswap V4", venues: [], bankr: null,
    receive: { symbol: "ETH", amountHuman: ethHuman.toFixed(6), minHuman: Number(formatUnits(minEth, 18)).toFixed(6), usd: Number(usd.toFixed(2)) },
    route: `${symbol} → ${isWeth ? "" : `${routeLabel.replace(" → ETH", "")} → `}ETH · price impact about ${(impact * 100).toFixed(1)}% · through Uniswap's Universal Router · wallet ETH ${Number(formatUnits(ethBal, 18)).toFixed(4)} for gas`
  };
}

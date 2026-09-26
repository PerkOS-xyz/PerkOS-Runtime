/**
 * Token launches on Robinhood Chain through Bankr's Token Launch API.
 *
 * A launch is a new ERC-20 whose Uniswap v4 pool is quoted in a tokenized
 * stock (or WETH), deployed by Doppler from the person's Bankr wallet. That
 * wallet signs and pays the gas: Bankr does not sponsor gas for launches on
 * Robinhood Chain. The person signs nothing on chain here.
 *
 * Reads that need no key: the pairs Bankr offers on Robinhood Chain, its
 * recent launches, one launch's record, a beneficiary's creator fees and the
 * wallet's ETH on the chain. A simulation or a deploy needs the key.
 */

import { hexToBigInt } from "viem";

import { bankrCall, defaultHttp, type BankrAnswer, type Http } from "./bankr";

export const LAUNCH_CHAIN = "robinhood";
export const LAUNCH_CHAIN_ID = 4663;
export const LAUNCH_PROVIDER = "doppler";
const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Bankr's rules for a launch wallet, as its docs state them. */
export const BANKR_LIMITS = {
  /** Counted launch attempts per Bankr wallet in any 24 hours. */
  launchesPerDay: 3,
  /** Simulations per Bankr wallet in any 24 hours. */
  simulationsPerDay: 20,
  /** Roughly, successful launches from one network (IP address) in 24 hours. */
  launchesPerNetworkPerDay: 10,
} as const;

/** Gas a Doppler launch used on Robinhood Chain (about 2.5 M), and the budget the balance check asks for. */
export const LAUNCH_GAS_USED = 2_500_000n;
export const LAUNCH_GAS_BUDGET = 6_000_000n;
/** What the check asks for when the chain's gas price cannot be read. */
export const FALLBACK_GAS_WEI = 300_000_000_000_000n;

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DAY_MS = 24 * 60 * 60_000;

export interface LaunchPair {
  address: string;
  symbol: string;
  name: string;
  /** "stock", "major" (WETH) or "project" (BNKR, musebook). */
  kind: string;
  /** The deploy field that selects this pair; null for WETH, the default. */
  deployField: "pairedStockAddress" | "pairedTokenAddress" | null;
  /** Bankr's advisory verdict on a stock's own pool: true when it is thin right now, null when not measured. */
  illiquid: boolean | null;
  /** False for a quote token Bankr has not cleared yet. */
  ready: boolean;
}

/** A launch as Bankr lists it. Addresses lowercase. */
export interface LaunchRecord {
  tokenAddress: string;
  name: string;
  symbol: string;
  chain: string;
  poolId: string | null;
  txHash: string | null;
  deployedAt: string | null;
  pair: { address: string; symbol: string } | null;
  deployer: string | null;
  feeRecipient: string | null;
  /** Bankr's estimate of the fees waiting to be claimed, in USD. */
  unclaimedUsd: number | null;
}

/** Creator fees on one token for one beneficiary, in token units as Bankr gives them. */
export interface FeeToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  chain: string;
  poolId: string | null;
  token0Label: string;
  token1Label: string;
  claimable: { token0: string; token1: string };
  claimed: { token0: string; token1: string; count: number };
}

export interface ChainGas {
  /** The wallet's ETH on Robinhood Chain; null when the chain did not answer. */
  balanceWei: bigint | null;
  gasPriceWei: bigint | null;
}

export interface LaunchParams {
  name: string;
  symbol: string;
  pair: LaunchPair;
  /** Gets the creator's 95% of the pool fee, and the vested supply when vesting is on. */
  feeRecipient: string;
  description?: string;
  image?: string;
  /** Bankr's default: 15% of supply to the fee recipient over a year, 30-day cliff. Off puts all of it in the pool. */
  vesting: boolean;
  /** All creator fees in the pair token instead of a mix of both. */
  quoteOnlyFees: boolean;
}

export interface LaunchPreview {
  tokenAddress: string;
  poolId: string;
  /** Who the creator share resolved to, and its share of the pool fee in basis points. */
  creator: { address: string; bps: number } | null;
  protocolBps: number | null;
}

export interface LaunchDeployed extends LaunchPreview {
  txHash: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lower = (v: unknown): string | null => {
  const s = str(v);
  return ADDRESS.test(s) ? s.toLowerCase() : null;
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(v)) return v;
  for (const k of keys) if (Array.isArray(obj(v)[k])) return obj(v)[k] as unknown[];
  return [];
};

// Caches on globalThis: every route and a reload of the dev server share them.
interface Caches {
  pairs: { at: number; pairs: LaunchPair[] } | null;
  recent: { at: number; launches: LaunchRecord[] } | null;
  records: Map<string, { at: number; record: LaunchRecord }>;
  fees: Map<string, { at: number; tokens: FeeToken[] }>;
}
const CACHES = Symbol.for("perkos.runtime.bankrLaunch");
function caches(): Caches {
  const g = globalThis as unknown as Record<symbol, Caches | undefined>;
  let c = g[CACHES];
  if (!c) {
    c = { pairs: null, recent: null, records: new Map(), fees: new Map() };
    g[CACHES] = c;
  }
  return c;
}
/** Forgets every cached read. */
export function resetBankrCaches(): void {
  const c = caches();
  c.pairs = null;
  c.recent = null;
  c.records.clear();
  c.fees.clear();
}

const PAIRS_MS = 10 * 60_000;
const RECENT_MS = 30_000;
const RECORD_MS = 2 * 60_000;
const FEES_MS = 2 * 60_000;

const KIND_ORDER: Record<string, number> = { stock: 0, major: 1, project: 2 };

/** Bankr's pairs, cleaned: stocks first, in Bankr's order, then WETH, then the other quote tokens. */
export function parsePairs(json: unknown): LaunchPair[] {
  const out: LaunchPair[] = [];
  for (const raw of list(json, ["quoteTokens", "tokens", "data"])) {
    const t = obj(raw);
    const address = str(t.address);
    const symbol = str(t.symbol);
    const field = t.deployField ?? null;
    if (!ADDRESS.test(address) || !symbol || symbol.length > 24) continue;
    // A pick another provider selects is not one a Doppler launch can take.
    if (field !== null && field !== "pairedStockAddress" && field !== "pairedTokenAddress") continue;
    out.push({
      address,
      symbol,
      name: str(t.name) || symbol,
      kind: str(t.kind) || "stock",
      deployField: field,
      illiquid: typeof t.illiquid === "boolean" ? t.illiquid : null,
      ready: t.readiness === undefined || t.readiness === null || t.readiness === "live",
    });
  }
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (KIND_ORDER[a.p.kind] ?? 3) - (KIND_ORDER[b.p.kind] ?? 3) || a.i - b.i)
    .map(({ p }) => p);
}

/** What a launch on Robinhood Chain can pair with. Cached ten minutes; `fresh` asks Bankr again. */
export async function launchPairs(options: { fresh?: boolean; http?: Http; now?: number } = {}): Promise<LaunchPair[]> {
  const now = options.now ?? Date.now();
  const c = caches();
  if (!options.fresh && c.pairs && now - c.pairs.at < PAIRS_MS) return c.pairs.pairs;
  const r = await bankrCall(`/token-launches/quote-tokens?chain=${LAUNCH_CHAIN}`, { http: options.http ?? defaultHttp });
  if (!r.ok) throw new Error(r.message);
  const pairs = parsePairs(r.data);
  if (!pairs.length) throw new Error("Bankr listed no pairs on Robinhood Chain.");
  c.pairs = { at: now, pairs };
  return pairs;
}

const ETH_WORDS = new Set(["eth", "weth", "ether", "ethereum"]);

/** "NVDA", "$nvda", "nvidia", "WETH", "eth", "BNKR" or an address: the pair it names, or null. */
export function resolvePair(query: string, pairs: LaunchPair[]): LaunchPair | null {
  const raw = query.trim().replace(/^\$/, "").toLowerCase();
  if (!raw) return null;
  if (ADDRESS.test(raw)) return pairs.find((p) => p.address.toLowerCase() === raw) ?? null;
  if (ETH_WORDS.has(raw)) return pairs.find((p) => p.symbol.toLowerCase() === "weth") ?? null;
  return (
    pairs.find((p) => p.symbol.toLowerCase() === raw) ??
    pairs.find((p) => p.name.toLowerCase() === raw) ??
    (raw.length >= 3 ? pairs.find((p) => p.kind === "stock" && p.name.toLowerCase().startsWith(raw)) : undefined) ??
    null
  );
}

/** One launch as Bankr lists it, or null when it is not a launch this app can draw. */
export function parseLaunch(raw: unknown): LaunchRecord | null {
  const l = obj(raw);
  const tokenAddress = lower(l.tokenAddress);
  if (!tokenAddress) return null;
  const pairRaw = obj(l.pairedStock ?? l.pairedToken);
  const pairAddress = lower(pairRaw.address);
  const ts = typeof l.timestamp === "number" && Number.isFinite(l.timestamp) ? l.timestamp : null;
  const usd = obj(l.unclaimedFees).usdValue;
  const poolId = str(l.poolId);
  const txHash = str(l.txHash);
  return {
    tokenAddress,
    name: str(l.tokenName) || str(l.tokenSymbol) || "Token",
    symbol: str(l.tokenSymbol) || "?",
    chain: str(l.chain),
    poolId: HASH.test(poolId) ? poolId : null,
    txHash: HASH.test(txHash) ? txHash : null,
    deployedAt: ts === null ? null : new Date(ts).toISOString(),
    pair: pairAddress ? { address: pairAddress, symbol: str(pairRaw.symbol) || "?" } : null,
    deployer: lower(obj(l.deployer).walletAddress),
    feeRecipient: lower(obj(l.feeRecipient).walletAddress),
    unclaimedUsd: typeof usd === "number" && Number.isFinite(usd) && usd >= 0 ? usd : null,
  };
}

/** Bankr's 50 most recent launches on every chain. Cached half a minute; an empty list when Bankr does not answer. */
export async function recentLaunches(options: { http?: Http; now?: number } = {}): Promise<LaunchRecord[]> {
  const now = options.now ?? Date.now();
  const c = caches();
  if (c.recent && now - c.recent.at < RECENT_MS) return c.recent.launches;
  const r = await bankrCall("/token-launches", { http: options.http ?? defaultHttp });
  if (!r.ok) return c.recent?.launches ?? [];
  const launches = list(r.data, ["launches", "data", "tokenLaunches"])
    .map(parseLaunch)
    .filter((l): l is LaunchRecord => l !== null);
  c.recent = { at: now, launches };
  return launches;
}

/** One launch's record by its token address, or null. Cached two minutes. */
export async function launchRecord(token: string, options: { http?: Http; now?: number } = {}): Promise<LaunchRecord | null> {
  const address = lower(token);
  if (!address) return null;
  const now = options.now ?? Date.now();
  const c = caches();
  const hit = c.records.get(address);
  if (hit && now - hit.at < RECORD_MS) return hit.record;
  const r = await bankrCall(`/token-launches/${address}`, { http: options.http ?? defaultHttp });
  if (!r.ok) return hit?.record ?? null;
  const record = parseLaunch(obj(r.data).launch ?? r.data);
  if (record) c.records.set(address, { at: now, record });
  return record;
}

/** Launches by a wallet in the last 24 hours, on any chain: Bankr's limit counts them all. */
export const launchedWithinDay = (launches: LaunchRecord[], deployer: string, now = Date.now()): LaunchRecord[] =>
  launches.filter((l) => l.deployer === deployer.toLowerCase() && l.deployedAt !== null && now - Date.parse(l.deployedAt) < DAY_MS);

function parseFeeToken(raw: unknown): FeeToken | null {
  const t = obj(raw);
  const tokenAddress = lower(t.tokenAddress);
  if (!tokenAddress) return null;
  const claimable = obj(t.claimable);
  const claimed = obj(t.claimed);
  const poolId = str(t.poolId);
  return {
    tokenAddress,
    name: str(t.name) || str(t.symbol) || "Token",
    symbol: str(t.symbol) || "?",
    chain: str(t.chain),
    poolId: HASH.test(poolId) ? poolId : null,
    token0Label: str(t.token0Label),
    token1Label: str(t.token1Label),
    claimable: { token0: str(claimable.token0) || "0", token1: str(claimable.token1) || "0" },
    claimed: { token0: str(claimed.token0) || "0", token1: str(claimed.token1) || "0", count: Number(claimed.count) || 0 },
  };
}

/** Every token where `wallet` earns the creator fee. Public; cached two minutes; empty when Bankr does not answer. */
export async function creatorFees(wallet: string, options: { http?: Http; now?: number } = {}): Promise<FeeToken[]> {
  const address = lower(wallet);
  if (!address) return [];
  const now = options.now ?? Date.now();
  const c = caches();
  const hit = c.fees.get(address);
  if (hit && now - hit.at < FEES_MS) return hit.tokens;
  const r = await bankrCall(`/public/doppler/creator-fees/${address}?days=30`, { http: options.http ?? defaultHttp, timeoutMs: 20_000 });
  if (!r.ok) return hit?.tokens ?? [];
  const tokens = list(r.data, ["tokens"])
    .map(parseFeeToken)
    .filter((t): t is FeeToken => t !== null);
  c.fees.set(address, { at: now, tokens });
  return tokens;
}

async function rpc(method: string, params: unknown[], http: Http): Promise<bigint | null> {
  try {
    const res = await http(process.env.ROBINHOOD_RPC_URL?.trim() || DEFAULT_RPC, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    const result = obj(await res.json()).result;
    return typeof result === "string" && /^0x[0-9a-fA-F]+$/.test(result) ? hexToBigInt(result as `0x${string}`) : null;
  } catch {
    return null;
  }
}

/** A wallet's ETH on Robinhood Chain and the chain's gas price, straight from the chain. */
export async function chainGas(address: string, http: Http = defaultHttp): Promise<ChainGas> {
  const [balanceWei, gasPriceWei] = await Promise.all([rpc("eth_getBalance", [address, "latest"], http), rpc("eth_gasPrice", [], http)]);
  return { balanceWei, gasPriceWei };
}

/** What a launch should find in the wallet for gas, and what it costs at today's price. */
export function gasNeed(gasPriceWei: bigint | null): { needWei: bigint; aboutWei: bigint | null } {
  if (gasPriceWei === null || gasPriceWei <= 0n) return { needWei: FALLBACK_GAS_WEI, aboutWei: null };
  return { needWei: gasPriceWei * LAUNCH_GAS_BUDGET, aboutWei: gasPriceWei * LAUNCH_GAS_USED };
}

/** The request body Bankr gets, for a simulation or the real launch. The same body both times. */
export function deployBody(p: LaunchParams, simulateOnly: boolean): Record<string, unknown> {
  return {
    tokenName: p.name,
    tokenSymbol: p.symbol,
    ...(p.description ? { description: p.description } : {}),
    ...(p.image ? { image: p.image } : {}),
    chain: LAUNCH_CHAIN,
    provider: LAUNCH_PROVIDER,
    ...(p.pair.deployField ? { [p.pair.deployField]: p.pair.address } : {}),
    feeRecipient: { type: "wallet", value: p.feeRecipient },
    ...(p.vesting ? {} : { disableVesting: true }),
    ...(p.quoteOnlyFees ? { quoteOnlyFees: true } : {}),
    simulateOnly,
  };
}

function parseDeployed(data: unknown): LaunchDeployed | null {
  const d = obj(data);
  const tokenAddress = lower(d.tokenAddress);
  const poolId = str(d.poolId);
  if (!tokenAddress) return null;
  const fees = obj(d.feeDistribution);
  const creator = obj(fees.creator);
  const creatorAddress = lower(creator.address);
  const protocolBps = Number(obj(fees.protocol).bps);
  const txHash = str(d.txHash);
  return {
    tokenAddress,
    poolId,
    creator: creatorAddress && Number.isFinite(Number(creator.bps)) ? { address: creatorAddress, bps: Number(creator.bps) } : null,
    protocolBps: Number.isFinite(protocolBps) ? protocolBps : null,
    txHash: HASH.test(txHash) ? txHash : null,
  };
}

const NO_TOKEN = { ok: false as const, status: 502, code: "BANKR_ANSWER", message: "Bankr answered without a token address." };

/** Bankr predicts the token and its pool without sending anything or using a launch. It counts toward the 20 a day. */
export async function simulateLaunch(key: string, p: LaunchParams, http: Http = defaultHttp): Promise<BankrAnswer<LaunchPreview>> {
  const r = await bankrCall("/token-launches/deploy", { key, method: "POST", body: deployBody(p, true), timeoutMs: 45_000, http });
  if (!r.ok) return r;
  const d = parseDeployed(r.data);
  if (!d) return NO_TOKEN;
  return { ok: true, status: r.status, data: { tokenAddress: d.tokenAddress, poolId: d.poolId, creator: d.creator, protocolBps: d.protocolBps } };
}

/** The real launch. An answer that is not a clear yes or no may still have reached the chain. */
export async function deployLaunch(key: string, p: LaunchParams, http: Http = defaultHttp): Promise<BankrAnswer<LaunchDeployed>> {
  const r = await bankrCall("/token-launches/deploy", { key, method: "POST", body: deployBody(p, false), timeoutMs: 150_000, http });
  if (!r.ok) return r;
  const deployed = parseDeployed(r.data);
  return deployed ? { ok: true, status: r.status, data: deployed } : NO_TOKEN;
}

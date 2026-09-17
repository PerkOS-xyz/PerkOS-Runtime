import { DiskCache } from "./diskCache";

// Bankr token launches ("Stock Paired Token"): un ERC-20 nuevo via Doppler
// sobre un pool Uniswap V4 cuyo quote token es una accion tokenizada (B20 en
// Base). Ejecuta desde la wallet Bankr de la persona (key con Token Launch
// API + read-write); el fee recipient es la wallet Privy de la persona, y
// nada se despliega sin Hold to launch. Docs: docs.bankr.bot/token-launching.
const BASE = "https://api.bankr.bot";
const CHAIN = "base";
const key = () => { const k = process.env.BANKR_API_KEY?.trim(); return k && k.startsWith("bk_") ? k : null; };
const headers = (k: string) => ({ "Content-Type": "application/json", "X-API-Key": k });

export type QuoteToken = { address: string; symbol: string; name: string; kind: string; deployField?: string; provider?: string; illiquid?: boolean };
export type BankrWallet = { evm: string; solana?: string; ethBase: number; usdBase: number; club: boolean; x?: string };
export type LaunchCheck = { label: string; ok: boolean; note: string };
/** A quien pagan las fees (y el vesting): wallet, handle de X, Farcaster o ENS. Bankr lo resuelve al simular. */
export type Recipient = { type: "wallet" | "x" | "farcaster" | "ens"; value: string };
export type LaunchParams = { name: string; symbol: string; pair: QuoteToken; feeRecipient: Recipient; description?: string; image?: string; websiteUrl?: string; tweetUrl?: string; disableVesting?: boolean; quoteOnlyFees?: boolean; degenMode?: boolean };
export type LaunchSim = { tokenAddress: string; poolId: string; feeDistribution?: unknown; creatorAddress?: string };
export type LaunchReceipt = LaunchSim & { txHash: string; chain: string };
export type BankrLaunch = { tokenName: string; tokenSymbol: string; chain: string; tokenAddress: string; poolId?: string; txHash?: string; timestamp?: number; status?: string; imageUri?: string; pairedStock?: { address: string; symbol: string }; deployer?: { walletAddress?: string; xUsername?: string }; feeRecipient?: { walletAddress?: string } };
export type LaunchResult<T> = { ok: true; data: T } | { ok: false; error: string; detail: string };

const quotesCache = new DiskCache<QuoteToken[]>("bankr-launch-quotes", 60 * 60_000);
const walletCache = new DiskCache<BankrWallet>("bankr-wallet", 60_000);

export function bankrLaunchConfigured(): boolean { return key() !== null; }

function asList<T>(j: unknown, keys: string[]): T[] {
  if (Array.isArray(j)) return j as T[];
  const o = (j ?? {}) as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as T[];
  return [];
}

/** Lo emparejable en Base: WETH, tokens fijos y las acciones B20 (kind "stock"). Cache 1 h. */
export async function launchQuotes(): Promise<QuoteToken[]> {
  const k = key(); if (!k) return [];
  const hit = await quotesCache.get(CHAIN); if (hit) return hit;
  const r = await fetch(`${BASE}/token-launches/quote-tokens?chain=${CHAIN}`, { headers: headers(k), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`quote tokens ${r.status}`);
  const list = asList<QuoteToken>(await r.json(), ["quoteTokens", "tokens", "data"]);
  await quotesCache.set(CHAIN, list);
  return list;
}

/** "NVDA", "NVDAc", "nvidia", "WETH", "eth", "BNKR" -> el quote token del registro, o null. */
export async function resolvePair(query: string): Promise<QuoteToken | null> {
  const raw = query.trim().toLowerCase();
  if (!raw) return null;
  const all = await launchQuotes();
  if (raw === "eth" || raw === "weth" || raw === "ether") return all.find((t) => t.symbol.toLowerCase() === "weth") ?? null;
  const exact = all.find((t) => t.symbol.toLowerCase() === raw);
  if (exact) return exact;
  const q = raw.replace(/c$/, "");
  const stocks = all.filter((t) => t.kind === "stock");
  return stocks.find((t) => t.symbol.toLowerCase() === q)
    ?? all.find((t) => t.name.toLowerCase().startsWith(q))
    ?? all.find((t) => t.name.toLowerCase().includes(q))
    ?? null;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** "0x…", "@handle", "name.eth", "farcaster:dwr", "x:handle" -> recipient tipado, o null si no se entiende. */
export function parseRecipient(raw: string): Recipient | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { type: "wallet", value: v };
  const typed = v.match(/^(x|twitter|farcaster|fc|ens|wallet):\s*@?(.+)$/i);
  if (typed) {
    const t = typed[1].toLowerCase(); const val = typed[2].trim();
    if (t === "wallet") return /^0x[0-9a-fA-F]{40}$/.test(val) ? { type: "wallet", value: val } : null;
    if (t === "ens") return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(val) ? { type: "ens", value: val.toLowerCase() } : null;
    if (t === "farcaster" || t === "fc") return /^[a-z0-9][a-z0-9.-]{0,31}$/i.test(val) ? { type: "farcaster", value: val.toLowerCase() } : null;
    return HANDLE.test(val) ? { type: "x", value: val } : null;
  }
  if (/\.eth$/i.test(v)) return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(v) ? { type: "ens", value: v.toLowerCase() } : null;
  if (v.startsWith("@")) return HANDLE.test(v.slice(1)) ? { type: "x", value: v.slice(1) } : null;
  return null;
}
export const recipientLabel = (r: Recipient) => r.type === "wallet" ? `${r.value.slice(0, 6)}…${r.value.slice(-4)}` : r.type === "x" ? `@${r.value} on X` : r.type === "farcaster" ? `${r.value} on Farcaster` : r.value;

export async function bankrWallet(force = false): Promise<BankrWallet | null> {
  const k = key(); if (!k) return null;
  if (!force) { const hit = await walletCache.get("me"); if (hit) return hit; }
  const get = (path: string, ms: number) => fetch(`${BASE}${path}`, { headers: headers(k), signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [me, pf] = (await Promise.all([get("/wallet/me", 15_000), get(`/wallet/portfolio?chain=${CHAIN}`, 20_000)])) as [Record<string, unknown> | null, Record<string, unknown> | null];
  if (!me) return null;
  const wallets = (me.wallets as Array<{ chain: string; address: string }> | undefined) ?? [];
  const evm = wallets.find((w) => w.chain === "evm")?.address ?? (pf?.evmAddress as string | undefined) ?? "";
  if (!evm) return null;
  const base = ((pf?.balances as Record<string, Record<string, string>> | undefined) ?? {})[CHAIN] ?? {};
  const socials = (me.socialAccounts as Array<{ platform: string; username: string }> | undefined) ?? [];
  const w: BankrWallet = {
    evm, solana: wallets.find((x) => x.chain === "solana")?.address,
    ethBase: Number(base.nativeBalance ?? 0) || 0, usdBase: Number(base.total ?? 0) || 0,
    club: Boolean((me.bankrClub as { active?: boolean } | undefined)?.active),
    x: socials.find((s) => s.platform === "twitter")?.username
  };
  await walletCache.set("me", w);
  return w;
}

/** Launches publicos de esta wallet; los de las ultimas 24 h cuentan contra el cupo de 3. */
export async function myLaunches(evm: string): Promise<{ all: BankrLaunch[]; last24h: number }> {
  const r = await fetch(`${BASE}/token-launches`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return { all: [], last24h: 0 };
  const list = asList<BankrLaunch>(await r.json(), ["launches", "data", "tokenLaunches"]);
  const mine = list.filter((l) => (l.deployer?.walletAddress ?? "").toLowerCase() === evm.toLowerCase());
  const last24h = mine.filter((l) => (l.timestamp ?? 0) > Date.now() - 24 * 3600_000).length;
  return { all: mine, last24h };
}

/** Los launches publicos que tocan a la persona: donde su wallet cobra las fees, o los que desplego la wallet Bankr del install. */
export async function walletLaunches(wallet: string, deployer?: string | null): Promise<BankrLaunch[]> {
  const r = await fetch(`${BASE}/token-launches`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return [];
  const list = asList<BankrLaunch>(await r.json(), ["launches", "data", "tokenLaunches"]);
  const w = wallet.toLowerCase(); const d = (deployer ?? "").toLowerCase();
  return list.filter((l) => (l.feeRecipient?.walletAddress ?? "").toLowerCase() === w || (d && (l.deployer?.walletAddress ?? "").toLowerCase() === d));
}

/** Las reglas de Bankr que Risk mira antes de un GO (docs 2026-09-16). */
export function launchChecks(w: BankrWallet | null, last24h: number, name: string, symbol: string, pair: QuoteToken | null, recipient?: Recipient | null): LaunchCheck[] {
  return [
    { label: "Fees pay to", ok: Boolean(recipient), note: recipient ? `${recipientLabel(recipient)}${recipient.type === "wallet" ? "" : " · Bankr resolves it to their wallet"}` : "no recipient" },
    { label: "Bankr wallet", ok: Boolean(w), note: w ? `${w.evm.slice(0, 6)}…${w.evm.slice(-4)}${w.club ? " · Bankr Club" : ""}` : "no Bankr key or wallet on this install" },
    { label: "ETH on Base", ok: (w?.ethBase ?? 0) >= 0.002, note: `${(w?.ethBase ?? 0).toFixed(4)} ETH · Bankr asks for 0.002 even with sponsored gas` },
    { label: "Launch quota", ok: last24h < 3, note: `${last24h} of 3 launches used in the last 24 h` },
    { label: "Pair", ok: Boolean(pair && !pair.illiquid), note: pair ? `${pair.symbol} · ${pair.name}${pair.kind === "stock" ? " · tokenized stock" : pair.kind === "major" ? " · the default quote" : ""}${pair.illiquid ? " · illiquid, hard to trade until liquidity arrives" : ""}` : "not in Bankr's registry on Base" },
    { label: "Name and symbol", ok: name.length >= 1 && name.length <= 100 && /^[A-Z0-9]{1,20}$/i.test(symbol), note: `${name} · ${symbol}` }
  ];
}

async function deployCall(p: LaunchParams, simulateOnly: boolean): Promise<LaunchResult<Record<string, unknown>>> {
  const k = key(); if (!k) return { ok: false, error: "bankr_key", detail: "No Bankr key on this install" };
  // El campo del par lo dicta el registro (pairedStockAddress, pairedTokenAddress); WETH no lleva ninguno.
  const pairField = p.pair.deployField === "pairedStockAddress" || p.pair.deployField === "pairedTokenAddress" ? { [p.pair.deployField]: p.pair.address } : {};
  const body = {
    tokenName: p.name, tokenSymbol: p.symbol, description: p.description, image: p.image, websiteUrl: p.websiteUrl, tweetUrl: p.tweetUrl,
    chain: CHAIN, provider: "doppler", ...pairField,
    feeRecipient: { type: p.feeRecipient.type, value: p.feeRecipient.value },
    disableVesting: p.disableVesting === true, quoteOnlyFees: p.quoteOnlyFees === true, degenMode: p.degenMode === true, simulateOnly
  };
  const r = await fetch(`${BASE}/token-launches/deploy`, { method: "POST", headers: headers(k), body: JSON.stringify(body), signal: AbortSignal.timeout(simulateOnly ? 30_000 : 120_000) })
    .catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as unknown as globalThis.Response);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.success === false) return { ok: false, error: String(j.error ?? `bankr_${r.status}`), detail: String(j.message ?? j.detail ?? j.error ?? r.status) };
  return { ok: true, data: j };
}

export async function simulateLaunch(p: LaunchParams): Promise<LaunchResult<LaunchSim>> {
  const r = await deployCall(p, true);
  if (!r.ok) return r;
  const creator = ((r.data.feeDistribution as { creator?: { address?: string } } | undefined)?.creator?.address) ?? undefined;
  return { ok: true, data: { tokenAddress: String(r.data.tokenAddress ?? ""), poolId: String(r.data.poolId ?? ""), feeDistribution: r.data.feeDistribution, creatorAddress: creator } };
}

export async function deployLaunch(p: LaunchParams): Promise<LaunchResult<LaunchReceipt>> {
  const r = await deployCall(p, false);
  if (!r.ok) return r;
  await bankrWallet(true).catch(() => null);
  const creator = ((r.data.feeDistribution as { creator?: { address?: string } } | undefined)?.creator?.address) ?? undefined;
  return { ok: true, data: { tokenAddress: String(r.data.tokenAddress ?? ""), poolId: String(r.data.poolId ?? ""), txHash: String(r.data.txHash ?? ""), chain: String(r.data.chain ?? CHAIN), feeDistribution: r.data.feeDistribution, creatorAddress: creator } };
}

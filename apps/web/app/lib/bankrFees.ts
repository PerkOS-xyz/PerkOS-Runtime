// Fees del creador en launches de Bankr (Doppler): lectura publica y
// construccion de la tx de claim, sin API key. Solo el beneficiario actual
// puede reclamar: la wallet conectada en Floor firma la tx y paga el gas en
// Base. Docs: docs.bankr.bot/token-launching/reading-fees y claiming-fees.
const BASE = "https://api.bankr.bot";

export type FeeToken = {
  tokenAddress: string; name: string; symbol: string; poolId: string; initializer: string; share: string;
  token0Label: string; token1Label: string;
  claimable: { token0: string; token1: string }; claimed: { token0: string; token1: string; count: number };
  source: string;
};
export type CreatorFees = { address: string; chain: string; tokens: FeeToken[]; dailyEarnings: Array<{ date: string; weth: string }>; lifetimeEarnedWeth: string; totals: { claimableWeth: string; claimedWeth: string; claimCount: number } };
export type ClaimTx = { tokenAddress: string; tokenName: string; tokenSymbol: string; to: `0x${string}`; data: `0x${string}`; chainId: number; gasEstimate: string; description: string };

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Todos los tokens donde la wallet es beneficiaria del creador, con lo reclamable y lo ya cobrado. Cache de Bankr 2 min. */
export async function creatorFees(wallet: string, days = 30): Promise<CreatorFees> {
  if (!ADDR.test(wallet)) throw new Error("bad wallet");
  const r = await fetch(`${BASE}/public/doppler/creator-fees/${wallet}?days=${Math.min(90, Math.max(1, days))}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`creator fees ${r.status}`);
  const j = (await r.json()) as Partial<CreatorFees>;
  return {
    address: wallet, chain: j.chain ?? "base", tokens: Array.isArray(j.tokens) ? j.tokens : [],
    dailyEarnings: Array.isArray(j.dailyEarnings) ? j.dailyEarnings : [], lifetimeEarnedWeth: String(j.lifetimeEarnedWeth ?? "0"),
    totals: { claimableWeth: String(j.totals?.claimableWeth ?? "0"), claimedWeth: String(j.totals?.claimedWeth ?? "0"), claimCount: Number(j.totals?.claimCount ?? 0) }
  };
}

/** Txs de claim sin firmar para la wallet beneficiaria (hasta 50 tokens). Sin auth: la firma es la autorizacion. */
export async function buildClaim(wallet: string, tokenAddresses: string[]): Promise<{ txs: ClaimTx[]; errors: Array<{ tokenAddress?: string; error?: string; message?: string }> }> {
  if (!ADDR.test(wallet)) throw new Error("bad wallet");
  const tokens = tokenAddresses.filter((t) => ADDR.test(t)).slice(0, 50);
  if (!tokens.length) return { txs: [], errors: [] };
  const r = await fetch(`${BASE}/public/doppler/build-claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beneficiaryAddress: wallet, tokenAddresses: tokens }), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as { transactions?: ClaimTx[]; errors?: Array<{ tokenAddress?: string; error?: string; message?: string }>; error?: string; message?: string };
  if (!r.ok) throw new Error(String(j.message ?? j.error ?? `build claim ${r.status}`));
  // Solo txs bien formadas y en Base: el cliente las firma tal cual.
  const txs = (j.transactions ?? []).filter((t) => ADDR.test(t.to) && /^0x[0-9a-fA-F]*$/.test(t.data) && Number(t.chainId) === 8453);
  return { txs, errors: j.errors ?? [] };
}

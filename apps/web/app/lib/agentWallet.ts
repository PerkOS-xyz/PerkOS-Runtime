import { getPerkosIdToken, perkosRequest, PerkosApiError } from "./perkosApi";
import { fleetStatus } from "./fleet";

/**
 * The Trader's own wallet: a Dynamic server wallet that PerkOS assigns to the
 * desk's Trader. Floor never holds its key and never sees one. The person
 * approves on the desk (Hold), Floor asks the PerkOS API to sign that step,
 * and the API checks it against the agent policy before Dynamic signs:
 * USDC approved only to a known router, the swap paid in USDC, the output
 * pinned back to the Trader's wallet, under the per-order cap.
 */

export type AgentWalletView = {
  agentId: string;
  address: string;
  provider: "dynamic";
  pattern: "server-wallet";
  createdAt: string | null;
  limits: { maxStablePerOrder: number; maxNativePerOrder: number; enforcedBy: "perkos" };
};

/** Same shape as the API's `GET /wallet/agents/:id` chains. */
export type ChainBalances = {
  chain: string;
  chainId: number;
  available: boolean;
  balances: Array<{ symbol: string; address: string | null; decimals: number; raw: string; formatted: string }>;
};

/** One number for the card: what the Trader can spend, and what pays its gas. */
export function baseFunds(chains: ChainBalances[]): { usdc: number; eth: number } {
  const b = chains.find((c) => c.chain === "base");
  const of = (sym: string) => Number(b?.balances.find((x) => x.symbol === sym)?.formatted ?? 0);
  return { usdc: of("USDC"), eth: of("ETH") };
}

export type TraderWalletState = {
  /** The API has Dynamic credentials; without them the card says so. */
  enabled: boolean;
  /** The desk has a Trader to hold the wallet. */
  agentId: string | null;
  wallet: AgentWalletView | null;
  chains: ChainBalances[];
};

async function token(wallet: string): Promise<string> {
  const t = await getPerkosIdToken(wallet);
  if (!t) throw new PerkosApiError(401, "PERKOS_SESSION", "Sign in to PerkOS first");
  return t.idToken;
}

/** The Trader of this wallet's desk, or null when the desk has none yet. */
export async function traderAgentId(wallet: string, templateId?: string): Promise<string | null> {
  const fleet = await fleetStatus(wallet, templateId);
  return fleet.agents.find((a) => a.role === "trader")?.agentId ?? null;
}

export async function traderWalletState(wallet: string, templateId?: string): Promise<TraderWalletState> {
  const agentId = await traderAgentId(wallet, templateId);
  if (!agentId) return { enabled: false, agentId: null, wallet: null, chains: [] };
  const r = await perkosRequest<{ enabled?: boolean; wallet?: AgentWalletView | null; chains?: ChainBalances[] }>(
    `/wallet/agents/${encodeURIComponent(agentId)}`,
    { idToken: await token(wallet), timeoutMs: 20_000 }
  );
  return { enabled: Boolean(r.enabled), agentId, wallet: r.wallet ?? null, chains: r.chains ?? [] };
}

export async function ensureTraderWallet(wallet: string, templateId?: string): Promise<AgentWalletView> {
  const agentId = await traderAgentId(wallet, templateId);
  if (!agentId) throw new PerkosApiError(409, "NO_TRADER", "Start the desk first: the wallet belongs to its Trader");
  const r = await perkosRequest<{ wallet: AgentWalletView }>(`/wallet/agents/${encodeURIComponent(agentId)}/ensure`, {
    idToken: await token(wallet),
    method: "POST",
    timeoutMs: 45_000
  });
  return r.wallet;
}

export type AgentCallResult = {
  hash: `0x${string}`;
  chainId: number;
  explorerUrl: string | null;
  executionId: string;
  summary: { kind: "approve" | "swap"; venue: string; usdc: number; tokenOut?: string };
};

/** Ask the API to sign one approved step from the Trader's wallet. */
export async function traderWalletCall(
  wallet: string,
  agentId: string,
  step: { to: string; data: string; value?: string; label: string; reason: string }
): Promise<AgentCallResult> {
  return perkosRequest<AgentCallResult>(`/wallet/agents/${encodeURIComponent(agentId)}/call`, {
    idToken: await token(wallet),
    method: "POST",
    body: JSON.stringify({ chain: "base", ...step }),
    // MPC signing is a relay round trip plus the broadcast; give it room.
    timeoutMs: 60_000
  });
}

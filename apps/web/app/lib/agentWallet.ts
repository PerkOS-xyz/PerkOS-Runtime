import { getPerkosIdToken, perkosRequest, PerkosApiError } from "./perkosApi";
import { fleetStatus } from "./fleet";

/**
 * Trader access: the person keeps a Dynamic embedded wallet and delegates a
 * limited, revocable share of it to the desk's Trader. Floor never sees that
 * share or any key. The person grants, edits limits or revokes on a PerkOS page
 * that opens in the system browser; on the desk they still hold Approve on
 * every order, and PerkOS signs that one step through Dynamic.
 *
 * Limits live in three places, and the card says which is which: Dynamic's
 * enclave (a rule the person sets on the delegated share), the PerkOS policy
 * (the swap pays back into the same wallet), and the Hold.
 */

export type TraderLimits = {
  maxUsdc: number;
  ruleId: string | null;
  /** Read back from Dynamic when it was set, not just what the page reported. */
  verified: boolean;
  setAt: string;
};

export type ChainBalances = {
  chain: string;
  chainId: number;
  available: boolean;
  balances: Array<{ symbol: string; address: string | null; decimals: number; raw: string; formatted: string }>;
};

export type TraderAccess = {
  /** Delegated access is switched on for this PerkOS deployment. */
  enabled: boolean;
  /** The desk's Trader, or null before the desk exists. */
  agentId: string | null;
  linked: boolean;
  delegated: boolean;
  walletAddress: string | null;
  limits: TraderLimits | null;
  chains: ChainBalances[];
  allowlist: Array<{ address: string; label: string }>;
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

export async function traderAccess(wallet: string, templateId?: string): Promise<TraderAccess> {
  const [agentId, r] = await Promise.all([
    traderAgentId(wallet, templateId).catch(() => null),
    perkosRequest<Omit<TraderAccess, "agentId">>("/delegation/status", { idToken: await token(wallet), timeoutMs: 20_000 })
  ]);
  return {
    enabled: Boolean(r.enabled),
    agentId,
    linked: Boolean(r.linked),
    delegated: Boolean(r.delegated),
    walletAddress: r.walletAddress ?? null,
    limits: r.limits ?? null,
    chains: r.chains ?? [],
    allowlist: r.allowlist ?? []
  };
}

/** A one-shot link to the PerkOS page where the person grants or edits access. */
export async function traderAccessLink(wallet: string, mode: "grant" | "edit", templateId?: string): Promise<string> {
  const agentId = await traderAgentId(wallet, templateId);
  if (!agentId) throw new PerkosApiError(409, "NO_TRADER", "Start the desk first: access is delegated to its Trader");
  const r = await perkosRequest<{ url: string }>("/delegation/link-token", {
    idToken: await token(wallet),
    method: "POST",
    body: JSON.stringify({ agentId, mode }),
    timeoutMs: 15_000
  });
  return r.url;
}

export async function revokeTraderAccess(wallet: string): Promise<void> {
  await perkosRequest("/delegation/revoke", { idToken: await token(wallet), method: "POST", timeoutMs: 20_000 });
}

export type AgentCallResult = {
  hash: `0x${string}`;
  chainId: number;
  explorerUrl: string | null;
  executionId: string;
  signer: "delegated" | "agent";
  from: string;
  summary: { kind: "approve" | "swap"; venue: string; usdc: number; tokenOut?: string };
};

/** Ask PerkOS to sign one approved step; it signs through the delegated wallet. */
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

/** One number for the card: what the Trader can spend, and what pays its gas. */
export function baseFunds(chains: ChainBalances[]): { usdc: number; eth: number } {
  const b = chains.find((c) => c.chain === "base");
  const of = (sym: string) => Number(b?.balances.find((x) => x.symbol === sym)?.formatted ?? 0);
  return { usdc: of("USDC"), eth: of("ETH") };
}

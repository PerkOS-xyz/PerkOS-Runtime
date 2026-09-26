import type { DeskTeam, DeskTrader } from "@perkos/client";

/** Select only this desk's unique provisioned Trader, never another desk's. */
export function traderAgentId(team: DeskTeam | null | undefined, templateId: string): string | undefined {
  if (team?.templateId !== templateId) return undefined;
  const traders = team?.agents.filter((a) => a.role === "trader") ?? [];
  return traders.length === 1 ? traders[0]!.agentId : undefined;
}

export async function delegationLink(mode: "grant" | "edit" | "revoke", agentId?: string): Promise<string> {
  const res = await fetch("/api/delegation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, ...(agentId && mode !== "revoke" ? { agentId } : {}) }) });
  const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!res.ok || !body.url) throw new Error(body.message ?? "PerkOS did not return a link.");
  return body.url;
}

/** World enrollment is not a spending grant; the exact Trader, wallet and
 * chain must match the server's approved authority. */
export function worldApprovalRequired(trader: Pick<DeskTrader, "world" | "wallet" | "chainId">, agentId?: string): boolean {
  if (!trader.world?.enabled) return false;
  const { approved, grant } = trader.world;
  return !approved || !grant || !agentId || grant.agentId !== agentId || !trader.wallet ||
    grant.walletAddress.toLowerCase() !== trader.wallet.toLowerCase() || !grant.chainIds.includes(trader.chainId);
}

/** Grant consumes the selected Trader's new link token. Edit reuses the
 * existing link, so it is safe only for the already approved same Trader.
 * The external grant flow reuses an existing Dynamic share. */
export function delegationMode(trader: Pick<DeskTrader, "world" | "wallet" | "chainId">, agentId?: string): "grant" | "edit" {
  return worldApprovalRequired(trader, agentId) ? "grant" : "edit";
}

export function effectiveOrderCap(trader: DeskTrader, agentId?: string): number {
  if (worldApprovalRequired(trader, agentId)) return 0;
  return trader.world?.enabled && trader.world.grant ? Math.min(trader.cap, Number(trader.world.grant.maxPerOrder)) : trader.cap;
}

/** A fresh approval can retain the saved limit; its revision still changes. */
export function delegationChanged(before: DeskTrader, next: DeskTrader): boolean {
  return before.cap !== next.cap || before.capReason !== next.capReason ||
    before.world?.approved !== next.world?.approved || before.world?.grant?.revision !== next.world?.grant?.revision;
}

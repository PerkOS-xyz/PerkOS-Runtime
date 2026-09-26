/**
 * How the team shows in the scene, from where PerkOS says it stands. No
 * browser needed, so it is tested on its own.
 */

import type { TeamAgent, TeamAgentState, TeamStatus } from "@perkos/client";

import type { AgentAvatarState } from "./avatarIdentity";

/** The roles that decide, in the order they sit around Sparky. Any other agent is a specialist. */
export const TABLE_ROLES = ["scout", "risk", "trader", "auditor"];

/** The desk's agents as PerkOS reports them, split into the table and the specialists. */
export function seating(agents: TeamAgent[]): { table: TeamAgent[]; specialists: TeamAgent[] } {
  return {
    table: TABLE_ROLES.flatMap((role) => agents.filter((a) => a.role === role)),
    specialists: agents.filter((a) => !TABLE_ROLES.includes(a.role))
  };
}

/**
 * Where a specialist sits, in pixels from Sparky's head: at rest, half on
 * each side under the table, reading left to right in the desk's order; in a
 * conversation, one row.
 */
export function specialistSeat(i: number, count: number): { x: number; row: number } {
  const left = Math.ceil(count / 2);
  const x = i < left ? -(230 + (left - 1 - i) * 88) : 230 + (i - left) * 88;
  return { x, row: Math.round((i - (count - 1) / 2) * 58) };
}

export function memberLook(state: TeamAgentState | undefined): { avatar: AgentAvatarState; label: string } {
  switch (state) {
    case "ready":
      return { avatar: "idle", label: "Online" };
    case "waking":
      return { avatar: "thinking", label: "Waking" };
    case "provisioning":
      return { avatar: "thinking", label: "Setting up" };
    case "hibernated":
      return { avatar: "hibernating", label: "Asleep" };
    case "failed":
      return { avatar: "error", label: "Failed" };
    default:
      return { avatar: "offline", label: "Not set up" };
  }
}

/** What the wake button says, and whether it does anything right now. */
export function wakeAction(status: TeamStatus | undefined, busy: boolean): { label: string; enabled: boolean } {
  if (busy || status === "waking" || status === "provisioning") return { label: "Waking…", enabled: false };
  if (status === "ready") return { label: "Team up", enabled: false };
  if (status === "none") return { label: "Set up the team", enabled: true };
  if (status === undefined) return { label: "Wake team", enabled: false };
  return { label: "Wake team", enabled: true };
}

/**
 * Whether opening the desk should wake its team by itself: only a team that
 * exists and sleeps. A team with a role never set up is left alone, because
 * waking it would create agents; that stays the person's call.
 */
export function wakesOnOpen(team: { status: TeamStatus; agents: ReadonlyArray<{ state: string }> } | null): boolean {
  if (!team || !team.agents.length) return false;
  if (team.agents.some((a) => a.state === "planned" || a.state === "failed")) return false;
  return team.agents.some((a) => a.state === "hibernated");
}

/** While the desk is open, how often PerkOS hears the team is in use, well inside its idle window. */
export const KEEP_AWAKE_MS = 5 * 60_000;

/** Waking takes a few minutes: read often while it happens, rarely otherwise. */
export const pollEvery = (status: TeamStatus | undefined) => (status === "waking" || status === "provisioning" ? 8_000 : 60_000);

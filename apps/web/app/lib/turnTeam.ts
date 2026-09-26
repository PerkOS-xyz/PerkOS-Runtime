/**
 * The desk's team, made ready for a turn.
 *
 * A turn wakes the team only when part of it is asleep, and only when the
 * whole team exists: waking also creates missing agents, and a question must
 * never create billed agents. A team that is not set up is sent back to the
 * person's "Set up the team" button. The turn waits while agents are waking,
 * and never for one that is still being created or that failed.
 */

import { PerkosApiError, type DeskTeam, type TeamAgent } from "@perkos/client";

import type { TurnSeat } from "./turnEngine";
import { roleName, type TurnErrorCode, type TurnEvent } from "./turnRecord";

export interface TeamCalls {
  status(templateId: string, options?: { signal?: AbortSignal }): Promise<DeskTeam>;
  wake(templateId: string, options?: { signal?: AbortSignal }): Promise<DeskTeam>;
}

export interface ReadyInput {
  team: TeamCalls;
  /** The desk's id, which is its template on PerkOS. */
  desk: string;
  /** The roles the turn needs. */
  roles: string[];
  emit: (event: TurnEvent) => void;
  signal: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs?: number;
  maxWaitMs?: number;
}

export type ReadyTeam =
  | { ok: true; seats: Record<string, TurnSeat>; waitedMs: number }
  | { ok: false; code: TurnErrorCode; message: string; seats: Record<string, TurnSeat>; waitedMs: number };

export const WAKE_POLL_MS = 5_000;
export const WAKE_MAX_MS = 240_000;

export const TURN_ERRORS: Record<TurnErrorCode, string> = {
  TEAM_NOT_SET_UP: "The desk's team is not set up yet. Set up the team, then ask again.",
  NO_DESK_TIME: "Add desk time to run the team.",
  INFRA_APPROVAL_REQUIRED: "PerkOS infrastructure for this wallet needs an admin's approval. Desk time alone does not unlock it.",
  LLM_BYOK_REQUIRED: "The team's model needs your own model key. PerkOS's shared model is kept for approved testers.",
  TEAM_ASLEEP: "The team did not wake in time. Sparky answers on its own this time.",
  TEAM_UNREACHABLE: "PerkOS did not answer about the team. Try again in a moment.",
  DESK_MARKET: "The desk's market did not answer, and the team only answers from the desk's facts. Try again in a moment.",
  SIGNED_OUT: "Sign in to PerkOS first.",
  INTERNAL: "The turn stopped on an error.",
};

/** The turn error a refusal from PerkOS stands for. */
export function turnErrorFor(err: unknown): { code: TurnErrorCode; message: string } {
  const code = err instanceof PerkosApiError ? err.code : "";
  const status = err instanceof PerkosApiError ? err.status : 0;
  const pick = (c: TurnErrorCode) => ({ code: c, message: TURN_ERRORS[c] });
  if (code === "INFRA_APPROVAL_REQUIRED") return pick("INFRA_APPROVAL_REQUIRED");
  if (code === "LLM_BYOK_REQUIRED") return pick("LLM_BYOK_REQUIRED");
  if (status === 402 || code === "INFRA_PAYMENT_REQUIRED" || code === "INFRA_CREDITS_EXHAUSTED") return pick("NO_DESK_TIME");
  if (status === 401 || code === "PERKOS_SESSION") return pick("SIGNED_OUT");
  return pick("TEAM_UNREACHABLE");
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

const asleep = (a: TeamAgent | undefined) => a?.state === "hibernated" || a?.state === "waking";
const listNames = (roles: string[]) => {
  const names = roles.map(roleName);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

function seatFor(role: string, agent: TeamAgent | undefined, note: { waitedS: number; woke: boolean; heldBack: boolean }): TurnSeat {
  const base = { role, ...(agent?.agentId ? { agentId: agent.agentId } : {}), ...(agent?.name ? { agentName: agent.name } : {}) };
  if (!agent || agent.state === "planned") return { ...base, ready: false, failure: "not_set_up", detail: "This role is not set up yet." };
  if (agent.state === "ready") {
    return agent.agentId ? { ...base, ready: true } : { ...base, ready: false, failure: "offline", detail: "PerkOS gave no id for this agent." };
  }
  if (agent.state === "provisioning") return { ...base, ready: false, failure: "offline", detail: "Still being set up on PerkOS." };
  if (agent.state === "failed") return { ...base, ready: false, failure: "offline", detail: agent.detail || "The agent failed to start on PerkOS." };
  const detail = note.heldBack
    ? "Asleep. The team was not woken, because part of it is not set up yet."
    : note.woke
      ? `Still asleep after ${note.waitedS} s.`
      : "Asleep.";
  return { ...base, ready: false, failure: "offline", detail };
}

export async function readyTeam(input: ReadyInput): Promise<ReadyTeam> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pollMs = input.pollMs ?? WAKE_POLL_MS;
  const maxWaitMs = input.maxWaitMs ?? WAKE_MAX_MS;
  const working = (text: string) => input.emit({ step: "working", at: new Date(now()).toISOString(), text });
  const started = now();
  const opts = { signal: input.signal };
  const seatsOf = (team: DeskTeam | null, woke: boolean, heldBack: boolean) => {
    const waitedS = Math.round((now() - started) / 1000);
    const byRole = new Map((team?.agents ?? []).map((a) => [a.role, a]));
    return Object.fromEntries(input.roles.map((r) => [r, seatFor(r, byRole.get(r), { waitedS, woke, heldBack })]));
  };
  const fail = (code: TurnErrorCode, seats: Record<string, TurnSeat>, message = TURN_ERRORS[code]): ReadyTeam => ({
    ok: false,
    code,
    message,
    seats,
    waitedMs: now() - started,
  });

  working("Checking the team");
  let team: DeskTeam;
  try {
    team = await input.team.status(input.desk, opts);
  } catch (err) {
    const e = turnErrorFor(err);
    return fail(e.code, seatsOf(null, false, false), e.message);
  }
  const agentOf = (t: DeskTeam, role: string) => t.agents.find((a) => a.role === role);
  const planned = input.roles.filter((r) => {
    const a = agentOf(team, r);
    return !a || a.state === "planned";
  });
  if (team.status === "none" || planned.length === input.roles.length) return fail("TEAM_NOT_SET_UP", seatsOf(team, false, false));

  const sleeping = (t: DeskTeam) => input.roles.filter((r) => asleep(agentOf(t, r)));
  const readyRoles = (t: DeskTeam) => input.roles.filter((r) => agentOf(t, r)?.state === "ready");
  const heldBack = planned.length > 0 && input.roles.some((r) => agentOf(team, r)?.state === "hibernated");
  let woke = false;

  if (!heldBack && input.roles.some((r) => agentOf(team, r)?.state === "hibernated") && !input.signal.aborted) {
    working("Waking the team");
    input.emit({ step: "wake", status: team.status, ready: readyRoles(team), waiting: sleeping(team), waitedMs: 0, woke: false });
    try {
      team = await input.team.wake(input.desk, opts);
      woke = true;
    } catch (err) {
      if (!input.signal.aborted) {
        const e = turnErrorFor(err);
        return fail(e.code, seatsOf(team, false, false), e.message);
      }
    }
  } else if (heldBack) {
    working(`Part of the team is not set up, so the team was not woken`);
  }

  // Wait while an agent is waking, and for the sleeping ones only once they were asked to wake.
  const waitingOn = (t: DeskTeam) => input.roles.filter((r) => agentOf(t, r)?.state === "waking" || (woke && agentOf(t, r)?.state === "hibernated"));
  let waited = false;
  while (waitingOn(team).length && now() - started < maxWaitMs && !input.signal.aborted) {
    if (!waited) working(`Waiting for ${listNames(waitingOn(team))} to wake`);
    waited = true;
    input.emit({ step: "wake", status: team.status, ready: readyRoles(team), waiting: waitingOn(team), waitedMs: now() - started, woke });
    await sleep(pollMs, input.signal);
    if (input.signal.aborted) break;
    try {
      team = await input.team.status(input.desk, opts);
    } catch {
      // A missed poll is not the end of the wait; the next one may answer.
    }
  }
  if (waited) {
    const still = waitingOn(team);
    input.emit({ step: "wake", status: team.status, ready: readyRoles(team), waiting: [], waitedMs: now() - started, woke });
    if (!input.signal.aborted) {
      working(
        still.length
          ? `${listNames(still)} ${still.length === 1 ? "is" : "are"} still asleep after ${Math.round((now() - started) / 1000)} s`
          : `The team is up after ${Math.round((now() - started) / 1000)} s`,
      );
    }
  }

  const seats = seatsOf(team, woke, heldBack);
  if (!input.signal.aborted && !Object.values(seats).some((s) => s.ready)) {
    return fail(planned.length ? "TEAM_NOT_SET_UP" : "TEAM_ASLEEP", seats);
  }
  return { ok: true, seats, waitedMs: now() - started };
}

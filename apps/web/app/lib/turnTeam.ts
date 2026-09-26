/**
 * The desk's team, made ready for a turn.
 *
 * A turn wakes the team only when part of it is asleep, and only when the
 * whole team exists: waking also creates missing agents, the turn's roles and
 * any specialist the desk seats beside them, and a question must never create
 * billed agents. A team that is not set up is sent back to the desk's own
 * button, named as it reads for that team: "Set up the team" while none of it
 * exists, "Wake team" once part of it does. The turn waits while agents are waking,
 * and never for one that is still being created or that failed.
 */

import { PerkosApiError, type DeskTeam, type TeamAgent, type TeamStatus } from "@perkos/client";

import { wakeAction } from "../team/look";

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
  TEAM_SETTING_UP: "The team is still being set up on PerkOS. Ask again in a minute.",
  TEAM_FAILED: "The team's agents failed to start on PerkOS. Sparky answers on its own this time.",
  TEAM_UNREACHABLE: "PerkOS did not answer about the team. Try again in a moment.",
  DESK_MARKET: "The desk's market did not answer, and the team only answers from the desk's facts. Try again in a moment.",
  SIGNED_OUT: "Sign in to PerkOS first.",
  INTERNAL: "The turn stopped on an error.",
};

/** Some of the turn's roles are asleep, and others of the desk's agents do not exist yet. */
export const TEAM_PARTLY_SET_UP = "Part of the desk's team is not set up yet, so the team was not woken: waking it also creates the missing agents.";

/**
 * What to tell the person when agents the turn would need are missing,
 * naming the button the desk shows for this team, since that button is
 * what creates them.
 */
export function notSetUpMessage(status: TeamStatus, heldBack: boolean): string {
  if (status === "none") return TURN_ERRORS.TEAM_NOT_SET_UP;
  if (status === "waking" || status === "provisioning") return "Part of the desk's team is still being set up on PerkOS. Ask again once the whole team is up.";
  const button = wakeAction(status, false);
  const lead = heldBack ? TEAM_PARTLY_SET_UP : "Part of the desk's team is not set up yet.";
  if (!button.enabled) return `${lead} Ask again once PerkOS shows the whole team.`;
  return `${lead} Press ${button.label} to create them, then ask again.`;
}

/** Why no role could take part, once the team is known to be set up. */
function teamDown(seats: TurnSeat[]): TurnErrorCode {
  if (seats.some((s) => s.failure === "offline")) return "TEAM_ASLEEP";
  if (seats.some((s) => s.failure === "setting_up")) return "TEAM_SETTING_UP";
  if (seats.some((s) => s.failure === "start_failed")) return "TEAM_FAILED";
  return "TEAM_ASLEEP";
}

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
  if (agent.state === "provisioning") return { ...base, ready: false, failure: "setting_up", detail: "Still being set up on PerkOS." };
  if (agent.state === "failed") return { ...base, ready: false, failure: "start_failed", detail: agent.detail || "The agent failed to start on PerkOS." };
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
  if (team.status === "none" || planned.length === input.roles.length) {
    return fail("TEAM_NOT_SET_UP", seatsOf(team, false, false), notSetUpMessage(team.status, false));
  }
  // Waking sets up every agent of the desk's template that does not exist yet, the turn's roles
  // or not (a desk can seat specialists beside them). Any of them missing holds the wake back.
  const unbuilt = planned.length > 0 || team.agents.some((a) => a.state === "planned");

  const sleeping = (t: DeskTeam) => input.roles.filter((r) => asleep(agentOf(t, r)));
  const readyRoles = (t: DeskTeam) => input.roles.filter((r) => agentOf(t, r)?.state === "ready");
  const heldBack = unbuilt && input.roles.some((r) => agentOf(team, r)?.state === "hibernated");
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
    if (heldBack) return fail("TEAM_NOT_SET_UP", seats, notSetUpMessage(team.status, true));
    if (planned.length) return fail("TEAM_NOT_SET_UP", seats, notSetUpMessage(team.status, false));
    return fail(teamDown(Object.values(seats)), seats);
  }
  return { ok: true, seats, waitedMs: now() - started };
}

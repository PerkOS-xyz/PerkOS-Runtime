/**
 * A desk turn, run: the first roles in parallel, then the next ones in
 * parallel with what the first ones said. Each role is asked once; a role
 * that fails is recorded with the reason and the turn goes on without it.
 *
 * Asking is injected, so this file knows nothing about PerkOS or HTTP and the
 * whole turn can be run against a fake team. It never prepares or sends an
 * order: the person trades only from the Trader sheet, by holding to approve.
 *
 * Stopping a turn stops waiting. The agents are not cancelled: PerkOS has no
 * way to cancel a task, so a stopped role may still finish on PerkOS, and its
 * answer is simply not kept.
 */

import type { AgentAnswer } from "@perkos/client";

import { classifyAnswer, classifyError, failureLabel, stillStarting } from "./turnFailure";
import { fullPrompt, handoff, roleTail } from "./turnPrompts";
import { roleName, type FailureKind, type RiskLevel, type RoleReply, type TurnEvent, type TurnKind, type Verdict } from "./turnRecord";

/** How long PerkOS waits for one agent in a turn, under the 90 s PerkOS allows a task. */
export const TASK_MS = 85_000;
/** How long an agent that is still starting after a wake is asked again, and how often. */
export const STARTING_WINDOW_MS = 90_000;
export const STARTING_RETRY_MS = 8_000;

/** One role's seat at the table for this turn. */
export interface TurnSeat {
  role: string;
  /** True when the agent is up and PerkOS has an id for it. */
  ready: boolean;
  agentId?: string;
  agentName?: string;
  /** Why it cannot take part, when it is not ready. */
  failure?: FailureKind;
  detail?: string;
}

export type AskAgent = (agentId: string, prompt: string, options: { timeoutMs: number; signal: AbortSignal }) => Promise<AgentAnswer>;

export interface RunTurnInput {
  kind: TurnKind;
  /** The roles of each phase, in order. */
  phases: readonly (readonly string[])[];
  seats: Record<string, TurnSeat>;
  /** What every role gets first. */
  head: string;
  /** The desk's words for each role in this kind of turn. */
  rolePrompts: Record<string, string>;
  ask: AskAgent;
  /** Tells PerkOS the agent is in use. Errors are ignored. */
  touch?: (agentId: string) => Promise<void>;
  emit: (event: TurnEvent) => void;
  signal: AbortSignal;
  now?: () => number;
  taskMs?: number;
  /** Waits between asks of an agent still starting; ends early when the turn stops. */
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const pauseFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

export interface TurnOutcome {
  replies: RoleReply[];
  /** Per role, what followed the head. */
  prompts: Record<string, string>;
  riskLevel?: RiskLevel;
  verdict?: Verdict;
  stopped: boolean;
}

/** "RISK: medium" on a line of its own. */
export function riskLevelOf(reply: string): RiskLevel | undefined {
  const m = reply.match(/^\s*RISK:\s*(low|medium|high)\b/im);
  return m ? (m[1]!.toLowerCase() as RiskLevel) : undefined;
}

/** "VERDICT: GO" or "VERDICT: BLOCK". */
export function verdictOf(reply: string): Verdict | undefined {
  const m = reply.match(/VERDICT\s*[:-]\s*(GO|BLOCK)\b/i);
  return m ? (m[1]!.toUpperCase() as Verdict) : undefined;
}

const DOING: Record<string, string> = {
  trader: "drafting the plan",
  auditor: "writing the record",
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const listNames = (roles: string[]) => {
  const names = roles.map(roleName);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

export async function runTurn(input: RunTurnInput): Promise<TurnOutcome> {
  const now = input.now ?? Date.now;
  const taskMs = input.taskMs ?? TASK_MS;
  const pause = input.pause ?? pauseFor;
  const iso = () => new Date(now()).toISOString();
  const working = (text: string) => input.emit({ step: "working", at: iso(), text });
  const replies: RoleReply[] = [];
  const prompts: Record<string, string> = {};
  let riskLevel: RiskLevel | undefined;
  let verdict: Verdict | undefined;

  const finish = (reply: RoleReply, notes: { riskLevel?: RiskLevel; verdict?: Verdict } = {}) => {
    replies.push(reply);
    input.emit({ step: "reply", ...reply, ...notes });
    if (!reply.ok) {
      const failure = reply.failure ?? "other";
      input.emit({ step: "failure", role: reply.role, phase: reply.phase, failure, label: failureLabel(failure), ...(reply.detail ? { detail: reply.detail } : {}) });
    }
    return reply;
  };

  const run = async (role: string, phase: 1 | 2, tail: string): Promise<RoleReply> => {
    const seat = input.seats[role];
    const who = roleName(role);
    prompts[role] = tail;
    const base = { role, phase, ...(seat?.agentName ? { agentName: seat.agentName } : {}) };
    if (input.signal.aborted) {
      return finish({ ...base, ok: false, reply: "", failure: "stopped", detail: `Stopped before ${who} was asked.`, ms: 0 });
    }
    if (!input.rolePrompts[role]) {
      return finish({ ...base, ok: false, reply: "", failure: "other", detail: "The desk gives this role nothing to do in this kind of turn.", ms: 0 });
    }
    if (!seat?.ready || !seat.agentId) {
      const failure = seat?.failure ?? "offline";
      working(`${who} sits this one out: ${failureLabel(failure)}`);
      return finish({ ...base, ok: false, reply: "", failure, ...(seat?.detail ? { detail: seat.detail } : {}), ms: 0 });
    }
    const started = now();
    const startedAt = new Date(started).toISOString();
    input.emit({ step: "start", role, phase, at: startedAt, ...(seat.agentName ? { agentName: seat.agentName } : {}) });
    working(`${who} is ${phase === 1 ? "reading the facts" : (DOING[role] ?? "working")}`);
    try {
      const ask = () => input.ask(seat.agentId!, fullPrompt(input.head, tail), { timeoutMs: taskMs, signal: input.signal });
      let answer = await ask();
      let read = classifyAnswer(answer);
      // Just woken, its runtime may not be listening yet: ask again for a while before giving up.
      let retries = 0;
      while (!read.ok && stillStarting(read.detail) && now() - started < STARTING_WINDOW_MS && !input.signal.aborted) {
        if (!retries++) working(`${who} is still starting up; asking again`);
        await pause(STARTING_RETRY_MS, input.signal);
        if (input.signal.aborted) break;
        answer = await ask();
        read = classifyAnswer(answer);
      }
      if (!read.ok && input.signal.aborted && stillStarting(read.detail)) {
        return finish({ ...base, ok: false, reply: "", failure: "stopped", detail: `Stopped while ${who} was still starting.`, ms: Math.max(0, now() - started), startedAt });
      }
      if (input.touch) void input.touch(seat.agentId).catch(() => undefined);
      const ms = Math.max(0, now() - started);
      const name = answer.agentName || seat.agentName;
      const reply: RoleReply = { role, phase, ...(name ? { agentName: name } : {}), ok: read.ok, reply: read.reply, ms, startedAt };
      if (!read.ok) {
        reply.failure = read.failure ?? "other";
        if (read.detail) reply.detail = read.detail;
      }
      const notes: { riskLevel?: RiskLevel; verdict?: Verdict } = {};
      if (role === "risk" && reply.ok) {
        const level = riskLevelOf(reply.reply);
        if (level) notes.riskLevel = riskLevel = level;
        if (input.kind === "order") {
          const v = verdictOf(reply.reply);
          if (v) notes.verdict = verdict = v;
        }
      }
      working(reply.ok ? `${who} answered in ${seconds(ms)}` : `${who} did not answer: ${failureLabel(reply.failure ?? "other")}`);
      return finish(reply, notes);
    } catch (err) {
      const ms = Math.max(0, now() - started);
      const stopped = input.signal.aborted;
      const { failure, detail } = classifyError(err, stopped);
      const said = stopped ? `Stopped waiting for ${who}. ${who} may still finish the task on PerkOS; that answer is not kept.` : detail;
      if (!stopped) working(`${who} did not answer: ${failureLabel(failure)}`);
      return finish({ ...base, ok: false, reply: "", failure, detail: said, ms, startedAt });
    }
  };

  const [first = [], second = []] = input.phases;
  const firstRoles = [...first];
  const secondRoles = [...second];

  input.emit({ step: "phase", phase: 1, roles: firstRoles, at: iso() });
  const said = await Promise.all(firstRoles.map((role) => run(role, 1, roleTail(input.rolePrompts[role] ?? ""))));

  if (input.kind === "order" && !verdict) verdict = "BLOCK";
  if (secondRoles.length) {
    const note = handoff(said, { riskLevel, verdict });
    if (!input.signal.aborted) working(`Handing ${listNames(firstRoles)} to ${listNames(secondRoles)}`);
    input.emit({ step: "phase", phase: 2, roles: secondRoles, at: iso() });
    await Promise.all(secondRoles.map((role) => run(role, 2, roleTail(input.rolePrompts[role] ?? "", note))));
  }

  const outcome: TurnOutcome = { replies, prompts, stopped: input.signal.aborted };
  if (riskLevel) outcome.riskLevel = riskLevel;
  if (verdict) outcome.verdict = verdict;
  // Phase order, then the order the desk lists the roles in.
  const order = [...firstRoles, ...secondRoles];
  outcome.replies.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return outcome;
}

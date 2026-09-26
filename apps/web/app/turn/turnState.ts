/**
 * The live picture of a desk turn, built from the events the route streams:
 * where each role is, the "Sparky · working" checklist, and how it ended.
 *
 * A pure reducer, so the chat, the team cards and History's replay all read a
 * turn the same way, and it can be tested without a window.
 */

import { failureLabel } from "../lib/turnFailure";
import { TURN_PHASES, type FailureKind, type RiskLevel, type TurnErrorCode, type TurnEvent, type TurnKind, type Verdict } from "../lib/turnRecord";

export type RoleStatus = "waiting" | "thinking" | "delivered" | "failed" | "skipped";

export interface RoleView {
  role: string;
  phase: 1 | 2;
  status: RoleStatus;
  agentName?: string;
  /** ms since epoch */
  startedAt?: number;
  ms?: number;
  reply?: string;
  failure?: FailureKind;
  label?: string;
  detail?: string;
  riskLevel?: RiskLevel;
  verdict?: Verdict;
}

export interface StepView {
  /** ms since epoch */
  at: number;
  text: string;
}

export interface TurnView {
  turnId: string | null;
  kind: TurnKind | null;
  question: string;
  principal: string;
  facts: string[];
  live: boolean;
  /** The team is being woken; Sparky keeps the person company meanwhile. */
  waking: boolean;
  waiting: string[];
  roles: Record<string, RoleView>;
  /** Roles in the order they sit. */
  order: string[];
  steps: StepView[];
  startedAt: number | null;
  endedAt: number | null;
  flags: string[];
  kept: "vault" | "session" | null;
  stopped: boolean;
  error: { code: TurnErrorCode; message: string } | null;
  riskLevel?: RiskLevel;
  verdict?: Verdict;
}

export const idleTurn: TurnView = {
  turnId: null,
  kind: null,
  question: "",
  principal: "",
  facts: [],
  live: false,
  waking: false,
  waiting: [],
  roles: {},
  order: [],
  steps: [],
  startedAt: null,
  endedAt: null,
  flags: [],
  kept: null,
  stopped: false,
  error: null,
};

const phaseOf = (role: string): 1 | 2 => (TURN_PHASES[1].includes(role) ? 2 : 1);
const time = (iso: string, fallback: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
};

function withRole(view: TurnView, role: string, patch: Partial<RoleView>): TurnView {
  const current = view.roles[role] ?? { role, phase: phaseOf(role), status: "waiting" as const };
  return { ...view, roles: { ...view.roles, [role]: { ...current, ...patch } }, order: view.order.includes(role) ? view.order : [...view.order, role] };
}

export function reduceTurn(view: TurnView, ev: TurnEvent, now = Date.now()): TurnView {
  switch (ev.step) {
    case "open": {
      const roles: Record<string, RoleView> = {};
      for (const role of ev.roles) roles[role] = { role, phase: phaseOf(role), status: "waiting" };
      return {
        ...idleTurn,
        turnId: ev.turnId,
        kind: ev.kind,
        question: ev.question,
        principal: ev.principal,
        facts: ev.facts,
        live: true,
        roles,
        order: [...ev.roles],
        startedAt: time(ev.at, now),
      };
    }
    case "wake":
      return { ...view, waking: ev.waiting.length > 0, waiting: ev.waiting };
    case "working":
      return { ...view, steps: [...view.steps, { at: time(ev.at, now), text: ev.text }] };
    case "phase":
      return { ...view, waking: false, waiting: [] };
    case "start":
      return withRole(view, ev.role, { phase: ev.phase, status: "thinking", startedAt: time(ev.at, now), ...(ev.agentName ? { agentName: ev.agentName } : {}) });
    case "reply": {
      const patch: Partial<RoleView> = { phase: ev.phase, status: ev.ok ? "delivered" : "failed", ms: ev.ms, reply: ev.reply };
      if (ev.agentName) patch.agentName = ev.agentName;
      if (!ev.ok) {
        patch.failure = ev.failure ?? "other";
        patch.label = failureLabel(patch.failure);
        if (ev.detail) patch.detail = ev.detail;
      }
      if (ev.riskLevel) patch.riskLevel = ev.riskLevel;
      if (ev.verdict) patch.verdict = ev.verdict;
      const next = withRole(view, ev.role, patch);
      return {
        ...next,
        ...(ev.riskLevel ? { riskLevel: ev.riskLevel } : {}),
        ...(ev.verdict ? { verdict: ev.verdict } : {}),
      };
    }
    case "failure":
      return withRole(view, ev.role, { status: "failed", failure: ev.failure, label: ev.label, ...(ev.detail ? { detail: ev.detail } : {}) });
    case "done": {
      const roles: Record<string, RoleView> = {};
      for (const [role, r] of Object.entries(view.roles)) {
        roles[role] = r.status === "waiting" || r.status === "thinking" ? { ...r, status: "skipped" } : r;
      }
      return {
        ...view,
        roles,
        live: false,
        waking: false,
        waiting: [],
        endedAt: view.startedAt !== null ? view.startedAt + ev.ms : now,
        flags: ev.flags,
        kept: ev.kept,
        stopped: ev.stopped === true,
        ...(ev.riskLevel ? { riskLevel: ev.riskLevel } : {}),
        ...(ev.verdict ? { verdict: ev.verdict } : {}),
      };
    }
    case "error":
      return { ...view, error: { code: ev.code, message: ev.message }, waking: false, waiting: [], live: view.turnId !== null ? view.live : false };
  }
}

/** A step shows its seconds once it has taken this long. */
export const STEP_SECONDS_AFTER_MS = 3_000;
/** Finished steps the live checklist keeps in view. */
export const RECENT_STEPS = 4;

export interface WorkingView {
  /** The last finished steps, oldest first. */
  done: string[];
  /** The step in progress while the turn is live, with its seconds once they are worth showing. */
  current: { text: string; seconds: number | null } | null;
  /** Whole seconds since the turn started. */
  seconds: number;
  count: number;
  /** "12 s · 5 steps" while live; "Worked 71 s · 9 steps" once it is over. */
  line: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The "Sparky · working" checklist, at a given moment. */
export function workingView(view: TurnView, now = Date.now()): WorkingView {
  const end = view.live ? now : (view.endedAt ?? now);
  const seconds = view.startedAt === null ? 0 : Math.max(0, Math.round((end - view.startedAt) / 1000));
  const count = view.steps.length;
  const last = view.steps[count - 1];
  const finished = view.live ? view.steps.slice(0, -1) : view.steps;
  const current =
    view.live && last
      ? { text: last.text, seconds: now - last.at >= STEP_SECONDS_AFTER_MS ? Math.floor((now - last.at) / 1000) : null }
      : null;
  return {
    done: finished.slice(-RECENT_STEPS).map((s) => s.text),
    current,
    seconds,
    count,
    line: view.live ? `${seconds} s · ${plural(count, "step")}` : `Worked ${seconds} s · ${plural(count, "step")}`,
  };
}

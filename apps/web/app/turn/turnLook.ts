/**
 * How each agent's part of a desk turn reads on the card under its seat: its
 * three steps, its time, the one result worth a glance, and the state its
 * portrait takes. Once the turn is over the cards fold into chips.
 *
 * Pure, so the seats, a replay and the tests read a turn the same way. A
 * runtime's failure never reads as delivered here, even when it arrived
 * looking like an answer.
 */

import type { Message } from "../chat/messages";
import { failureLabel, runtimeFailure } from "../lib/turnFailure";
import { receiptLine, type FailureKind, type RiskLevel, type TurnKind, type TurnReceipt } from "../lib/turnRecord";
import { roleConfig, type AgentAvatarState } from "../team/avatarIdentity";
import type { RoleStatus, RoleView, TurnView } from "./turnState";

/** How long the cards stay open once the turn is over, before they fold into chips. */
export const FOLD_AFTER_MS = 2_000;
/** How long the handoff beams take to fade once the turn is over. */
export const BEAMS_AFTER_MS = 1_500;
/** How long Focus keeps the conversation on the line it brought into view. */
export const FOCUS_HOLD_MS = 8_000;

/** Where one step stands. The Auditor's receipt is "awaiting": it is the person's to sign. */
export type StepState = "idle" | "active" | "done" | "failed" | "awaiting";

export interface CardStep {
  label: string;
  state: StepState;
}

/** Each house role's part of a turn, in three steps. */
const STEPS: Record<string, readonly [string, string, string]> = {
  scout: ["facts read", "thinking", "handed to Trader"],
  risk: ["facts read", "thinking", "verdict"],
  trader: ["waiting for Scout + Risk", "drafting", "on the table"],
  auditor: ["waiting for the desk", "writing the record", "receipt"],
};
/** Any other role reads the facts, thinks and answers. */
const ANY_ROLE: readonly [string, string, string] = ["facts read", "thinking", "answered"];

export const stepLabels = (role: string): readonly [string, string, string] => STEPS[role] ?? ANY_ROLE;

/** The role was asked: it started, or it took time before it failed. */
const asked = (r: RoleView) => r.startedAt !== undefined || (r.ms ?? 0) > 0;

/** A role as a card reads it: an answer that is a runtime's failure text, or nothing at all, is no answer. */
export function settled(r: RoleView): RoleView {
  if (r.status !== "delivered") return r;
  const reply = (r.reply ?? "").trim();
  const failure: FailureKind | null = reply ? runtimeFailure(reply) : "empty";
  if (!failure) return r;
  return { ...r, status: "failed", reply: "", failure, label: failureLabel(failure), ...(reply ? { detail: r.detail ?? reply } : {}) };
}

/** Where a role's three steps stand. */
export function stepStates(role: RoleView, receipt = false): [StepState, StepState, StepState] {
  const r = settled(role);
  switch (r.status) {
    case "waiting":
      // The second roles' first step is the wait itself.
      return [r.phase === 2 ? "active" : "idle", "idle", "idle"];
    case "thinking":
      return ["done", "active", "idle"];
    case "delivered":
      return ["done", "done", r.role === "auditor" && !receipt ? "awaiting" : "done"];
    case "failed":
      return asked(r) ? ["done", "failed", "idle"] : ["failed", "idle", "idle"];
    case "skipped":
      return [asked(r) ? "done" : "idle", "idle", "idle"];
  }
}

export interface CardMetric {
  /** The result in a word or a ticker: "NVDA", "medium", "no answer". */
  value: string;
  /** What the value is: "top pick", "risk level", "model failed". Cards show it in capitals. */
  label: string;
}

/** "medium / RISK LEVEL" */
export const metricText = (m: CardMetric) => `${m.value} / ${m.label.toUpperCase()}`;

/**
 * The tickers of a turn's facts, from lines like "[F1] NVDA (NVIDIA): 181.20 USDG ...".
 * A stock's line names the company after its ticker; a line like Uniswap's
 * quote, "[F5] Uniswap now: 50.00 USDG buys 0.2741 NVDA ...", names no stock of its own.
 */
export function factTickers(facts: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of facts) {
    const ticker = line.match(/^\[F\d+\]\s+([^\s(]+)\s+\(/)?.[1];
    if (ticker && !out.includes(ticker)) out.push(ticker);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The first of the turn's tickers a line names, by position: "NVDA" or
 * "$NVDA", as a whole word. Only the facts' own tickers count, so a word in
 * capitals is never taken for a stock. A one-letter ticker counts only with
 * its "$".
 */
export function firstTicker(text: string, tickers: readonly string[]): string | null {
  let best: { at: number; ticker: string } | null = null;
  for (const ticker of tickers) {
    const body = ticker.length === 1 ? `\\$${escapeRe(ticker)}` : `\\$?${escapeRe(ticker)}`;
    const m = new RegExp(`(?<![\\w.$])${body}(?!\\w)`).exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, ticker };
  }
  return best?.ticker ?? null;
}

const RISK_LINE = /^\s*RISK:\s*(low|medium|high)\b/im;
/** What the Auditor's record is, by kind of turn. */
const RECORD: Record<TurnKind, string> = { analyze: "analysis", advise: "outlook", order: "order", launch: "launch" };

/** The one result a role shows on its card once its part is over; null while it is waiting or working. */
export function metricFor(view: Pick<TurnView, "kind" | "facts" | "verdict">, role: RoleView): CardMetric | null {
  const r = settled(role);
  if (r.status === "waiting" || r.status === "thinking") return null;
  if (r.status === "skipped") return { value: "no answer", label: "did not run" };
  if (r.status === "failed") {
    const failure = r.failure ?? "other";
    // Stopping ends the wait, not the agent's work: it is not the agent's failure.
    return { value: failure === "stopped" ? "stopped" : "no answer", label: failureLabel(failure) };
  }
  const reply = r.reply ?? "";
  const kind = view.kind ?? "analyze";
  switch (r.role) {
    case "scout": {
      // A pick only when the person asked what to buy; asked about one stock, Scout gives a read.
      const pick = kind === "advise" ? firstTicker(reply, factTickers(view.facts)) : null;
      return pick ? { value: pick, label: "top pick" } : { value: "read", label: "market read" };
    }
    case "risk": {
      if ((kind === "order" || kind === "launch") && r.verdict) return { value: r.verdict, label: "verdict" };
      const level = r.riskLevel ?? (reply.match(RISK_LINE)?.[1]?.toLowerCase() as RiskLevel | undefined);
      return level ? { value: level, label: "risk level" } : { value: "read", label: "risk read" };
    }
    case "trader":
      if (view.verdict === "BLOCK") return { value: "stand down", label: "risk blocked" };
      return { value: firstTicker(reply, factTickers(view.facts)) ?? "plan", label: "entry plan" };
    case "auditor":
      return { value: RECORD[kind], label: "record" };
    default:
      return { value: "read", label: "answer" };
  }
}

/** Failures that are not the agent going wrong: it slept, ran out of time, or needs the person or an admin. */
const WARNINGS = new Set<FailureKind>(["timeout", "offline", "not_set_up", "setting_up", "no_time", "approval", "byok", "network"]);

/** The state a seat's portrait takes for its part of the turn; null keeps the look the team status gives it. */
export function seatState(role: RoleView): AgentAvatarState | null {
  const r = settled(role);
  switch (r.status) {
    case "thinking":
      return "thinking";
    case "delivered":
      return "success";
    case "failed": {
      const failure = r.failure ?? "other";
      if (failure === "stopped") return "idle";
      return WARNINGS.has(failure) ? "warning" : "error";
    }
    default:
      return null;
  }
}

/** A card's clock: whole seconds while the role works, the time it took with one decimal once it is done. */
export function cardTime(view: Pick<TurnView, "live" | "waking" | "waiting">, role: RoleView, now: number): string {
  const r = settled(role);
  if (r.status === "thinking") return r.startedAt === undefined ? "" : `${Math.max(0, Math.floor((now - r.startedAt) / 1000))} s`;
  if (r.status === "waiting") return view.live ? (view.waking && view.waiting.includes(r.role) ? "waking" : "waiting") : "";
  const ms = r.ms ?? 0;
  return ms > 0 ? `${(ms / 1000).toFixed(1)} s` : "";
}

export type CardTone = "waiting" | "active" | "done" | "warn" | "error" | "dim";

export interface CardLook {
  role: string;
  /** "Scout" */
  name: string;
  /** "01 · SCOUT" */
  title: string;
  status: RoleStatus;
  tone: CardTone;
  /** "12 s" while it works, "18.2 s" once it is done, "waiting" before its part. */
  time: string;
  steps: CardStep[];
  metric: CardMetric | null;
  /** The portrait's state for this part of the turn, or null to keep the team's. */
  avatar: AgentAvatarState | null;
  /** A delivered Auditor waits on the person's signature for its receipt. */
  receiptSlot: boolean;
  /** Once the person signed an order from the turn's plan, its receipt on the Auditor's card: "Signed · NVDA 50". */
  receipt?: { text: string; status: TurnReceipt["status"]; hash: string; explorerUrl?: string };
  /** What the card says once it folds into a chip. */
  chip: string;
  /** "Scout: NVDA / TOP PICK" */
  summary: string;
  /** The exact reason there is no answer. */
  detail?: string;
}

/**
 * A role's card at a given moment, or null when the role has no part in this
 * turn. `receipt` says the person signed an order after the turn; given the
 * receipt itself, the Auditor's card shows it.
 */
export function cardLook(view: TurnView, role: string, opts: { index: number; now: number; receipt?: boolean | TurnReceipt | null }): CardLook | null {
  const raw = view.roles[role];
  if (!raw) return null;
  const r = settled(raw);
  const name = roleConfig(role).label;
  const metric = metricFor(view, r);
  const avatar = seatState(r);
  const time = cardTime(view, r, opts.now);
  const signed = Boolean(opts.receipt);
  const states = stepStates(r, signed);
  const tone: CardTone =
    r.status === "thinking" ? "active" : r.status === "delivered" ? "done" : r.status === "waiting" ? "waiting" : avatar === "warning" ? "warn" : avatar === "error" ? "error" : "dim";
  const working = r.status === "thinking" ? `thinking${time ? `, ${time}` : ""}` : time || "waiting";
  return {
    role,
    name,
    title: `${String(opts.index).padStart(2, "0")} · ${name.toUpperCase()}`,
    status: r.status,
    tone,
    time,
    steps: stepLabels(role).map((label, i) => ({ label, state: states[i] ?? "idle" })),
    metric,
    avatar,
    receiptSlot: role === "auditor" && r.status === "delivered" && !signed,
    ...(role === "auditor" && typeof opts.receipt === "object" && opts.receipt ? { receipt: receiptOn(opts.receipt) } : {}),
    // A delivered role folds to its result; one without an answer, to why.
    chip: metric ? (r.status === "delivered" ? metric.value : metric.label) : r.status === "thinking" ? time || "thinking" : time || "waiting",
    summary: `${name}: ${metric ? metricText(metric) : working}`,
    ...(r.status === "failed" && r.detail ? { detail: r.detail } : {}),
  };
}

/** A receipt as the Auditor's card shows it. */
const receiptOn = (r: TurnReceipt): NonNullable<CardLook["receipt"]> => ({
  text: `Signed · ${receiptLine(r)}`,
  status: r.status,
  hash: r.hash,
  ...(r.explorerUrl ? { explorerUrl: r.explorerUrl } : {}),
});

export type CardsMode = "none" | "open" | "chips";

/** Whether the seats show cards: none before the turn opens, open while it runs and a moment after, chips from then on. */
export function cardsMode(view: TurnView, now: number): CardsMode {
  if (!view.turnId || !view.order.length) return "none";
  if (view.live) return "open";
  return now - (view.endedAt ?? now) < FOLD_AFTER_MS ? "open" : "chips";
}

export type Handoff = "none" | "flowing" | "fading";

/** The beams from the first roles to the next ones: flowing while the next ones work, fading once the turn is over. */
export function handoffOf(view: TurnView, now: number): Handoff {
  const reached = view.order.some((role) => {
    const r = view.roles[role];
    return r?.phase === 2 && asked(r);
  });
  if (!view.turnId || !reached) return "none";
  if (view.live) return "flowing";
  return now - (view.endedAt ?? now) < BEAMS_AFTER_MS ? "fading" : "none";
}

/**
 * What the conversation holds of a turn: whether it holds it at all (a new
 * chat or a saved one does not), and which roles have a line of it there for
 * Focus to bring into view.
 */
export function chatOfTurn(messages: readonly Message[], turnId: string | null): { held: boolean; lines: Set<string> } {
  const lines = new Set<string>();
  let held = false;
  if (!turnId) return { held, lines };
  for (const m of messages) {
    if (m.role === "user" || m.turnId !== turnId) continue;
    held = true;
    if (m.role === "team" && (m.kind === "agent" || m.kind === "guest")) lines.add(m.who);
  }
  return { held, lines };
}

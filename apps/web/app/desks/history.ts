/**
 * How History reads a kept desk turn: when it ran, the cards as they ended,
 * why it went that way, and what each agent said or the exact reason it said
 * nothing.
 *
 * Pure, so the sheet and the tests read a turn the same way. The cards come
 * from the same reading as the seats (turnLook), so a runtime's failure text
 * never reads as an answer here either.
 */

import { failureLabel } from "../lib/turnFailure";
import type { FailureKind, RiskLevel, TurnRecord, TurnRow, Verdict } from "../lib/turnRecord";
import { roleConfig } from "../team/avatarIdentity";
import { seatState, settled } from "../turn/turnLook";
import { idleTurn, type RoleView, type TurnView } from "../turn/turnState";

/** What the list answers: whether memory keeps the turns, the turn running now, and the turns newest first. */
export interface HistoryList {
  memory: "on" | "off";
  live: string | null;
  turns: TurnRow[];
}

/** Said at the top of History while memory is off. */
export const MEMORY_OFF_NOTE = "Memory is off, so History keeps this session only. Turn memory on to keep every turn.";

/** How many turns the list asks for. */
export const HISTORY_LIMIT = 40;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "14:32", in local time. */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Today", "Yesterday", "Sep 24", or "Sep 24, 2025" in another year. */
export function dayOf(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date}, ${d.getFullYear()}`;
}

/** "71.4 s" */
export const secondsOf = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "Model failed: API call failed after 3 retries: HTTP 502: upstream_failed". The reason stays as it was given. */
export function failureText(failure: FailureKind | undefined, detail?: string): string {
  const label = capital(failureLabel(failure ?? "other"));
  const reason = detail?.trim();
  return reason ? `${label}: ${reason}` : label;
}

/** A kept turn as the cards read it once it is over: every role as it ended, nothing live. */
export function replayView(record: TurnRecord): TurnView {
  const roles: Record<string, RoleView> = {};
  const order: string[] = [];
  for (const r of record.replies) {
    if (roles[r.role]) continue;
    const started = r.startedAt ? Date.parse(r.startedAt) : Number.NaN;
    const failure = r.ok ? null : (r.failure ?? "other");
    roles[r.role] = {
      role: r.role,
      phase: r.phase,
      status: r.ok ? "delivered" : "failed",
      ms: r.ms,
      reply: r.reply,
      ...(r.agentName ? { agentName: r.agentName } : {}),
      ...(Number.isFinite(started) ? { startedAt: started } : {}),
      ...(failure ? { failure, label: failureLabel(failure) } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.role === "risk" && record.riskLevel ? { riskLevel: record.riskLevel } : {}),
      ...(r.role === "risk" && record.verdict ? { verdict: record.verdict } : {}),
    };
    order.push(r.role);
  }
  const started = Date.parse(record.startedAt);
  const startedAt = Number.isFinite(started) ? started : null;
  return {
    ...idleTurn,
    turnId: record.id,
    kind: record.kind,
    question: record.question,
    principal: record.principal,
    facts: record.facts,
    roles,
    order,
    steps: record.trace.map((s) => ({ at: Date.parse(s.at) || 0, text: s.text })),
    startedAt,
    endedAt: startedAt === null ? null : startedAt + record.ms,
    flags: record.flags,
    stopped: record.stopped === true,
    error: record.error ?? null,
    ...(record.riskLevel ? { riskLevel: record.riskLevel } : {}),
    ...(record.verdict ? { verdict: record.verdict } : {}),
  };
}

export type PartTone = "done" | "warn" | "error" | "dim";

/** One agent's part of a kept turn: its whole answer, or why there is none. */
export interface AgentPart {
  role: string;
  /** "Scout" */
  name: string;
  agentName?: string;
  /** "18.2 s", or "" when it was never asked. */
  time: string;
  ok: boolean;
  /** The answer as the agent wrote it, [Fn] tags and all. */
  text: string;
  /** The label and the verbatim reason, when there is no answer. */
  failure?: string;
  tone: PartTone;
}

/** Each agent's part, in the order the turn ran them. */
export function partsOf(record: TurnRecord): AgentPart[] {
  const view = replayView(record);
  return view.order.map((role) => {
    const r = settled(view.roles[role]!);
    const base = { role, name: roleConfig(role).label, ...(r.agentName ? { agentName: r.agentName } : {}), time: r.ms && r.ms > 0 ? secondsOf(r.ms) : "" };
    if (r.status === "delivered") return { ...base, ok: true, text: r.reply ?? "", tone: "done" as const };
    const state = seatState(r);
    const tone: PartTone = state === "warning" ? "warn" : state === "error" ? "error" : "dim";
    return { ...base, ok: false, text: "", failure: failureText(r.failure, r.detail), tone };
  });
}

/** One line of the Why block. */
export interface WhyLine {
  /** risk, trader, auditor or sparky */
  who: string;
  /** "Risk", "Trader's plan", "Auditor's record", "Sparky's summary" */
  label: string;
  /** One line of what they said, or why there is nothing. */
  text: string;
  /** Nothing was said: the text says why. */
  missing: boolean;
  level?: RiskLevel;
  verdict?: Verdict;
}

/** How much of an agent's answer the Why block shows; the whole answer is further down. */
export const WHY_CHARS = 280;
/** How much of Sparky's summary it shows. */
export const SUMMARY_CHARS = 600;

const LEADING_MENTIONS = /^(?:@[A-Za-z][A-Za-z-]{1,31}\b[\s,:]*)+/;
const RISK_LEVEL = /^\s*RISK:\s*(?:low|medium|high)\b[\s.,:;–-]*/im;

/** One line, without the names it opens with: "@Trader @Auditor NVDA can take ..." reads "NVDA can take ...". */
function digest(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().replace(LEADING_MENTIONS, "").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const WHY: Array<{ role: string; label: string }> = [
  { role: "risk", label: "Risk" },
  { role: "trader", label: "Trader's plan" },
  { role: "auditor", label: "Auditor's record" },
];

/**
 * Why the turn went the way it did: Risk's line, the Trader's plan, the
 * Auditor's record and Sparky's summary. A role the turn did not have is left
 * out; one that gave no answer says why.
 */
export function whyOf(record: TurnRecord): WhyLine[] {
  const view = replayView(record);
  const lines: WhyLine[] = [];
  for (const { role, label } of WHY) {
    const raw = view.roles[role];
    if (!raw) continue;
    const r = settled(raw);
    if (r.status !== "delivered") {
      lines.push({ who: role, label, text: `No answer: ${failureLabel(r.failure ?? "other")}`, missing: true });
      continue;
    }
    const reply = role === "risk" ? (r.reply ?? "").replace(RISK_LEVEL, "") : (r.reply ?? "");
    lines.push({
      who: role,
      label,
      text: digest(reply, WHY_CHARS),
      missing: false,
      ...(role === "risk" && record.riskLevel ? { level: record.riskLevel } : {}),
      ...(role === "risk" && record.verdict ? { verdict: record.verdict } : {}),
    });
  }
  const summary = record.summary?.trim();
  if (summary) lines.push({ who: "sparky", label: "Sparky's summary", text: digest(summary, SUMMARY_CHARS), missing: false });
  else {
    const why = record.stopped ? "No summary: you stopped waiting for the team." : "No summary was kept for this turn.";
    lines.push({ who: "sparky", label: "Sparky's summary", text: why, missing: true });
  }
  return lines;
}

/** "[F1] NVDA (NVIDIA): 181.20 USDG ..." as its number and its text. */
export function factParts(line: string): { n: number | null; text: string } {
  const m = line.match(/^\[F(\d{1,3})\]\s*(.*)$/s);
  return m ? { n: Number(m[1]), text: m[2] ?? "" } : { n: null, text: line };
}

/**
 * A desk turn as Memory reads it: a decision.
 *
 * Memory lists a desk's turns under "Decisions" and opens each one as a
 * readable account: the question, each agent's line or why it gave none, the
 * plan, the record and Sparky's summary. The daily summary keeps each one in
 * four lines: the question, the risk, the plan and the record. The plan is
 * the Trader's answer and the record the Auditor's.
 *
 * The summary's lines never carry a transaction hash, an address or a link to
 * one: the summary prompt forbids them, and a line the model reads is a line
 * it may repeat.
 *
 * No Node imports: the memory route and the summary build these, and the
 * memory panel reads them.
 */

import { failureLabel, runtimeFailure } from "./turnFailure";
import { isTurnId, isTurnKind, roleName, withoutFactTags, type FailureKind, type RiskLevel, type RoleReply, type TurnKind, type TurnRecord, type Verdict } from "./turnRecord";

export const KIND_NAMES: Record<TurnKind, string> = { analyze: "Analyze", advise: "Advise", order: "Order" };

/** What a list shows of one answer, in characters. */
const LINE = 160;
/** What the summary gets of each line of a decision. */
const SUMMARY_LINE = 240;
/** A first sentence shorter than this runs on into the next one. */
const SHORT = 24;
/** What a list keeps of the question. */
const QUESTION = 200;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pad = (n: number) => String(n).padStart(2, "0");
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** One agent's part of a turn. */
export interface DecisionAgent {
  role: string;
  /** "Scout" */
  name: string;
  /** 1 reads the facts, 2 plans and records with what the first ones said. */
  phase: 1 | 2;
  ok: boolean;
  /** The answer's first sentence, or why there is none: "model failed". */
  line: string;
  /** The exact reason there is no answer. */
  detail?: string;
  /** "18.2 s"; absent when the role never started. */
  time?: string;
}

/** A turn in a desk's list of decisions. */
export interface DecisionRow {
  kind: TurnKind;
  question: string;
  startedAt: string;
  riskLevel?: RiskLevel;
  verdict?: Verdict;
  /** What came of it, in one line. */
  outcome: string;
  /** Agents that answered. */
  answered: number;
  /** Agents that gave no answer. */
  missing: number;
  /** Each agent in the order they ran, and whether it answered. */
  voices: { role: string; ok: boolean }[];
  stopped?: boolean;
}

/** A whole turn, as Memory reads it. */
export interface Decision extends DecisionRow {
  /** "71.4 s" */
  time: string;
  agents: DecisionAgent[];
  /** The Trader's answer, whole. */
  plan?: string;
  /** Why the Trader gave no plan: "model failed". */
  planMissing?: string;
  /** The Auditor's answer, whole. */
  record?: string;
  /** Why the Auditor gave no record. */
  recordMissing?: string;
  /** Sparky's closing message. */
  summary?: string;
  /** "NVDA 50, success": the order the person signed after the turn, without its hash. */
  signed?: string;
  /** Why the turn ended early. */
  ended?: string;
  /** The answer checks, readable: "Auditor · no answer". */
  checks: string[];
}

const isReply = (v: unknown): v is RoleReply =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RoleReply).role === "string" &&
  typeof (v as RoleReply).ok === "boolean" &&
  typeof (v as RoleReply).reply === "string";

/** The record kept with a turn note, or null when the note holds none. */
export function asTurnRecord(v: unknown): TurnRecord | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Partial<TurnRecord>;
  const whole =
    r.v === 1 &&
    isTurnId(r.id) &&
    isTurnKind(r.kind) &&
    typeof r.question === "string" &&
    typeof r.startedAt === "string" &&
    Array.isArray(r.replies) &&
    r.replies.every(isReply);
  if (!whole) return null;
  return {
    ...(v as TurnRecord),
    guests: Array.isArray(r.guests) ? r.guests.filter(isReply) : [],
    flags: Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === "string") : [],
  };
}

/** Explorer links, then "0x" and hex digits: hashes and addresses, whole or shortened like "0x12ab…9f". */
const HASHES = [
  /\bhttps?:\/\/\S*?(?:0x[0-9a-f]{6}|\/tx\/|\/address\/)\S*/gi,
  /(?<![0-9a-z])0x[0-9a-f]{3,}(?:…|\.\.\.)[0-9a-f]*/gi,
  /(?<![0-9a-z])0x[0-9a-f]{6,}/gi,
];

/** A text without transaction hashes, addresses or the explorer links that carry them. */
export function withoutHashes(text: string): string {
  let out = text;
  for (const re of HASHES) out = out.replace(re, "");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** How an answer opens, and Memory leaves out: its "RISK:" or "VERDICT:" line and the @mentions. */
const OPENING = /^(?:(?:RISK:\s*(?:low|medium|high)|VERDICT:\s*(?:GO|BLOCK))\b[.:,;]?\s*|@[\w-]+[\s,:;]*)+/i;

/** An answer to read whole: its lines kept, without [Fn] tags, and without the "RISK:" line or the @mentions it opens with. */
export function readableAnswer(reply: string): string {
  const lines = withoutFactTags(reply)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim());
  return capital(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().replace(OPENING, "").trim());
}

/** An answer in one line, as a list shows it. */
export const plainAnswer = (reply: string) => oneLine(readableAnswer(reply));

/** The first sentence of a text, running on while it is shorter than a few words, cut at `max`. */
export function firstSentence(text: string, max = LINE): string {
  const t = oneLine(text);
  const ends = /[.!?](?=\s|$)/g;
  let cut = t.length;
  for (let m = ends.exec(t); m; m = ends.exec(t)) {
    if (m.index + 1 >= SHORT) {
      cut = m.index + 1;
      break;
    }
  }
  return clip(t.slice(0, cut), max);
}

/** "auditor:no-answer" reads "Auditor · no answer". */
export function checkName(flag: string): string {
  const at = flag.indexOf(":");
  if (at < 0) return flag.replace(/-/g, " ");
  return `${roleName(flag.slice(0, at))} · ${flag.slice(at + 1).replace(/-/g, " ")}`;
}

/** Why a role gave no answer, or null when it answered. A runtime's failure text never counts as an answer. */
function missingReason(r: RoleReply): FailureKind | null {
  if (!r.ok) return r.failure ?? "other";
  if (!r.reply.trim()) return "empty";
  return runtimeFailure(r.reply);
}

function agentOf(r: RoleReply): DecisionAgent {
  const base = { role: r.role, name: roleName(r.role), phase: r.phase, ...(r.ms > 0 ? { time: seconds(r.ms) } : {}) };
  const missing = missingReason(r);
  if (missing) {
    const detail = oneLine(r.detail ?? (r.ok ? r.reply : ""));
    return { ...base, ok: false, line: failureLabel(missing), ...(detail ? { detail } : {}) };
  }
  return { ...base, ok: true, line: firstSentence(plainAnswer(r.reply) || oneLine(r.reply)) };
}

/** What one house role gave: its answer to read whole, or why there is none. Nothing when the turn did not ask it. */
function partOf(r: TurnRecord, role: string): { text?: string; missing?: string } {
  const reply = r.replies.find((x) => x.role === role);
  if (!reply) return {};
  const missing = missingReason(reply);
  if (missing) return { missing: failureLabel(missing) };
  return { text: readableAnswer(reply.reply) || reply.reply.trim() };
}

function outcomeOf(r: TurnRecord, agents: DecisionAgent[], parts: { plan?: string; record?: string; summary?: string }): string {
  const answered = agents.filter((a) => a.ok);
  if (r.error && !answered.length) return clip(`Ended early: ${oneLine(r.error.message)}`, LINE);
  if (parts.summary) return firstSentence(parts.summary);
  if (parts.plan) return `Plan: ${firstSentence(parts.plan, LINE - 6)}`;
  if (parts.record) return `Record: ${firstSentence(parts.record, LINE - 8)}`;
  const first = answered[0];
  if (first) return clip(`${first.name}: ${first.line}`, LINE);
  if (r.stopped) return "Stopped waiting before the team answered.";
  const why = agents[0]?.line;
  return why ? `No answer from the team: ${why}.` : "No answer from the team.";
}

/** A turn as Memory reads it. */
export function decisionOf(r: TurnRecord): Decision {
  const agents = [...r.replies, ...r.guests].map(agentOf);
  const plan = partOf(r, "trader");
  const record = partOf(r, "auditor");
  const summary = r.summary?.trim() ? readableAnswer(r.summary) : "";
  const answered = agents.filter((a) => a.ok).length;
  return {
    kind: r.kind,
    question: r.question.trim(),
    startedAt: r.startedAt,
    ...(r.riskLevel ? { riskLevel: r.riskLevel } : {}),
    ...(r.verdict ? { verdict: r.verdict } : {}),
    outcome: outcomeOf(r, agents, { ...(plan.text ? { plan: plan.text } : {}), ...(record.text ? { record: record.text } : {}), ...(summary ? { summary } : {}) }),
    answered,
    missing: agents.length - answered,
    voices: agents.map((a) => ({ role: a.role, ok: a.ok })),
    ...(r.stopped ? { stopped: true } : {}),
    time: seconds(r.ms ?? 0),
    agents,
    ...(plan.text ? { plan: plan.text } : {}),
    ...(plan.missing ? { planMissing: plan.missing } : {}),
    ...(record.text ? { record: record.text } : {}),
    ...(record.missing ? { recordMissing: record.missing } : {}),
    ...(summary ? { summary } : {}),
    ...(r.receipt ? { signed: `${r.receipt.ticker} ${r.receipt.amount}, ${r.receipt.status}` } : {}),
    ...(r.error ? { ended: oneLine(r.error.message) } : {}),
    checks: r.flags.map(checkName),
  };
}

/** What a desk's list of decisions shows of a turn. */
export function decisionRow(r: TurnRecord): DecisionRow {
  const d = decisionOf(r);
  return {
    kind: d.kind,
    question: clip(oneLine(d.question), QUESTION),
    startedAt: d.startedAt,
    ...(d.riskLevel ? { riskLevel: d.riskLevel } : {}),
    ...(d.verdict ? { verdict: d.verdict } : {}),
    outcome: d.outcome,
    answered: d.answered,
    missing: d.missing,
    voices: d.voices,
    ...(d.stopped ? { stopped: true } : {}),
  };
}

/**
 * A decision as the daily summary reads it, one line each: the question, the
 * risk, the plan and the record. Never a hash, an address or a link to one.
 *
 *   Question (14:32, analyze): How is NVDA doing today?
 *   Risk: medium
 *   Plan: Wait for a pullback to 178 USDG, then buy 50 USDG.
 *   Record: none (the Auditor did not answer: model failed)
 */
export function decisionLines(r: TurnRecord): string {
  const d = decisionOf(r);
  const safe = (s: string) => clip(withoutHashes(oneLine(s)), SUMMARY_LINE);
  const at = new Date(r.startedAt);
  const when = Number.isNaN(at.getTime()) ? r.kind : `${pad(at.getHours())}:${pad(at.getMinutes())}, ${r.kind}`;
  const none = (role: string, label?: string) =>
    `none (${label ? `the ${role} did not answer: ${label}` : d.ended ? "the turn ended early" : `no ${role} in this turn`})`;
  const risk = [d.riskLevel ?? (d.verdict ? "" : "not rated"), d.verdict ? `verdict ${d.verdict}` : ""].filter(Boolean).join(", ");
  const signed = d.signed ? ` Signed ${withoutHashes(d.signed)}.` : "";
  return [
    `Question (${when}): ${safe(r.question)}`,
    `Risk: ${risk}`,
    `Plan: ${d.plan ? safe(d.plan) : none("Trader", d.planMissing)}`,
    `Record: ${d.record ? safe(d.record) : none("Auditor", d.recordMissing)}${signed}`,
  ].join("\n");
}

/**
 * A day's decisions for the daily summary, oldest first, in at most `max`
 * characters. When they do not all fit, the newest are the ones kept.
 */
export function decisionsBlock(records: TurnRecord[], date: string, max: number): string {
  const head = `Desk decisions of ${date}, oldest first. Keep each one under Decisions, in one short line with its risk, plan and record:`;
  const kept: string[] = [];
  // Room for the note on what was left out.
  let used = head.length + 40;
  for (const r of [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const entry = decisionLines(r);
    if (used + entry.length + 2 > max) break;
    kept.unshift(entry);
    used += entry.length + 2;
  }
  if (!kept.length) return "";
  const left = records.length - kept.length;
  return [`${head}${left ? ` (${left} earlier left out)` : ""}`, ...kept].join("\n\n");
}

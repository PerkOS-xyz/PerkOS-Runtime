/**
 * A desk turn, as the route streams it and as History keeps it.
 *
 * When the person gives a desk a task, the desk's team works it in two
 * phases: the first roles read the facts, the next ones plan and record with
 * what the first ones said. Every step is streamed to the window as an event,
 * and the whole turn is kept as one record: what was asked, the facts and
 * prompts as sent, each answer or the exact reason there was none.
 *
 * No Node imports: the route writes these, and the chat, the cards and
 * History read them.
 */

import type { TeamStatus } from "@perkos/client";

export const TURN_KINDS = ["analyze", "advise", "order"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];
export const isTurnKind = (v: unknown): v is TurnKind => typeof v === "string" && (TURN_KINDS as readonly string[]).includes(v);

export type RiskLevel = "low" | "medium" | "high";
export type Verdict = "GO" | "BLOCK";

/**
 * Why a role gave no answer. Each one has its own label, because each one
 * asks the person for something different: wait, add desk time, ask an admin,
 * bring a model key, or nothing at all.
 */
export type FailureKind =
  | "timeout"
  | "offline"
  | "not_set_up"
  /** PerkOS is still creating the agent. */
  | "setting_up"
  /** The agent exists and failed to start. */
  | "start_failed"
  | "model"
  | "no_time"
  | "approval"
  | "byok"
  | "network"
  | "empty"
  | "stopped"
  | "other";

/** The house roles, in the order a turn runs them: the first two read, the next two plan and record. */
export const TURN_PHASES: readonly [readonly string[], readonly string[]] = [
  ["scout", "risk"],
  ["trader", "auditor"],
];

export interface RoleReply {
  /** scout, risk, trader, auditor */
  role: string;
  /** "eqlty-scout-1a2b3c4d" */
  agentName?: string;
  phase: 1 | 2;
  ok: boolean;
  /** "" when there is no answer. */
  reply: string;
  /** The exact reason from PerkOS or the runtime when there is no answer. Never "reply len=N". */
  detail?: string;
  failure?: FailureKind;
  /** 0 when the role never started. */
  ms: number;
  startedAt?: string;
}

export type TurnErrorCode =
  | "TEAM_NOT_SET_UP"
  | "NO_DESK_TIME"
  | "INFRA_APPROVAL_REQUIRED"
  | "LLM_BYOK_REQUIRED"
  | "TEAM_ASLEEP"
  | "TEAM_SETTING_UP"
  | "TEAM_FAILED"
  | "TEAM_UNREACHABLE"
  | "DESK_MARKET"
  | "SIGNED_OUT"
  | "INTERNAL";

/** One line of the "Sparky · working" checklist. */
export interface TurnStep {
  at: string;
  text: string;
}

export type TurnEvent =
  | {
      step: "open";
      turnId: string;
      kind: TurnKind;
      desk: string;
      question: string;
      /** Sparky's line to the first roles: "@Scout @Risk <question> Facts attached: ..." */
      principal: string;
      facts: string[];
      roles: string[];
      at: string;
    }
  | {
      step: "wake";
      status: TeamStatus;
      ready: string[];
      /** Roles the turn is still waiting for. Empty once the team is up or the wait is over. */
      waiting: string[];
      waitedMs: number;
      /** True once the turn has asked PerkOS to wake the team. */
      woke: boolean;
    }
  | { step: "working"; at: string; text: string }
  | { step: "phase"; phase: 1 | 2; roles: string[]; at: string }
  | { step: "start"; role: string; phase: 1 | 2; at: string; agentName?: string }
  | ({ step: "reply"; riskLevel?: RiskLevel; verdict?: Verdict } & RoleReply)
  /** Follows every reply that is not ok, mid-turn or when the whole team could not take part: "X did not answer". */
  | { step: "failure"; role: string; phase: 1 | 2; failure: FailureKind; label: string; detail?: string }
  | {
      step: "done";
      turnId: string;
      replies: RoleReply[];
      flags: string[];
      ms: number;
      kept: "vault" | "session";
      riskLevel?: RiskLevel;
      verdict?: Verdict;
      stopped?: boolean;
      error?: TurnErrorCode;
    }
  /**
   * Why the turn ended early. Before the turn opens (the desk's market did not
   * answer, or no asset has a price) this is the only frame: no `open`, no
   * `done`, and nothing is kept. After `open`, a `done` always follows it.
   */
  | { step: "error"; code: TurnErrorCode; message: string };

export interface TurnReceipt {
  hash: string;
  explorerUrl?: string;
  status: "success" | "reverted" | "pending";
  ticker: string;
  amount: string;
  at: string;
}

export interface TurnRecord {
  v: 1;
  /** "20260926-143205-ab12": sorts by time, and names the record in the vault. */
  id: string;
  /** The desk's id: "eqlty-desk". */
  desk: string;
  /** The desk's module: "stocks-robinhood". */
  module: string;
  kind: TurnKind;
  question: string;
  principal: string;
  startedAt: string;
  endedAt: string;
  ms: number;
  /** The [Fn] lines as sent. */
  facts: string[];
  /** What the desk's memory added, as sent. */
  memory: string;
  /** The part every role got, as sent. */
  head: string;
  /** Per role, what followed the head: the handoff, if any, and the desk's prompt for the role. */
  prompts: Record<string, string>;
  /** House roles, in the order they ran. */
  replies: RoleReply[];
  /** Invited guests; none yet. */
  guests: RoleReply[];
  riskLevel?: RiskLevel;
  /** Order turns only. */
  verdict?: Verdict;
  /** "auditor:no-answer", "scout:no-citation", ... */
  flags: string[];
  /** The working checklist, as the person saw it. */
  trace: TurnStep[];
  /** Sparky's closing message. */
  summary?: string;
  /** The person stopped waiting. The agents were not cancelled and may have finished on PerkOS. */
  stopped?: boolean;
  /** Why the turn ended early, when it did. */
  error?: { code: TurnErrorCode; message: string };
  receipt?: TurnReceipt;
}

/** A turn as History lists it; the whole record comes when the person opens it. */
export interface TurnRow {
  id: string;
  kind: TurnKind;
  question: string;
  startedAt: string;
  ms: number;
  riskLevel?: RiskLevel;
  verdict?: Verdict;
  /** How many checks flagged the answers. */
  flags: number;
  /** The roles that gave no answer. */
  failed: string[];
  /** The person signed an order after the turn. */
  signed: boolean;
  /** The person stopped waiting; the agents were not cancelled. */
  stopped?: boolean;
  /** Why the turn ended early, when it did. */
  error?: TurnErrorCode;
}

const KIND_LABEL: Record<TurnKind, string> = { analyze: "Analyze", advise: "Advise", order: "Order" };

/** "Scout" for "scout". */
export const roleName = (role: string) => (role ? role[0]!.toUpperCase() + role.slice(1) : role);

const pad = (n: number) => String(n).padStart(2, "0");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/**
 * An answer without its [Fn] tags. Each turn numbers its own facts, so a tag
 * kept in a note would point at another turn's fact once it is recalled, and
 * Sparky would read it aloud.
 */
// Single tags and grouped ones: "[F1]", "[F1, F2]", "[F1-F3]", "[F1–3]".
export const withoutFactTags = (s: string) => s.replace(/\s*\[F\d+(?:\s*[,–-]\s*F?\d+)*\]/g, "");

/** A new turn id from the local time: "20260926-143205-ab12". */
export function newTurnId(at = new Date(), random = () => Math.random()): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const tail = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${day}-${time}-${tail}`;
}

export const isTurnId = (v: unknown): v is string => typeof v === "string" && /^\d{8}-\d{6}-[0-9a-f]{4}$/.test(v);

/** "2026-09-26 14:32 How is NVDA doing today?", in local time. */
export function turnTitle(record: Pick<TurnRecord, "startedAt" | "question">): string {
  const at = new Date(record.startedAt);
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const q = oneLine(record.question);
  return `${when} ${q.length > 60 ? `${q.slice(0, 59).trimEnd()}…` : q}`;
}

/**
 * The readable account of a turn: what Memory shows and search finds. The
 * full record travels beside it, sealed and not searched, with the answers as
 * sent, [Fn] tags included, for History.
 *
 *   Asked: How is NVDA doing today?
 *   Analyze · Risk medium · 71.4 s
 *   Scout (18.2 s): @Trader @Auditor NVDA trades at 181.20 USDG ...
 *   Auditor: no answer, model failed (API call failed after 3 retries: HTTP 502: upstream_failed)
 *   Sparky: The desk reads NVDA as ...
 *   Checks: auditor:no-answer
 */
export function turnBody(record: TurnRecord, label: (failure: FailureKind) => string): string {
  const head = [KIND_LABEL[record.kind]];
  if (record.riskLevel) head.push(`Risk ${record.riskLevel}`);
  if (record.verdict) head.push(`Verdict ${record.verdict}`);
  head.push(seconds(record.ms));
  if (record.stopped) head.push("stopped");
  const lines = [`Asked: ${oneLine(record.question)}`, head.join(" · ")];
  if (record.error) lines.push(`Ended early: ${record.error.message}`);
  for (const r of [...record.replies, ...record.guests]) {
    const who = roleName(r.role);
    if (r.ok) lines.push(`${who} (${seconds(r.ms)}): ${oneLine(withoutFactTags(r.reply))}`);
    else lines.push(`${who}: no answer, ${label(r.failure ?? "other")}${r.detail ? ` (${oneLine(r.detail)})` : ""}`);
  }
  if (record.summary?.trim()) lines.push(`Sparky: ${oneLine(withoutFactTags(record.summary))}`);
  if (record.receipt) lines.push(`Signed: ${record.receipt.ticker} ${record.receipt.amount}, ${record.receipt.status}`);
  if (record.flags.length) lines.push(`Checks: ${record.flags.join(", ")}`);
  return lines.join("\n");
}

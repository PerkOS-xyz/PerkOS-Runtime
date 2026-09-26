/**
 * Why an agent gave no answer, in one word the cards and History can show.
 *
 * PerkOS reports a runtime's failure in more than one shape. The task can come
 * back `ok: false` with PerkOS's own reason, PerkOS can refuse the task with a
 * code, the call can go unanswered, and some runtimes send their failure text
 * as a normal reply. That last one is the reason this file exists: "API call
 * failed after 3 retries" must never show as a delivered answer.
 *
 * No Node imports: the route classifies, and the cards and History label.
 */

import type { FailureKind } from "./turnRecord";

/** A runtime's failure, sent as if it were a reply. Matched at the start of the reply. */
const RUNTIME_FAILURES: Array<[RegExp, FailureKind]> = [
  [/^API call failed after \d+ retr(?:y|ies)\b/i, "model"],
  [/^Invalid API response after \d+ retr(?:y|ies)\b/i, "model"],
  [/^Stream repeatedly dropped mid tool-call\b/i, "model"],
  [/^I apologize, but I encountered repeated errors\b/i, "model"],
  [/^I apologize, but I encountered an error while processing the model response\b/i, "model"],
  [/^I reached the maximum iterations\b/i, "model"],
  [/^Operation interrupted: waiting for model response\b/i, "model"],
  [/^Operation interrupted\b/i, "model"],
  [/^Billing or credits exhausted:/i, "model"],
  [/^Provider reported usage\/credit exhaustion\b/i, "model"],
  [/^Session is shutting down\b/i, "offline"],
];

/** PerkOS's reasons for a task that came back without an answer. */
const DETAILS: Array<[RegExp, FailureKind]> = [
  [/^timed out after \d+\s*ms\b/i, "timeout"],
  [/not connected to relay/i, "offline"],
  [/^agent is not ready\b/i, "offline"],
  [/^runtime delivery failed\b/i, "model"],
  [/upstream_failed/i, "model"],
  [/^runtime task (?:failed|canceled|cancelled|rejected)\b/i, "model"],
  [/^relay connect failed\b/i, "network"],
  [/^relay disconnected\b/i, "network"],
  [/^relay error\b/i, "network"],
  [/^empty reply from\b/i, "empty"],
  [/^\(empty reply from .+ runtime\)$/i, "empty"],
];

/** PerkOS's refusal codes. */
const CODES: Record<string, FailureKind> = {
  AGENT_NOT_READY: "offline",
  INFRA_PAYMENT_REQUIRED: "no_time",
  INFRA_CREDITS_EXHAUSTED: "no_time",
  PAYMENT_REQUIRED: "no_time",
  INFRA_APPROVAL_REQUIRED: "approval",
  LLM_BYOK_REQUIRED: "byok",
  PERKOS_TIMEOUT: "timeout",
  PERKOS_UNREACHABLE: "network",
  PERKOS_ABORTED: "stopped",
};

const LABELS: Record<FailureKind, string> = {
  timeout: "timed out",
  offline: "asleep",
  not_set_up: "not set up",
  setting_up: "still being set up",
  start_failed: "failed to start",
  model: "model failed",
  no_time: "no desk time",
  approval: "needs admin approval",
  byok: "needs its own model key",
  network: "not reached",
  empty: "empty reply",
  stopped: "stopped waiting",
  other: "failed",
};

/** A short label: "Auditor did not answer: model failed". Cards show it in capitals. */
export const failureLabel = (failure: FailureKind): string => LABELS[failure];

export interface Classified {
  ok: boolean;
  reply: string;
  failure?: FailureKind;
  /** The verbatim reason, when there is no answer. */
  detail?: string;
}

/** The runtime failure a reply is, or null when it reads as an answer. */
export function runtimeFailure(reply: string): FailureKind | null {
  const text = reply.trim();
  for (const [pattern, kind] of RUNTIME_FAILURES) if (pattern.test(text)) return kind;
  return null;
}

/** The failure a PerkOS reason stands for. */
export function detailFailure(detail: string): FailureKind {
  const text = detail.trim();
  for (const [pattern, kind] of DETAILS) if (pattern.test(text)) return kind;
  return "other";
}

/** What PerkOS answered for a task, read as an answer or as the reason there is none. */
export function classifyAnswer(answer: { ok: boolean; reply: string; detail?: string | undefined }): Classified {
  const reply = answer.reply.trim();
  if (answer.ok) {
    if (!reply) return { ok: false, reply: "", failure: "empty", detail: answer.detail?.trim() || "The agent answered with nothing." };
    const failed = runtimeFailure(reply);
    if (failed) return { ok: false, reply: "", failure: failed, detail: reply };
    return { ok: true, reply };
  }
  const detail = answer.detail?.trim() || (reply ? reply : "PerkOS gave no reason.");
  const failed = runtimeFailure(detail) ?? (reply ? runtimeFailure(reply) : null);
  return { ok: false, reply: "", failure: failed ?? detailFailure(detail), detail };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * A task that did not come back: PerkOS refused it, did not answer in time,
 * could not be reached, or the person stopped waiting (`stopped`).
 */
export function classifyError(err: unknown, stopped = false): { failure: FailureKind; detail: string } {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (stopped) return { failure: "stopped", detail: message || "Stopped" };
  const code = isRecord(err) && typeof err.code === "string" ? err.code : "";
  const status = isRecord(err) && typeof err.status === "number" ? err.status : 0;
  const name = isRecord(err) && typeof err.name === "string" ? err.name : "";
  const byCode = CODES[code];
  if (byCode) return { failure: byCode, detail: message };
  if (name === "TimeoutError") return { failure: "timeout", detail: message };
  if (name === "AbortError") return { failure: "stopped", detail: message };
  if (status === 402) return { failure: "no_time", detail: message };
  if (status === 409) return { failure: "offline", detail: message };
  const fromText = detailFailure(message);
  return { failure: fromText, detail: message || "The task failed." };
}

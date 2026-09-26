/**
 * One agent of a desk's team, asked one thing.
 *
 * The agent runs on PerkOS infra under the person's wallet; PerkOS relays the
 * prompt and waits for the answer. A runtime that fails still answers: PerkOS
 * reports it as `ok: false` with the runtime's own words in `detail`, and some
 * runtimes even send their failure text as a normal reply. Telling those apart
 * is the caller's job; this file only carries what PerkOS said, unchanged.
 *
 * Giving up on a question (the signal) only stops waiting here. PerkOS has no
 * way to cancel a task, so the agent may still finish it.
 */

import { PerkosApiError, type PerkosClient } from "./client.ts";

export interface AgentAnswer {
  /** What PerkOS said: true when the runtime delivered a reply. */
  ok: boolean;
  reply: string;
  /** PerkOS's or the runtime's own words about how it went. */
  detail?: string;
  agentId: string;
  agentName: string;
  /** How long the question took, as measured here. */
  ms: number;
}

export interface AskOptions {
  /** How long PerkOS waits for the agent. PerkOS accepts 5 s to 90 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** PerkOS's own limits on a task. */
export const TASK_MIN_MS = 5_000;
export const TASK_MAX_MS = 90_000;
/** The most a prompt may hold. */
export const TASK_MAX_PROMPT = 16_000;

const DEFAULT_TASK_MS = 55_000;
/** The local call waits a little longer than PerkOS, so PerkOS's own timeout is the one reported. */
const HTTP_GRACE_MS = 5_000;
const TOUCH_TIMEOUT_MS = 8_000;

export class Agents {
  constructor(
    private readonly client: PerkosClient,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Asks one agent and waits for its answer. A refusal from PerkOS (not ready,
   * no desk time, not found) is thrown as a PerkosApiError with PerkOS's code;
   * a runtime that failed comes back as an answer with `ok: false`.
   */
  async ask(agentId: string, prompt: string, options: AskOptions = {}): Promise<AgentAnswer> {
    if (!agentId) throw new PerkosApiError("Which agent?", 400, "BAD_INPUT");
    const timeoutMs = Math.min(TASK_MAX_MS, Math.max(TASK_MIN_MS, Math.round(options.timeoutMs ?? DEFAULT_TASK_MS)));
    const started = this.now();
    const body = await this.client.request<Record<string, unknown>>(`/agents/${encodeURIComponent(agentId)}/task`, {
      method: "POST",
      body: { prompt, timeoutMs },
      timeoutMs: timeoutMs + HTTP_GRACE_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const answer: AgentAnswer = {
      ok: body.ok === true,
      reply: typeof body.reply === "string" ? body.reply.trim() : "",
      agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : agentId,
      agentName: typeof body.agentName === "string" ? body.agentName : "",
      ms: Math.max(0, this.now() - started),
    };
    if (typeof body.detail === "string" && body.detail) answer.detail = body.detail;
    return answer;
  }

  /** Tells PerkOS the agent is in use, so it is not put to sleep in the middle of a turn. */
  async touch(agentId: string): Promise<void> {
    await this.client.request(`/agents/${encodeURIComponent(agentId)}/activity`, {
      method: "POST",
      body: {},
      timeoutMs: TOUCH_TIMEOUT_MS,
    });
  }
}

/**
 * A model running on the person's own machine.
 *
 * Runtime does not ship a model: one is several gigabytes, it would have to be
 * signed and notarized inside the app, and the person would still have to pick
 * which one. So this provider talks to whatever is already listening, through
 * the API every local runner already speaks, the OpenAI one.
 *
 * It looks in the obvious places (Ollama, then LM Studio) and stops at the
 * first that answers. Nothing is guessed: if none of them is up, `health()`
 * says so in a sentence the landing can show, because an option that silently
 * does nothing is worse than an option that is not offered.
 */

import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";

/** Where a local runner usually listens, in the order we try them. */
export const LOCAL_CANDIDATES = [
  { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

const PROBE_TIMEOUT_MS = 1_500;

export interface LocalProviderOptions {
  /** Skip discovery and use this one. What Settings writes when a person types a URL. */
  baseUrl?: string;
  /** Swappable for tests. */
  fetchImpl?: typeof fetch;
}

type Found = { baseUrl: string; label: string };

export class LocalAiProvider implements AiProvider {
  readonly id = "local";
  readonly label = "On this machine";

  private readonly fixed: string | undefined;
  private readonly http: typeof fetch;
  private found: Found | null = null;

  constructor(options: LocalProviderOptions = {}) {
    this.fixed = options.baseUrl?.replace(/\/+$/, "");
    this.http = options.fetchImpl ?? fetch;
  }

  /** The runner answering right now, or null when nothing is listening. */
  async discover(): Promise<Found | null> {
    if (this.found) return this.found;
    const candidates: Found[] = this.fixed
      ? [{ baseUrl: this.fixed, label: "Your own URL" }]
      : LOCAL_CANDIDATES.map((c) => ({ ...c }));
    for (const candidate of candidates) {
      try {
        const res = await this.http(`${candidate.baseUrl}/models`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        this.found = candidate;
        return candidate;
      } catch {
        // Nothing there: try the next place rather than reporting a failure.
      }
    }
    return null;
  }

  async health(): Promise<ProviderHealth> {
    const found = await this.discover();
    if (!found) {
      return {
        ok: false,
        detail: "No model is running on this machine. Install Ollama and pull a model, or point Runtime at another URL.",
      };
    }
    const models = await this.models().catch(() => []);
    if (!models.length) {
      return {
        ok: false,
        detail: `${found.label} is running but has no model yet. Pull one and it will show up here.`,
        baseUrl: found.baseUrl,
      };
    }
    return { ok: true, detail: `${found.label} is answering with ${models.length} model${models.length > 1 ? "s" : ""}.`, baseUrl: found.baseUrl };
  }

  async models(): Promise<ModelInfo[]> {
    const found = await this.discover();
    if (!found) throw new AiProviderError("No model is running on this machine", "AI_LOCAL_ABSENT");
    const res = await this.http(`${found.baseUrl}/models`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new AiProviderError(`The local model answered ${res.status}`, "AI_LOCAL_UPSTREAM");
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((m) => (typeof m.id === "string" ? { id: m.id } : null))
      .filter((m): m is ModelInfo => m !== null);
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    const found = await this.discover();
    if (!found) throw new AiProviderError("No model is running on this machine", "AI_LOCAL_ABSENT");
    const res = await this.http(`${found.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!res.ok || !res.body) {
      throw new AiProviderError(`The local model answered ${res.status}`, "AI_LOCAL_UPSTREAM");
    }
    yield* readSse(res.body);
  }
}

/** The pieces of an OpenAI-style stream, in order, ignoring everything else. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last piece may be half a line; it waits for the next read.
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> };
        const piece = parsed.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) yield piece;
      } catch {
        // A malformed line is not worth killing an answer that is arriving.
      }
    }
  }
}

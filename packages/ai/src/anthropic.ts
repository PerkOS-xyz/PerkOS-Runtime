/**
 * Claude through the Anthropic API, with the person's own API key.
 *
 * Messages API (`POST /v1/messages`) with streaming: text arrives in
 * `content_block_delta` events. System messages go in the top-level `system`
 * field. The key is read on each call and is never returned or logged.
 */

import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Used when the model list cannot be read. */
export const ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];

export interface AnthropicProviderOptions {
  /** The person's API key, or null when none is saved. */
  apiKey: () => Promise<string | null>;
  baseUrl?: string;
  /** Upper bound for a reply when the request does not set one. */
  defaultMaxTokens?: number;
  fetchImpl?: typeof fetch;
}

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";
  readonly label = "Claude (Anthropic)";

  private readonly apiKey: () => Promise<string | null>;
  private readonly baseUrl: string;
  private readonly defaultMaxTokens: number;
  private readonly http: typeof fetch;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, "");
    this.defaultMaxTokens = options.defaultMaxTokens ?? 1024;
    this.http = options.fetchImpl ?? fetch;
  }

  private headers(key: string): Record<string, string> {
    return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
  }

  async health(): Promise<ProviderHealth> {
    const key = await this.apiKey().catch(() => null);
    return key
      ? { ok: true, detail: "Using your Anthropic API key.", baseUrl: this.baseUrl }
      : { ok: false, detail: "Add your Anthropic API key to use Claude here." };
  }

  /** Models the key can use. A rejected key throws; any other failure falls back to the known list. */
  async models(): Promise<ModelInfo[]> {
    const key = await this.apiKey();
    if (!key) throw new AiProviderError("No Anthropic API key", "AI_ANTHROPIC_NO_KEY");
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl}/v1/models?limit=100`, { headers: this.headers(key), signal: AbortSignal.timeout(10_000) });
    } catch {
      return ANTHROPIC_MODELS.map((id) => ({ id }));
    }
    if (res.status === 401 || res.status === 403) throw new AiProviderError("The Anthropic API key was rejected", "AI_ANTHROPIC_UNAUTHORIZED");
    if (!res.ok) return ANTHROPIC_MODELS.map((id) => ({ id }));
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.startsWith("claude"));
    return (ids.length ? ids : ANTHROPIC_MODELS).map((id) => ({ id }));
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    const key = await this.apiKey();
    if (!key) throw new AiProviderError("No Anthropic API key", "AI_ANTHROPIC_NO_KEY");
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = request.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await this.http(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { ...this.headers(key), accept: "text/event-stream" },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? this.defaultMaxTokens,
        ...(system ? { system } : {}),
        messages,
        stream: true,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 401 || res.status === 403) throw new AiProviderError("The Anthropic API key was rejected", "AI_ANTHROPIC_UNAUTHORIZED");
    if (!res.ok || !res.body) throw new AiProviderError(`Claude answered ${res.status}`, "AI_ANTHROPIC_UPSTREAM");
    yield* readAnthropicStream(res.body);
  }
}

/** Text deltas from a Messages API event stream. An error event ends it with an error. */
export async function* readAnthropicStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!data) continue;
      let event: { type?: string; delta?: { type?: string; text?: unknown }; error?: { message?: string } };
      try {
        event = JSON.parse(data.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
        if (event.delta.text) yield event.delta.text;
      } else if (event.type === "error") {
        throw new AiProviderError(event.error?.message ?? "Claude reported an error", "AI_ANTHROPIC_UPSTREAM");
      } else if (event.type === "message_stop") {
        return;
      }
    }
  }
}

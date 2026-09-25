/**
 * A model somebody else runs.
 *
 * One class covers every cloud a person can point Runtime at, because they all
 * speak the same API: the person's own xAI account, the PerkOS gateway, or a
 * key they bring from anywhere else. What changes is the URL, the key and the
 * name on screen, so those are arguments, not three copies of this file.
 *
 * The key is held here and nowhere else: it is never logged, never returned by
 * `health()`, and never part of an error message.
 */

import { readSse } from "./local.ts";
import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";

export interface CloudProviderOptions {
  /** Stable id stored in settings: `xai`, `perkos`, `byok`. */
  id: string;
  /** What the screen calls it. */
  label: string;
  baseUrl: string;
  /** Read when a request is made, so a key added later is picked up. */
  apiKey: () => string | undefined;
  fetchImpl?: typeof fetch;
}

const HEALTH_TIMEOUT_MS = 8_000;

export class CloudAiProvider implements AiProvider {
  readonly id: string;
  readonly label: string;

  private readonly baseUrl: string;
  private readonly apiKey: () => string | undefined;
  private readonly http: typeof fetch;

  constructor(options: CloudProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.http = options.fetchImpl ?? fetch;
  }

  private headers(stream: boolean): Record<string, string> {
    const key = this.apiKey();
    return {
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.apiKey()) {
      return { ok: false, detail: `${this.label} is not connected yet.`, baseUrl: this.baseUrl };
    }
    try {
      const res = await this.http(`${this.baseUrl}/models`, {
        headers: this.headers(false),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `${this.label} refused the key. Connect it again.`, baseUrl: this.baseUrl };
      }
      if (!res.ok) {
        return { ok: false, detail: `${this.label} answered ${res.status}.`, baseUrl: this.baseUrl };
      }
      return { ok: true, detail: `${this.label} is answering.`, baseUrl: this.baseUrl };
    } catch {
      return { ok: false, detail: `${this.label} did not answer.`, baseUrl: this.baseUrl };
    }
  }

  async models(): Promise<ModelInfo[]> {
    const res = await this.http(`${this.baseUrl}/models`, { headers: this.headers(false) });
    if (!res.ok) throw new AiProviderError(`${this.label} answered ${res.status}`, "AI_CLOUD_UPSTREAM");
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((m) => (typeof m.id === "string" ? { id: m.id } : null))
      .filter((m): m is ModelInfo => m !== null);
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    if (!this.apiKey()) throw new AiProviderError(`${this.label} is not connected`, "AI_CLOUD_ABSENT");
    const res = await this.http(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(true),
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
      throw new AiProviderError(`${this.label} answered ${res.status}`, "AI_CLOUD_UPSTREAM");
    }
    yield* readSse(res.body);
  }
}

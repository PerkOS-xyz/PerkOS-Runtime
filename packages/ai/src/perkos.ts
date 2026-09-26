/**
 * PerkOS LLM, for a person whose wallet has access to it.
 *
 * The gateway answers PerkOS's own machines only, so Runtime reaches it
 * through PerkOS's API with the person's PerkOS session (`/llm/v1`, the OpenAI
 * shape). The API reads the wallet's access on every request and keeps the
 * gateway's key to itself, so the session token is the only credential here:
 * the getter refreshes it, and this provider never stores it.
 *
 * A wallet without access is not offered this source at all (`offered: false`),
 * rather than shown as something broken it could never fix.
 */

import { readSse } from "./local.ts";
import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";

export const PERKOS_API_BASE_URL = "https://api.perkos.xyz";

const HEALTH_TIMEOUT_MS = 8_000;

export interface PerkosProviderOptions {
  /** The PerkOS session's access token, or null when signed out. */
  token: () => Promise<string | null | undefined>;
  /** PerkOS's API, without the `/llm/v1` path. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const modelsIn = (body: unknown): ModelInfo[] =>
  ((body as { data?: Array<{ id?: unknown }> } | null)?.data ?? [])
    .map((m) => (typeof m.id === "string" && m.id ? { id: m.id } : null))
    .filter((m): m is ModelInfo => m !== null);

export class PerkosAiProvider implements AiProvider {
  readonly id = "perkos";
  readonly label = "PerkOS LLM";

  private readonly token: () => Promise<string | null | undefined>;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;
  /** What the last health check listed, so choosing a model does not ask twice. */
  private listed: ModelInfo[] | null = null;

  constructor(options: PerkosProviderOptions) {
    this.token = options.token;
    this.baseUrl = `${(options.baseUrl ?? PERKOS_API_BASE_URL).replace(/\/+$/, "")}/llm/v1`;
    this.http = options.fetchImpl ?? fetch;
  }

  private async headers(stream: boolean): Promise<Record<string, string> | null> {
    const token = await this.token().catch(() => null);
    if (!token) return null;
    return {
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
      authorization: `Bearer ${token}`,
    };
  }

  async health(): Promise<ProviderHealth> {
    const headers = await this.headers(false);
    if (!headers) return { ok: false, offered: false, detail: "Sign in to PerkOS to use PerkOS LLM." };
    try {
      const res = await this.http(`${this.baseUrl}/models`, { headers, signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, offered: false, detail: "This wallet does not have PerkOS LLM access." };
      }
      if (!res.ok) return { ok: false, detail: `PerkOS LLM answered ${res.status}. Check again in a moment.`, baseUrl: this.baseUrl };
      this.listed = modelsIn(await res.json().catch(() => null));
      if (!this.listed.length) return { ok: false, detail: "PerkOS LLM offers no model right now.", baseUrl: this.baseUrl };
      return { ok: true, detail: "Included with your wallet's PerkOS access.", baseUrl: this.baseUrl };
    } catch {
      return { ok: false, detail: "PerkOS LLM did not answer. Check again in a moment.", baseUrl: this.baseUrl };
    }
  }

  async models(): Promise<ModelInfo[]> {
    if (this.listed) return this.listed;
    const headers = await this.headers(false);
    if (!headers) throw new AiProviderError("Sign in to PerkOS first", "AI_PERKOS_SIGNED_OUT");
    const res = await this.http(`${this.baseUrl}/models`, { headers });
    if (!res.ok) throw new AiProviderError(`PerkOS LLM answered ${res.status}`, "AI_PERKOS_UPSTREAM");
    this.listed = modelsIn(await res.json().catch(() => null));
    return this.listed;
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    const headers = await this.headers(true);
    if (!headers) throw new AiProviderError("Sign in to PerkOS first", "AI_PERKOS_SIGNED_OUT");
    const res = await this.http(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError("This wallet does not have PerkOS LLM access", "AI_PERKOS_ACCESS");
    }
    if (!res.ok || !res.body) throw new AiProviderError(`PerkOS LLM answered ${res.status}`, "AI_PERKOS_UPSTREAM");
    yield* readSse(res.body);
  }
}

/**
 * Grok through a person's xAI subscription.
 *
 * The subscription token is an OAuth bearer, not an API key. It works with the
 * Responses API (`POST {baseUrl}/responses`), which streams events such as
 * `response.output_text.delta`. The token getter refreshes it when needed;
 * this provider never stores it.
 */

import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";

export const XAI_BASE_URL = "https://api.x.ai/v1";
export const XAI_MODELS = ["grok-4.6"];
/** Originator registered with the OAuth client id. */
export const XAI_ORIGINATOR = "perkos-floor";

export interface XaiProviderOptions {
  /** Current access token, or null when not signed in. */
  token: () => Promise<string | null>;
  baseUrl?: string;
  models?: string[];
  /** Reasoning effort; "low" keeps a conversational turn fast. */
  effort?: "low" | "medium" | "high";
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export class XaiProvider implements AiProvider {
  readonly id = "xai";
  readonly label = "Grok (xAI)";

  private readonly token: () => Promise<string | null>;
  private readonly baseUrl: string;
  private readonly modelIds: string[];
  private readonly effort: string;
  private readonly userAgent: string;
  private readonly http: typeof fetch;

  constructor(options: XaiProviderOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? XAI_BASE_URL).replace(/\/+$/, "");
    this.modelIds = options.models ?? XAI_MODELS;
    this.effort = options.effort ?? "low";
    this.userAgent = options.userAgent ?? "PerkOS-Runtime";
    this.http = options.fetchImpl ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    const token = await this.token().catch(() => null);
    return token
      ? { ok: true, detail: "Signed in with your Grok subscription.", baseUrl: this.baseUrl }
      : { ok: false, detail: "Sign in with your Grok subscription to use it here." };
  }

  async models(): Promise<ModelInfo[]> {
    return this.modelIds.map((id) => ({ id }));
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    const token = await this.token();
    if (!token) throw new AiProviderError("Not signed in to Grok", "AI_XAI_SIGNED_OUT");
    const instructions = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const input = request.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await this.http(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": this.userAgent,
        originator: XAI_ORIGINATOR,
      },
      body: JSON.stringify({
        model: request.model,
        ...(instructions ? { instructions } : {}),
        input,
        reasoning: { effort: this.effort },
        stream: true,
        ...(request.maxTokens === undefined ? {} : { max_output_tokens: request.maxTokens }),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 401) throw new AiProviderError("The Grok session was rejected", "AI_XAI_UNAUTHORIZED");
    if (!res.ok || !res.body) throw new AiProviderError(`Grok answered ${res.status}`, "AI_XAI_UPSTREAM");
    yield* readResponsesStream(res.body);
  }
}

/** Text deltas from a Responses API event stream. A failure event ends it with an error. */
export async function* readResponsesStream(body: ReadableStream<Uint8Array>, errorCode = "AI_XAI_UPSTREAM"): AsyncIterable<string> {
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
      const raw = data.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let event: { type?: string; delta?: unknown; error?: { message?: string } };
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta) {
        yield event.delta;
      } else if (event.type === "response.failed" || event.type === "error") {
        throw new AiProviderError(event.error?.message ?? "The model reported an error", errorCode);
      }
    }
  }
}

/**
 * ChatGPT through the person's ChatGPT subscription.
 *
 * The subscription token is an OAuth bearer for chatgpt.com/backend-api/codex,
 * which speaks the Responses API. OpenAI asks third-party apps to identify
 * themselves, so requests carry this app's `originator` and User-Agent, plus
 * the account id from the token's claims.
 */

import { AiProviderError, type AiProvider, type ChatRequest, type ModelInfo, type ProviderHealth } from "./types.ts";
import { readResponsesStream } from "./xai.ts";

export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CHATGPT_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
export const CHATGPT_ORIGINATOR = "perkos-runtime";
const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";

/** The ChatGPT account id in the access token's claims, when present. */
export function chatgptAccountId(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, { chatgpt_account_id?: unknown }>;
    const id = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export interface ChatgptProviderOptions {
  /** Current access token, or null when not signed in. */
  token: () => Promise<string | null>;
  baseUrl?: string;
  models?: string[];
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export class ChatgptProvider implements AiProvider {
  readonly id = "openai";
  readonly label = "ChatGPT (OpenAI)";

  private readonly token: () => Promise<string | null>;
  private readonly baseUrl: string;
  private readonly modelIds: string[];
  private readonly userAgent: string;
  private readonly http: typeof fetch;

  constructor(options: ChatgptProviderOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? CHATGPT_BASE_URL).replace(/\/+$/, "");
    this.modelIds = options.models ?? CHATGPT_MODELS;
    this.userAgent = options.userAgent ?? "PerkOSRuntime/0.1.0";
    this.http = options.fetchImpl ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    const token = await this.token().catch(() => null);
    return token
      ? { ok: true, detail: "Signed in with your ChatGPT account.", baseUrl: this.baseUrl }
      : { ok: false, detail: "Sign in with your ChatGPT account to use it here." };
  }

  async models(): Promise<ModelInfo[]> {
    return this.modelIds.map((id) => ({ id }));
  }

  async *chat(request: ChatRequest): AsyncIterable<string> {
    const token = await this.token();
    if (!token) throw new AiProviderError("Not signed in to ChatGPT", "AI_OPENAI_SIGNED_OUT");
    const instructions =
      request.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n") || DEFAULT_INSTRUCTIONS;
    const input = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        type: "message",
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
      }));
    const account = chatgptAccountId(token);
    const res = await this.http(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": this.userAgent,
        originator: CHATGPT_ORIGINATOR,
        ...(account ? { "ChatGPT-Account-ID": account } : {}),
      },
      body: JSON.stringify({ model: request.model, instructions, input, store: false, stream: true }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 401) throw new AiProviderError("The ChatGPT session was rejected", "AI_OPENAI_UNAUTHORIZED");
    if (!res.ok || !res.body) throw new AiProviderError(`ChatGPT answered ${res.status}`, "AI_OPENAI_UPSTREAM");
    yield* readResponsesStream(res.body, "AI_OPENAI_UPSTREAM");
  }
}

/**
 * What Runtime needs from a model, whoever runs it.
 *
 * The point of this shape is that the screen can say where an answer came
 * from. A person who chose a model on their own machine should never wonder
 * whether the reply went to a cloud instead, so every provider names itself
 * and reports its own health rather than failing silently.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Cut the answer off past this many tokens; the provider may cap it lower. */
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ModelInfo {
  id: string;
}

export interface ProviderHealth {
  ok: boolean;
  /** One sentence a person can act on: what is wrong, or what is answering. */
  detail: string;
  /** Where it is answering from, when there is a URL to name. */
  baseUrl?: string;
  /**
   * False when this person cannot use the source at all, such as PerkOS LLM
   * for a wallet without access: the screen leaves it out rather than showing
   * something broken they could never fix.
   */
  offered?: boolean;
}

export interface AiProvider {
  /** Stable id, stored in settings: `local`, `xai`, `perkos`. */
  readonly id: string;
  /** What the screen calls it. */
  readonly label: string;
  health(): Promise<ProviderHealth>;
  models(): Promise<ModelInfo[]>;
  /** Streams the answer in pieces, so the screen can show it as it arrives. */
  chat(request: ChatRequest): AsyncIterable<string>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code = "AI_PROVIDER",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

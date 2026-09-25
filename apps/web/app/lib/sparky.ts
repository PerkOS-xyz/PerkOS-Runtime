/** Sparky's replies, streamed from the model the person chose. */

import type { AiRegistry, ChatMessage } from "@perkos/ai";

import type { ModelChoice } from "./settings";

export const SPARKY_PROMPT = [
  "You are Sparky, the assistant in PerkOS Runtime.",
  "Answer general questions briefly and plainly.",
  "PerkOS Runtime hosts desks: each desk is a team of agents with its own market and screens.",
  "When someone describes what they want to do, help them find the right desk.",
  "Never claim to have moved funds or placed an order. Desks draft; the person approves and signs.",
].join(" ");

const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

/** Keeps the last turns, drops anything that is not a user or assistant message, and caps length. */
export function cleanMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string" &&
        (m as ChatMessage).content.trim() !== "",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

/**
 * Starts a reply. Resolves once the first piece has arrived, so a provider that
 * fails immediately is reported as an error instead of an empty stream.
 */
export async function startReply(
  registry: AiRegistry,
  choice: ModelChoice,
  messages: ChatMessage[],
  system = SPARKY_PROMPT,
): Promise<ReadableStream<Uint8Array>> {
  const provider = registry.get(choice.provider);
  if (!provider) throw new Error(`Unknown model source: ${choice.provider}`);
  const pieces = provider
    .chat({ model: choice.model, messages: [{ role: "system", content: system }, ...messages], maxTokens: 800 })
    [Symbol.asyncIterator]();
  const first = await pieces.next();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!first.done && first.value) controller.enqueue(encoder.encode(first.value));
      if (first.done) controller.close();
    },
    async pull(controller) {
      try {
        const next = await pieces.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await pieces.return?.();
    },
  });
}

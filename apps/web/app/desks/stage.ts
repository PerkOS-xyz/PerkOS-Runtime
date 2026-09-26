/**
 * Small pieces of the desk scene that do not need a browser: how Sparky looks
 * for a voice state, and the line under him.
 */

import type { VoiceStatus } from "../voice/useVoice";

export type CoreState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Sparky's look: listening while the mic is open, thinking until the first
 * word of his answer arrives, then speaking while he answers, out loud or in
 * text, so he lights up whichever way he replies.
 */
export function coreState(voice: VoiceStatus, busy: boolean, answering = false): CoreState {
  if (voice === "listening") return "listening";
  if (voice === "speaking" || answering) return "speaking";
  if (voice === "transcribing" || voice === "thinking" || busy) return "thinking";
  return "idle";
}

const WHISPER: Record<CoreState, string> = {
  idle: "They draft. You approve.",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking"
};

export const whisper = (state: CoreState) => WHISPER[state];

/** First questions for an empty conversation, when the desk publishes none of its own. */
export const DEFAULT_STARTERS = [
  { text: "What does this desk do?", tag: "The team and its work" },
  { text: "How do I start here?", tag: "First steps" },
  { text: "What will the team never do without me?", tag: "They draft. You approve." }
];

/** Whether his answer is arriving right now: the last turn is his and has words in it. */
export function isAnswering(busy: boolean, messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  const last = messages[messages.length - 1];
  return busy && last?.role === "assistant" && last.content.length > 0;
}

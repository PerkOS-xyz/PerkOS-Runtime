/**
 * Small pieces of the desk scene that do not need a browser: how Sparky looks
 * for a voice state, and the line under him.
 */

import type { VoiceStatus } from "../voice/useVoice";

export type CoreState = "idle" | "listening" | "thinking" | "speaking";

/** Sparky's look: listening while the mic is open, thinking until the first word is spoken, speaking while he talks. */
export function coreState(voice: VoiceStatus, busy: boolean): CoreState {
  if (voice === "listening") return "listening";
  if (voice === "speaking") return "speaking";
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

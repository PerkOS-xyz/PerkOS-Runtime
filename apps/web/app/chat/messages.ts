/**
 * The lines of a conversation with Sparky, and how they change.
 *
 * In a desk, the conversation holds more than the person and Sparky: the
 * desk's team speaks in it too. Every line has an id, so a reply that is
 * still arriving is written into its own line even while other lines arrive
 * after it. No React: the chat hook uses these, and tests call them directly.
 */

import type { TurnWork } from "../turn/turnState";

/** How Sparky's line reads: to the person during a turn, his first words while the team wakes, or his summary of a turn. */
export type SparkyTone = "to-you" | "warm" | "summary";

export interface PersonMessage {
  id: string;
  role: "user";
  content: string;
}

export interface SparkyMessage {
  id: string;
  role: "assistant";
  content: string;
  tone?: SparkyTone;
  /** The desk turn this line belongs to. */
  turnId?: string;
  /** The turn's checklist, folded onto his summary. */
  work?: TurnWork;
}

/**
 * A line of the desk's team: Sparky's line to the first roles (principal),
 * an agent's answer, a guest's, or a short note such as an agent that did
 * not answer. The model never gets these back: Sparky reads the team from
 * the kept turn.
 */
export interface TeamMessage {
  id: string;
  role: "team";
  kind: "principal" | "agent" | "guest" | "note";
  /** "sparky", "scout", "risk", ... */
  who: string;
  content: string;
  turnId?: string;
  agentName?: string;
  /** Why an agent gave no answer: shown as a short line instead of a bubble. */
  failure?: { label: string; detail?: string };
  /** The principal line's facts, for the [Fn] tags in the answers that follow. */
  facts?: string[];
}

export type Message = PersonMessage | SparkyMessage | TeamMessage;

/** A line before it has an id. */
export type NewMessage = Omit<PersonMessage, "id"> | Omit<SparkyMessage, "id"> | Omit<TeamMessage, "id">;

let counter = 0;

/** A new id, unique in this window. */
export function newMessageId(): string {
  counter = (counter + 1) % 1_000_000;
  return `m${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Adds a streamed piece to one line, wherever it sits. */
export function appendPiece(list: Message[], id: string, piece: string): Message[] {
  const i = list.findIndex((m) => m.id === id);
  if (i < 0 || !piece) return list;
  const next = [...list];
  next[i] = { ...list[i]!, content: list[i]!.content + piece };
  return next;
}

/** Drops a reply that ended with nothing in it. One that carries a turn's checklist stays, for the fold. */
export function dropIfEmpty(list: Message[], id: string): Message[] {
  const m = list.find((x) => x.id === id);
  if (!m || m.content !== "" || (m.role === "assistant" && m.work)) return list;
  return list.filter((x) => x.id !== id);
}

/** The conversation as the model gets it: the person and Sparky, lines with words only. */
export function modelHistory(list: Message[]): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of list) {
    if ((m.role === "user" || m.role === "assistant") && m.content.trim()) out.push({ role: m.role, content: m.content });
  }
  return out;
}

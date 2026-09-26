/** Sparky's replies, streamed from the model the person chose. */

import type { AiRegistry, ChatMessage } from "@perkos/ai";
import type { DeskManifest } from "@perkos/desk-contract";

import { planOfRecord, type TurnPlan } from "../turn/turnPlan";
import type { ModelChoice } from "./settings";
import { failureLabel } from "./turnFailure";
import { roleName, withoutFactTags, type TurnRecord } from "./turnRecord";

export const SPARKY_PROMPT = [
  "You are Sparky, the assistant in PerkOS Runtime.",
  "Answer general questions briefly and plainly, in plain text without markdown.",
  "PerkOS Runtime hosts desks: each desk is a team of agents with its own market and screens.",
  "When someone describes what they want to do, help them find the right desk.",
  "Never claim to have moved funds or placed an order. Desks draft; the person approves and signs.",
].join(" ");

export interface DeskBrief {
  name: string;
  description: string;
  module?: string;
}

const MAX_DESKS = 20;
const MAX_DESK_TEXT = 300;

/** Sparky's system prompt, with the desks the person can open and the one open now, if any. */
export function sparkyPrompt(desks: DeskBrief[], open?: DeskBrief): string {
  if (!desks.length) return `${SPARKY_PROMPT} No desks are available right now; say so if someone asks for one.`;
  const list = desks
    .slice(0, MAX_DESKS)
    .map((d) => `- ${d.name.slice(0, 80)}${d.module ? ` (${d.module})` : ""}: ${d.description.slice(0, MAX_DESK_TEXT)}`)
    .join("\n");
  const here = open
    ? `\n\nThe person has ${open.name.slice(0, 80)} open now. Questions about "this desk" are about ${open.name.slice(0, 80)}.`
    : "";
  return `${SPARKY_PROMPT}\n\nDesks available:\n${list}${here}\n\nRecommend only desks from this list, by name. If none fits, say so.`;
}

/** Adds what Sparky remembers about the question to the prompt, when anything matches. */
export function withMemory(system: string, recall: string): string {
  if (!recall.trim()) return system;
  return `${system}\n\nNotes from earlier conversations with this person. Use them only when they help with the question:\n${recall.trim()}`;
}

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

/** Passes a reply through and hands its text to `done` once, when it ends or is cut off. */
export function tapReply(stream: ReadableStream<Uint8Array>, done: (text: string) => void): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done(text + decoder.decode());
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          controller.close();
          return;
        }
        text += decoder.decode(next.value, { stream: true });
        controller.enqueue(next.value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

/** What Sparky gets of one answer of the team. */
const TEAM_CLIP = 1_200;

/** The part of a desk turn Sparky reads. */
export type TeamTurn = Pick<TurnRecord, "question" | "replies" | "guests" | "error">;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clipped = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Each role's part of a turn, one per line: "Scout: <answer>", or
 * "Auditor: (no answer: model failed)". The [Fn] tags are left out: they
 * number this turn's facts only, and Sparky's words may be read aloud.
 */
export function teamLines(turn: TeamTurn): string[] {
  return [...turn.replies, ...turn.guests].map((r) => {
    const who = roleName(r.role);
    if (!r.ok) return `${who}: (no answer: ${failureLabel(r.failure ?? "other")})`;
    return `${who}: ${clipped(oneLine(withoutFactTags(r.reply)), TEAM_CLIP)}`;
  });
}

/** Asks Sparky to sum a desk turn up for the person, from what the team said. */
export function withTeam(system: string, turn: TeamTurn): string {
  const asked = clipped(oneLine(turn.question), 300);
  if (turn.error) {
    return [
      system,
      "",
      `The desk's team could not take part in the person's request "${asked}": ${oneLine(turn.error.message)}`,
      "Answer the person yourself, briefly, from the desk's facts, and say in one short sentence that the team did not take part and why.",
      "Do not pick a stock or give a plan in the team's place.",
    ].join("\n");
  }
  return [
    system,
    "",
    `The desk's team just worked on the person's request "${asked}". What each of them said is below.`,
    "Sum it up for the person in plain text, in a few short sentences: the read, the risk, the plan and the record.",
    "Say where the team disagrees. Use only what the team said and the desk's facts, and never invent a number.",
    "If someone did not answer, name them and say why.",
    "Nothing is bought until the person holds to approve in the Trader.",
    "Say the facts themselves: no fact tags like [F1] and no @ mentions.",
    "What the team said:",
    ...teamLines(turn),
  ].join("\n");
}

/** Gives Sparky what the team said in a desk's last turn, for questions about it afterwards. */
export function withTeamNotes(system: string, turn: TeamTurn): string {
  const asked = clipped(oneLine(turn.question), 300);
  return `${system}\n\nWhat the desk's team said in its last turn, on "${asked}". Use it when the person asks about it:\n${teamLines(turn).join("\n")}`;
}

/**
 * The plan Sparky's summary points to: after an advise turn only, on a desk
 * with a Trader, when the Trader left one. The same plan the Trader's card
 * fills the Trader with, capped at what one order may spend.
 */
export function planToPoint(
  turn: Pick<TurnRecord, "kind" | "error" | "replies" | "facts" | "verdict">,
  manifest: Pick<DeskManifest, "screens" | "maxOrder"> | null,
): TurnPlan | null {
  if (turn.kind !== "advise" || turn.error || !manifest?.screens.includes("trader")) return null;
  return planOfRecord(turn, manifest.maxOrder);
}

/** Asks Sparky to close his summary by pointing to Buy in Trader, where the plan is one press away. */
export function withPlan(system: string, plan: TurnPlan): string {
  return [
    system,
    "",
    `The Trader's plan is ready to buy from the desk: ${plan.ticker} for ${plan.amount} USDG.`,
    'Close with one short sentence that points the person to "Buy in Trader" on the Trader\'s card: it opens the Trader with that filled in, and nothing is bought until they get a quote and hold to approve.',
  ].join("\n");
}

/** Sparky's first words while the desk's team wakes up to work on the request. */
export const WARM_UP = [
  "The desk's team is waking up on PerkOS to work on this request. That can take a minute or two, and they will answer in this conversation.",
  "Meanwhile reply in two or three short sentences: say the team is on it, and give a first read from the desk's facts when they cover the question.",
  "Do not pick a stock or give a plan: the team does that.",
].join(" ");

export function withWarmUp(system: string): string {
  return `${system}\n\n${WARM_UP}`;
}

/**
 * The conversation as the model gets it when Sparky answers a question the
 * conversation may not end with: a turn's summary, or a warm-up, after the
 * person asked Sparky something else meanwhile. The question goes last.
 */
export function answering(messages: ChatMessage[], question: string): ChatMessage[] {
  const q = question.trim().slice(0, MAX_CHARS);
  if (!q) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === "user" && last.content.trim() === q) return messages;
  return [...messages, { role: "user" as const, content: q }].slice(-MAX_MESSAGES);
}

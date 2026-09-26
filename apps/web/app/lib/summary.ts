/**
 * Daily summaries: each day's conversations, boiled down to what should still
 * be true next week, kept in the scope's Memory note (<scope>/notes/memory, see
 * memoryNote.ts). Sparky recalls the Memory note like any other note.
 *
 * A desk's decisions of the day go in after its conversations, four lines
 * each (see decisions.ts), so the summary keeps them under Decisions.
 */

import type { AiRegistry } from "@perkos/ai";
import { localDay, type Note, type NoteStore } from "@perkos/vault";

import { asTurnRecord, decisionsBlock } from "./decisions";
import { addSummary, dropSummary, hasSummary, MEMORY_SLUG, SECTIONS } from "./memoryNote";
import type { ModelChoice } from "./settings";
import { startReply } from "./sparky";
import type { TurnRecord } from "./turnRecord";

export const SUMMARY_PROMPT = [
  "You keep the long-term memory of Sparky, an assistant, about one person.",
  "From the day's conversations, keep only what should still be true next week.",
  `Write plain text with exactly these headings, each on its own line: ${SECTIONS.join(", ")}.`,
  'Under each heading write short lines that start with "- ". If a section is empty, write "- none".',
  "Skip greetings and small talk. Never include wallet addresses, keys, tokens or transaction hashes.",
].join(" ");

const MIN_JOURNAL = 80;
const MAX_JOURNAL = 24_000;
const PENDING_DAYS = 3;
/** What the day's desk decisions may take of the summary's input. The conversations keep the rest of MAX_JOURNAL. */
const MAX_DECISIONS = 10_000;

/** A scope's desk turns of one day, in local time. */
async function dayTurns(notes: NoteStore, scope: string, date: string): Promise<TurnRecord[]> {
  return (await notes.list(scope, "turn"))
    .map((n) => asTurnRecord(n.data))
    .filter((r): r is TurnRecord => r !== null && localDay(new Date(r.startedAt)) === date);
}

/** What the model reads: the day's conversations, then its desk decisions, together within MAX_JOURNAL. */
function summaryInput(date: string, journal: string, decided: string): string {
  const room = decided ? MAX_JOURNAL - decided.length - 2 : MAX_JOURNAL;
  const talk = journal.trim() ? `Conversations of ${date}:\n\n${journal.slice(0, Math.max(0, room))}` : "";
  return [talk, decided].filter(Boolean).join("\n\n");
}

/** The days desk decisions were taken on, one per turn. */
const decisionDays = (all: Note[]) =>
  all.flatMap((n) => {
    const r = n.kind === "turn" ? asTurnRecord(n.data) : null;
    const date = r ? localDay(new Date(r.startedAt)) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? [{ scope: n.scope, date }] : [];
  });

/** empty: nothing to summarize; done: already summarized; busy: a summary of that day is being written; model: no answer. */
export type SummaryResult = { scope: string; date: string; ok: boolean; reason?: "empty" | "done" | "busy" | "model" };

// Days being summarized, per open vault.
const running = new WeakMap<NoteStore, Set<string>>();

/** Summarizes one day of one scope into its Memory note. */
export async function summarizeDay(
  notes: NoteStore,
  registry: AiRegistry,
  model: ModelChoice,
  scope: string,
  date: string,
  force = false,
): Promise<SummaryResult> {
  const journal = await notes.read(`${scope}/journal/${date}`);
  const decided = decisionsBlock(await dayTurns(notes, scope, date), date, MAX_DECISIONS);
  if ((!journal || journal.body.trim().length < MIN_JOURNAL) && !decided) return { scope, date, ok: false, reason: "empty" };
  const memoryId = `${scope}/notes/${MEMORY_SLUG}`;
  if (!force && hasSummary((await notes.read(memoryId))?.body ?? "", date)) return { scope, date, ok: true, reason: "done" };

  const busy = running.get(notes) ?? new Set<string>();
  running.set(notes, busy);
  const key = `${scope}|${date}`;
  if (busy.has(key)) return { scope, date, ok: true, reason: "busy" };
  busy.add(key);
  try {
    const stream = await startReply(
      registry,
      model,
      [{ role: "user", content: summaryInput(date, journal?.body ?? "", decided) }],
      SUMMARY_PROMPT,
    );
    const text = (await new Response(stream).text()).trim();
    if (!text) return { scope, date, ok: false, reason: "model" };
    // Read again: the note may have changed while the model was answering.
    const memory = (await notes.read(memoryId))?.body ?? "";
    if (!force && hasSummary(memory, date)) return { scope, date, ok: true, reason: "done" };
    const without = force ? dropSummary(memory, date) : memory;
    await notes.writeNote(scope, MEMORY_SLUG, "Memory", addSummary(without, date, text));
    return { scope, date, ok: true };
  } finally {
    busy.delete(key);
  }
}

/** Earlier days that have conversations or desk decisions but no summary yet, newest first. */
export async function pendingDays(notes: NoteStore, today = localDay(new Date())): Promise<{ scope: string; date: string }[]> {
  const all = await notes.list();
  const memory = new Map(all.filter((n) => n.id.endsWith(`/notes/${MEMORY_SLUG}`)).map((n) => [n.scope, n.body]));
  return all
    .filter((n) => n.kind === "journal" && n.body.trim().length >= MIN_JOURNAL)
    .map((n) => ({ scope: n.scope, date: n.id.slice(-10) }))
    .concat(decisionDays(all))
    .filter((d, i, days) => days.findIndex((e) => e.scope === d.scope && e.date === d.date) === i)
    .filter((d) => d.date < today && !hasSummary(memory.get(d.scope) ?? "", d.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PENDING_DAYS);
}

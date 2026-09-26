/**
 * Daily summaries: each day's conversations, boiled down to what should still
 * be true next week, kept in the scope's Memory note (<scope>/notes/memory, see
 * memoryNote.ts). Sparky recalls the Memory note like any other note.
 */

import type { AiRegistry } from "@perkos/ai";
import { localDay, type NoteStore } from "@perkos/vault";

import { addSummary, dropSummary, hasSummary, MEMORY_SLUG, SECTIONS } from "./memoryNote";
import type { ModelChoice } from "./settings";
import { startReply } from "./sparky";

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
  if (!journal || journal.body.trim().length < MIN_JOURNAL) return { scope, date, ok: false, reason: "empty" };
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
      [{ role: "user", content: `Conversations of ${date}:\n\n${journal.body.slice(0, MAX_JOURNAL)}` }],
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

/** Earlier days that have conversations but no summary yet, newest first. */
export async function pendingDays(notes: NoteStore, today = localDay(new Date())): Promise<{ scope: string; date: string }[]> {
  const all = await notes.list();
  const memory = new Map(all.filter((n) => n.id.endsWith(`/notes/${MEMORY_SLUG}`)).map((n) => [n.scope, n.body]));
  return all
    .filter((n) => n.kind === "journal" && n.body.trim().length >= MIN_JOURNAL)
    .map((n) => ({ scope: n.scope, date: n.id.slice(-10) }))
    .filter((d) => d.date < today && !hasSummary(memory.get(d.scope) ?? "", d.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PENDING_DAYS);
}

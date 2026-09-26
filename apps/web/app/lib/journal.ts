/**
 * The journal format: one exchange per entry, entries separated by a blank line.
 *
 *   [09:22] Person: what the person said
 *   Sparky: what Sparky answered
 *
 * No Node imports: the server writes entries and the memory panel reads them.
 */

const MAX_ENTRY = 2000;

export interface Exchange {
  time: string;
  person: string;
  sparky: string;
}

/** One exchange as a journal entry, stamped with the local time. */
export function journalEntry(question: string, reply: string, at = new Date()): string {
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `[${time}] Person: ${question.trim().slice(0, MAX_ENTRY)}\nSparky: ${reply.trim().slice(0, MAX_ENTRY)}`;
}

const ENTRY = /^\[(\d{2}:\d{2})\] Person: ([\s\S]*?)\nSparky: ([\s\S]*)$/;

/** The exchanges in a journal body, in order. Text that is not an entry is skipped. */
export function parseJournal(body: string): Exchange[] {
  return body
    .split(/\n\n(?=\[\d{2}:\d{2}\] Person: )/)
    .map((chunk) => ENTRY.exec(chunk.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ time: m[1] ?? "", person: (m[2] ?? "").trim(), sparky: (m[3] ?? "").trim() }));
}

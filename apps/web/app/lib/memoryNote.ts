/**
 * The Memory note format: one section per summarized day, newest first.
 *
 *   ## 2026-09-26
 *   Facts
 *   - Budget for stocks is 500 USDG a month.
 *   Preferences
 *   - Low risk positions.
 *
 * No Node imports: the server writes it and the memory panel reads it.
 */

export const MEMORY_SLUG = "memory";
export const SECTIONS = ["Facts", "Decisions", "Preferences", "Open questions"] as const;

export const hasSummary = (memory: string, date: string) => new RegExp(`^## ${date}$`, "m").test(memory);

const DAYS = /^(?=## \d{4}-\d{2}-\d{2}$)/m;

/** The Memory note body with a day's summary in place, newest day first. */
export function addSummary(memory: string, date: string, text: string): string {
  const days = memory
    .split(DAYS)
    .map((part) => part.trim())
    .filter((part) => part.startsWith("## ") && part.split("\n")[0] !== `## ${date}`);
  days.push(`## ${date}\n${text.trim()}`);
  return days.sort((a, b) => b.slice(3, 13).localeCompare(a.slice(3, 13))).join("\n\n");
}

/** The Memory note without one day's section. */
export function dropSummary(memory: string, date: string): string {
  return memory
    .split(DAYS)
    .filter((part) => part.trim().split("\n")[0] !== `## ${date}`)
    .join("")
    .trim();
}

export interface MemoryDay {
  date: string;
  sections: { name: string; items: string[] }[];
}

/** The days in a Memory note, with their non-empty sections. Headings may come as "Facts:", "**Facts**" or "### Facts". */
export function parseMemory(body: string): MemoryDay[] {
  return body
    .split(DAYS)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("## "))
    .map((chunk) => {
      const [head = "", ...lines] = chunk.split("\n");
      const sections: MemoryDay["sections"] = [];
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const bare = line.replace(/^[#*\s]+|[:*\s]+$/g, "").toLowerCase();
        const name = SECTIONS.find((s) => s.toLowerCase() === bare);
        if (name) {
          sections.push({ name, items: [] });
          continue;
        }
        if (!sections.length) sections.push({ name: "Notes", items: [] });
        const item = line.replace(/^[-*•]\s*/, "");
        if (item.toLowerCase() !== "none") sections[sections.length - 1]?.items.push(item);
      }
      return { date: head.slice(3).trim(), sections: sections.filter((s) => s.items.length) };
    });
}

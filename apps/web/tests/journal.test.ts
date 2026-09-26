/**
 * The journal format: written by the server, read back by the memory panel.
 */

import { describe, expect, it } from "vitest";

import { journalEntry, parseJournal } from "../app/lib/journal";

describe("journalEntry", () => {
  it("stamps the exchange with the local time", () => {
    const at = new Date(2026, 8, 26, 9, 5);
    expect(journalEntry(" What is my budget? ", "500 USDG a month.\n", at)).toBe(
      "[09:05] Person: What is my budget?\nSparky: 500 USDG a month.",
    );
  });

  it("caps long turns", () => {
    const entry = journalEntry("q".repeat(3000), "a".repeat(3000));
    expect(entry).toContain("q".repeat(2000));
    expect(entry).not.toContain("q".repeat(2001));
    expect(entry).not.toContain("a".repeat(2001));
  });
});

describe("parseJournal", () => {
  it("reads back what was written, including replies with paragraphs", () => {
    const body = [
      journalEntry("Which desk for NVIDIA?", "EQLTY Desk.", new Date(2026, 8, 26, 9, 5)),
      journalEntry("And the risks?", "Two things.\n\nFirst, prices move after hours.", new Date(2026, 8, 26, 9, 7)),
    ].join("\n\n");
    expect(parseJournal(body)).toEqual([
      { time: "09:05", person: "Which desk for NVIDIA?", sparky: "EQLTY Desk." },
      { time: "09:07", person: "And the risks?", sparky: "Two things.\n\nFirst, prices move after hours." },
    ]);
  });

  it("skips text that is not an entry", () => {
    expect(parseJournal("a note written by hand")).toEqual([]);
  });
});

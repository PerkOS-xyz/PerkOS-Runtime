/**
 * Daily summaries into the Memory note.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AiRegistry, type AiProvider, type ChatRequest } from "@perkos/ai";
import { deriveVaultKey, NoteStore } from "@perkos/vault";
import { describe, expect, it } from "vitest";

import { journalEntry } from "../app/lib/journal";
import { addSummary, dropSummary, hasSummary, parseMemory } from "../app/lib/memoryNote";
import { pendingDays, SUMMARY_PROMPT, summarizeDay } from "../app/lib/summary";

const KEY = deriveVaultKey("0xabc0000000000000000000000000000000000001", "0x01");
const MODEL = { provider: "local", model: "m" };
const SUMMARY = "Facts\n- Budget is 500 USDG a month.\nDecisions\n- none\nPreferences\n- Low risk.\nOpen questions\n- none";

function model(answer = SUMMARY) {
  const calls: ChatRequest[] = [];
  const provider: AiProvider = {
    id: "local",
    label: "Local",
    health: async () => ({ ok: true, detail: "" }),
    models: async () => [],
    chat: async function* (r) {
      calls.push(r);
      yield answer;
    },
  };
  return { registry: new AiRegistry([provider]), calls };
}

const day = (d: number, h = 12) => new Date(2026, 8, d, h, 0);
async function vault(days: Array<[string, number, string]>) {
  const root = mkdtempSync(join(tmpdir(), "perkos-summary-"));
  for (const [scope, d, text] of days) {
    await new NoteStore(root, KEY, () => day(d)).appendJournal(scope, journalEntry(text, "Noted, I will keep that in mind for later.", day(d)));
  }
  return new NoteStore(root, KEY);
}

describe("Memory note sections", () => {
  it("adds a day on top and finds it again", () => {
    const one = addSummary("", "2026-09-25", "Facts\n- a");
    const two = addSummary(one, "2026-09-26", "Facts\n- b");
    expect(two.startsWith("## 2026-09-26\nFacts\n- b\n\n## 2026-09-25")).toBe(true);
    expect(hasSummary(two, "2026-09-25")).toBe(true);
    expect(hasSummary(two, "2026-09-24")).toBe(false);
  });

  it("keeps the newest day first whatever the order days are added in", () => {
    const body = addSummary(addSummary("", "2026-09-25", "Facts\n- b"), "2026-09-24", "Facts\n- a");
    expect(body).toBe("## 2026-09-25\nFacts\n- b\n\n## 2026-09-24\nFacts\n- a");
    expect(addSummary(body, "2026-09-25", "Facts\n- c")).toBe("## 2026-09-25\nFacts\n- c\n\n## 2026-09-24\nFacts\n- a");
  });

  it("drops one day and keeps the others", () => {
    const body = addSummary(addSummary("", "2026-09-25", "Facts\n- a"), "2026-09-26", "Facts\n- b");
    expect(dropSummary(body, "2026-09-26")).toBe("## 2026-09-25\nFacts\n- a");
    expect(dropSummary(body, "2026-09-25")).toBe("## 2026-09-26\nFacts\n- b");
  });
});

describe("parseMemory", () => {
  it("reads days, sections and items, skipping empty sections", () => {
    const body = addSummary(addSummary("", "2026-09-25", "**Facts:**\n- Uses EQLTY Desk.\nDecisions\n- none"), "2026-09-26", SUMMARY);
    expect(parseMemory(body)).toEqual([
      {
        date: "2026-09-26",
        sections: [
          { name: "Facts", items: ["Budget is 500 USDG a month."] },
          { name: "Preferences", items: ["Low risk."] },
        ],
      },
      { date: "2026-09-25", sections: [{ name: "Facts", items: ["Uses EQLTY Desk."] }] },
    ]);
  });
});

describe("summarizeDay", () => {
  it("writes the day's summary into the Memory note once", async () => {
    const notes = await vault([["user", 26, "My budget for stocks is 500 USDG a month and I prefer low risk."]]);
    const { registry, calls } = model();
    expect(await summarizeDay(notes, registry, MODEL, "user", "2026-09-26")).toEqual({ scope: "user", date: "2026-09-26", ok: true });
    expect(calls[0]?.messages[0]).toEqual({ role: "system", content: SUMMARY_PROMPT });
    expect(calls[0]?.messages[1]?.content).toContain("500 USDG");
    const memory = await notes.read("user/notes/memory");
    expect(memory?.title).toBe("Memory");
    expect(memory?.body).toBe(`## 2026-09-26\n${SUMMARY}`);

    expect((await summarizeDay(notes, registry, MODEL, "user", "2026-09-26")).reason).toBe("done");
    expect(calls).toHaveLength(1);
  });

  it("replaces the day when forced, without repeating it", async () => {
    const notes = await vault([["user", 26, "My budget for stocks is 500 USDG a month and I prefer low risk."]]);
    await summarizeDay(notes, model().registry, MODEL, "user", "2026-09-26");
    await summarizeDay(notes, model("Facts\n- Budget is 600 USDG.").registry, MODEL, "user", "2026-09-26", true);
    const body = (await notes.read("user/notes/memory"))?.body ?? "";
    expect(body).toBe("## 2026-09-26\nFacts\n- Budget is 600 USDG.");
  });

  it("does not call the model for a day without conversations", async () => {
    const notes = await vault([]);
    const { registry, calls } = model();
    expect((await summarizeDay(notes, registry, MODEL, "user", "2026-09-26")).reason).toBe("empty");
    expect(calls).toHaveLength(0);
  });
});

describe("pendingDays", () => {
  it("lists earlier days without a summary, newest first, three at most", async () => {
    const notes = await vault([
      ["user", 21, "Day twenty-one: we talked about the budget and the desks for a while."],
      ["user", 22, "Day twenty-two: we talked about the budget and the desks for a while."],
      ["eqlty-desk", 23, "Day twenty-three: we talked about NVDA orders and their risks for a while."],
      ["user", 24, "Day twenty-four: we talked about the budget and the desks for a while."],
      ["user", 25, "Day twenty-five: we talked about the budget and the desks for a while."],
      ["user", 26, "Today: we talked about the budget and the desks for a while."],
    ]);
    await summarizeDay(notes, model().registry, MODEL, "user", "2026-09-25");
    expect(await pendingDays(notes, "2026-09-26")).toEqual([
      { scope: "user", date: "2026-09-24" },
      { scope: "eqlty-desk", date: "2026-09-23" },
      { scope: "user", date: "2026-09-22" },
    ]);
  });
});

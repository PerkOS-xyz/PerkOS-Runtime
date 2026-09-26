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
import { failureLabel } from "../app/lib/turnFailure";
import { turnBody, turnTitle, type TurnRecord } from "../app/lib/turnRecord";

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

describe("a day's desk decisions", () => {
  const HASH = `0x${"cd".repeat(32)}`;
  const turn = (d: number, h: number, extra: Partial<TurnRecord> = {}): TurnRecord => ({
    v: 1,
    id: `202609${d}-${String(h).padStart(2, "0")}0000-ab12`,
    desk: "eqlty-desk",
    module: "stocks-robinhood",
    kind: "advise",
    question: "What should I buy this month?",
    principal: "@Scout @Risk What should I buy this month?",
    startedAt: day(d, h).toISOString(),
    endedAt: day(d, h).toISOString(),
    ms: 60_000,
    facts: [],
    memory: "",
    head: "",
    prompts: {},
    replies: [
      { role: "risk", phase: 1, ok: true, reply: "RISK: low\n@Trader @Auditor keep each pick under 50 USDG.", ms: 1 },
      { role: "trader", phase: 2, ok: true, reply: `@Sparky Buy 50 USDG of NVDA below 178 USDG, through pool ${HASH}.`, ms: 1 },
      { role: "auditor", phase: 2, ok: true, reply: "@Sparky Outlook: NVDA first, review on 2026-10-26.", ms: 1 },
    ],
    guests: [],
    riskLevel: "low",
    flags: [],
    trace: [],
    receipt: { hash: HASH, explorerUrl: `https://explorer.example/tx/${HASH}`, status: "success", ticker: "NVDA", amount: "50", at: "x" },
    ...extra,
  });
  const keep = (notes: NoteStore, r: TurnRecord) => notes.writeTurn(r.desk, r.id, turnTitle(r), turnBody(r, failureLabel), r);

  it("go into the summary after the conversations, one line each, without a hash", async () => {
    const notes = await vault([["eqlty-desk", 26, "Keep the NVDA budget small this month, and remind me about the review."]]);
    await keep(notes, turn(26, 14));
    await keep(notes, turn(25, 10, { question: "Yesterday's question?" }));
    const { registry, calls } = model();
    expect(await summarizeDay(notes, registry, MODEL, "eqlty-desk", "2026-09-26")).toEqual({ scope: "eqlty-desk", date: "2026-09-26", ok: true });
    const input = String(calls[0]?.messages[1]?.content);
    expect(input.startsWith("Conversations of 2026-09-26:")).toBe(true);
    expect(input.indexOf("Desk decisions of 2026-09-26")).toBeGreaterThan(input.indexOf("Keep the NVDA budget small"));
    expect(input).toContain("Question (14:00, advise): What should I buy this month?\nRisk: low\nPlan: Buy 50 USDG of NVDA below 178 USDG");
    expect(input).toContain("Record: Outlook: NVDA first, review on 2026-10-26. Signed NVDA 50, success.");
    expect(input).not.toMatch(/0x/i);
    expect(input).not.toContain("explorer.example");
    expect(input).not.toContain("Yesterday's question?");
  });

  it("are summarized on a day without conversations", async () => {
    const notes = await vault([]);
    await keep(notes, turn(26, 9));
    const { registry, calls } = model();
    expect((await summarizeDay(notes, registry, MODEL, "eqlty-desk", "2026-09-26")).ok).toBe(true);
    const input = String(calls[0]?.messages[1]?.content);
    expect(input.startsWith("Desk decisions of 2026-09-26")).toBe(true);
    expect(input).not.toContain("Conversations of");
    expect(await notes.read("eqlty-desk/notes/memory")).not.toBeNull();
  });

  it("share the size cap with a long day of conversations", async () => {
    const root = mkdtempSync(join(tmpdir(), "perkos-summary-"));
    const notes = new NoteStore(root, KEY, () => day(26));
    for (let i = 0; i < 16; i++) await notes.appendJournal("eqlty-desk", journalEntry(`Question ${i}: ${"about the desk and its picks ".repeat(64)}`, "Noted.", day(26)));
    await keep(notes, turn(26, 9, { question: "Morning question?" }));
    await keep(notes, turn(26, 15, { question: "Afternoon question?" }));
    const { registry, calls } = model();
    await summarizeDay(notes, registry, MODEL, "eqlty-desk", "2026-09-26");
    const input = String(calls[0]?.messages[1]?.content);
    // The journal alone is over the 24,000 characters the model reads.
    expect((await notes.read("eqlty-desk/journal/2026-09-26"))!.body.length).toBeGreaterThan(24_000);
    expect(input.length).toBeLessThanOrEqual("Conversations of 2026-09-26:\n\n".length + 24_000);
    expect(input).toContain("Morning question?");
    expect(input).toContain("Afternoon question?");
  });

  it("make a day to summarize later, once however many turns it had", async () => {
    const notes = await vault([["user", 24, "Day twenty-four: we talked about the budget and the desks for a while."]]);
    await keep(notes, turn(25, 10));
    await keep(notes, turn(25, 11));
    await keep(notes, turn(26, 9));
    expect(await pendingDays(notes, "2026-09-26")).toEqual([
      { scope: "eqlty-desk", date: "2026-09-25" },
      { scope: "user", date: "2026-09-24" },
    ]);
  });
});

/**
 * Where desk turns are kept: the lock for one live turn per desk, this
 * session's turns, the sealed copy in the vault, and what the team may be
 * told from memory.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveVaultKey, NoteStore } from "@perkos/vault";
import { afterEach, describe, expect, it } from "vitest";

import { journalEntry } from "../app/lib/journal";
import { recallScopes, teamMemory } from "../app/lib/memory";
import type { TurnRecord } from "../app/lib/turnRecord";
import { claimTurn, clearSessionTurns, getTurn, listTurns, liveTurn, releaseTurn, saveTurn, SESSION_TURNS, setTurnSummary } from "../app/lib/turnStore";

const WALLET = "0xabc0000000000000000000000000000000000001";
const notesFor = () => new NoteStore(mkdtempSync(join(tmpdir(), "perkos-turns-")), deriveVaultKey(WALLET, "0x01"));

const record = (id: string, extra: Partial<TurnRecord> = {}): TurnRecord => ({
  v: 1,
  id,
  desk: "eqlty-desk",
  module: "stocks-robinhood",
  kind: "analyze",
  question: "How is NVDA doing today?",
  principal: "@Scout @Risk How is NVDA doing today?",
  startedAt: `2026-09-26T14:${id.slice(11, 13)}:00.000Z`,
  endedAt: "2026-09-26T14:59:00.000Z",
  ms: 60_000,
  facts: ["[F1] NVDA (NVIDIA): 181.20 USDG."],
  memory: "",
  head: "head",
  prompts: {},
  replies: [{ role: "scout", phase: 1, ok: true, reply: "@Trader NVDA holds [F1].", ms: 18_000 }],
  guests: [],
  flags: [],
  trace: [],
  ...extra,
});

afterEach(() => clearSessionTurns());

describe("the live-turn lock", () => {
  it("allows one live turn per wallet and desk, and only its holder releases it", () => {
    expect(claimTurn(WALLET, "eqlty-desk", "a")).toBe(true);
    expect(claimTurn(WALLET.toUpperCase().replace("0X", "0x"), "eqlty-desk", "b")).toBe(false);
    expect(claimTurn(WALLET, "other-desk", "c")).toBe(true);
    expect(liveTurn(WALLET, "eqlty-desk")).toBe("a");
    releaseTurn(WALLET, "eqlty-desk", "b");
    expect(liveTurn(WALLET, "eqlty-desk")).toBe("a");
    releaseTurn(WALLET, "eqlty-desk", "a");
    expect(liveTurn(WALLET, "eqlty-desk")).toBeNull();
    expect(claimTurn(WALLET, "eqlty-desk", "d")).toBe(true);
  });

  it("gives up a lock that has been held too long to be real", () => {
    const t0 = Date.now();
    expect(claimTurn(WALLET, "eqlty-desk", "old", t0)).toBe(true);
    expect(claimTurn(WALLET, "eqlty-desk", "new", t0 + 11 * 60_000)).toBe(true);
    expect(liveTurn(WALLET, "eqlty-desk", t0 + 11 * 60_000)).toBe("new");
  });

  it("lives on globalThis, so a module reload keeps it", () => {
    claimTurn(WALLET, "eqlty-desk", "kept");
    const shared = (globalThis as unknown as Record<symbol, { live: Map<string, unknown> }>)[Symbol.for("perkos.runtime.deskTurns")];
    expect(shared?.live.size).toBe(1);
  });
});

describe("keeping turns", () => {
  it("keeps them for the session with memory off, newest first and capped", async () => {
    for (let i = 0; i < SESSION_TURNS + 3; i++) {
      expect(await saveTurn(WALLET, record(`20260926-14${String(i).padStart(2, "0")}00-ab12`), null)).toBe("session");
    }
    const turns = await listTurns(WALLET, "eqlty-desk", null);
    expect(turns).toHaveLength(SESSION_TURNS);
    expect(turns[0]?.id).toBe("20260926-142200-ab12");
    expect(await listTurns(WALLET, "other-desk", null)).toEqual([]);
    expect(await listTurns("0xdef0000000000000000000000000000000000002", "eqlty-desk", null)).toEqual([]);
  });

  it("seals them in the desk's vault scope with memory on, and reads them back after a restart", async () => {
    const notes = notesFor();
    expect(await saveTurn(WALLET, record("20260926-141000-ab12"), notes)).toBe("vault");
    clearSessionTurns();
    const turn = await getTurn(WALLET, "20260926-141000-ab12", notes);
    expect(turn?.question).toBe("How is NVDA doing today?");
    expect((await listTurns(WALLET, "eqlty-desk", notes)).map((t) => t.id)).toEqual(["20260926-141000-ab12"]);
    const note = await notes.read("eqlty-desk/turns/20260926-141000-ab12");
    expect(note?.body).toContain("Asked: How is NVDA doing today?");
    expect(note?.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} How is NVDA doing today\?$/);
  });

  it("merges the vault's turns with this session's, each once", async () => {
    const notes = notesFor();
    await saveTurn(WALLET, record("20260926-141000-ab12"), notes);
    await saveTurn(WALLET, record("20260926-142000-cd34"), null);
    expect((await listTurns(WALLET, "eqlty-desk", notes)).map((t) => t.id)).toEqual(["20260926-142000-cd34", "20260926-141000-ab12"]);
  });

  it("adds Sparky's summary to a kept turn, in both places", async () => {
    const notes = notesFor();
    await saveTurn(WALLET, record("20260926-141000-ab12"), notes);
    const updated = await setTurnSummary(WALLET, "20260926-141000-ab12", "  The desk reads NVDA as steady.  ", notes);
    expect(updated?.summary).toBe("The desk reads NVDA as steady.");
    clearSessionTurns();
    expect((await getTurn(WALLET, "20260926-141000-ab12", notes))?.summary).toBe("The desk reads NVDA as steady.");
    expect((await notes.read("eqlty-desk/turns/20260926-141000-ab12"))?.body).toContain("Sparky: The desk reads NVDA as steady.");
    expect(await setTurnSummary(WALLET, "20260926-000000-0000", "x", notes)).toBeNull();
    expect(await getTurn(WALLET, "../../session", notes)).toBeNull();
  });
});

describe("what the team may be told from memory", () => {
  it("is the desk's earlier turns and its Memory note, never the person's own conversations", async () => {
    const notes = notesFor();
    await notes.appendJournal("eqlty-desk", journalEntry("My NVDA position is secret, 40 shares.", "Noted."));
    await notes.appendJournal("user", journalEntry("NVDA is my favourite.", "Noted."));
    await notes.writeNote("eqlty-desk", "memory", "Memory", "## 2026-09-25\nFacts\n- Budget for stocks is 500 USDG a month.");
    await saveTurn(WALLET, record("20260926-141000-ab12"), notes);
    const told = await teamMemory(notes, "eqlty-desk", "NVDA");
    expect(told).toContain("Earlier desk turns:");
    expect(told).toContain("How is NVDA doing today?");
    expect(told).toContain("Desk notes: ## 2026-09-25 Facts - Budget for stocks is 500 USDG a month.");
    expect(told).not.toContain("secret");
    expect(told).not.toContain("favourite");
    expect(told.length).toBeLessThanOrEqual(900);
    expect(await teamMemory(notes, "user", "NVDA")).toBe("");
  });
});

describe("what Sparky may recall of a desk's turns", () => {
  it("finds them inside the desk and from the general chat, while the team still gets none of the person's words", async () => {
    const notes = notesFor();
    await notes.appendJournal("eqlty-desk", journalEntry("My NVDA position is secret, 40 shares.", "Noted."));
    await saveTurn(WALLET, record("20260926-141000-ab12", { summary: "The desk reads NVDA as steady." }), notes);
    const inDesk = await notes.contextFor("What did the desk say about NVDA?", recallScopes("eqlty-desk", ["eqlty-desk", "base-desk"]));
    expect(inDesk).toContain("How is NVDA doing today?");
    const general = await notes.contextFor("NVDA", recallScopes(undefined, ["eqlty-desk", "base-desk"]));
    expect(general).toContain("How is NVDA doing today?");
    expect(await notes.contextFor("NVDA", recallScopes("base-desk", ["eqlty-desk", "base-desk"]))).toBe("");
    expect(await teamMemory(notes, "eqlty-desk", "What did the desk say about NVDA?")).not.toContain("secret");
  });
});

/**
 * Encrypted notes: journal by scope, sealed files, search within scopes.
 */

import { mkdtempSync, readdirSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveVaultKey, NoteStore, VaultKeyMismatch } from "../src/index.ts";

const WALLET = "0xabc0000000000000000000000000000000000001";
const KEY = deriveVaultKey(WALLET, "0x01");
// Noon on this machine: the same calendar day in every time zone.
const DAY = new Date(2026, 8, 26, 12, 0);

const store = (root = mkdtempSync(join(tmpdir(), "perkos-notes-")), key = KEY) => ({ root, notes: new NoteStore(root, key, () => DAY) });

describe("NoteStore", () => {
  it("appends to the day's journal of a scope and keeps it sealed on disk", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "You: which desk for NVIDIA?\nSparky: EQLTY Desk.");
    const note = await notes.appendJournal("user", "You: thanks");
    expect(note.id).toBe("user/journal/2026-09-26");
    expect(note.body).toBe("You: which desk for NVIDIA?\nSparky: EQLTY Desk.\n\nYou: thanks");
    const onDisk = readFileSync(join(root, "user", "journal", "2026-09-26.json"), "utf8");
    expect(onDisk).not.toContain("NVIDIA");
    expect((await new NoteStore(root, KEY, () => DAY).read(note.id))?.body).toContain("NVIDIA");
  });

  it("files the journal under the day on this machine", async () => {
    const root = mkdtempSync(join(tmpdir(), "perkos-notes-"));
    const late = await new NoteStore(root, KEY, () => new Date(2026, 8, 26, 23, 30)).appendJournal("user", "late");
    const early = await new NoteStore(root, KEY, () => new Date(2026, 8, 27, 0, 30)).appendJournal("user", "early");
    expect([late.id, early.id]).toEqual(["user/journal/2026-09-26", "user/journal/2026-09-27"]);
  });

  it("cannot be read with another key", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "secret plan");
    expect(await new NoteStore(root, deriveVaultKey(WALLET, "0x02")).read("user/journal/2026-09-26")).toBeNull();
  });

  it("refuses a file moved to another scope", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "about me");
    mkdirSync(join(root, "eqlty-desk", "journal"), { recursive: true });
    renameSync(join(root, "user", "journal", "2026-09-26.json"), join(root, "eqlty-desk", "journal", "2026-09-26.json"));
    expect(await new NoteStore(root, KEY).read("eqlty-desk/journal/2026-09-26")).toBeNull();
  });

  it("searches only the scopes asked for", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "I prefer low risk positions.");
    await notes.appendJournal("eqlty-desk", "Bought NVDA drafts reviewed by Risk.");
    await notes.writeNote("eqlty-desk", "watchlist", "Watchlist", "NVDA, AAPL, TSLA");
    const reopened = new NoteStore(root, KEY);
    const desk = await reopened.search("NVDA", { scopes: ["eqlty-desk"] });
    expect(desk.map((h) => h.id).sort()).toEqual(["eqlty-desk/journal/2026-09-26", "eqlty-desk/notes/watchlist"]);
    expect(await reopened.search("NVDA", { scopes: ["user"] })).toEqual([]);
    expect((await reopened.search("risk", { scopes: ["user", "eqlty-desk"] })).length).toBe(2);
  });

  it("does not match on short or common words", async () => {
    const { notes } = store();
    await notes.appendJournal("user", "Person: My budget for stocks is 500 USDG a month.");
    expect(await notes.search("Watch NVDA for me", { scopes: ["user"] })).toEqual([]);
    expect(await notes.search("¿Qué es lo que hay para mí?", { scopes: ["user"] })).toEqual([]);
    expect((await notes.search("what is my budget", { scopes: ["user"] })).length).toBe(1);
    expect((await notes.search("budgets", { scopes: ["user"] })).length).toBe(1);
  });

  it("builds a short context block for a prompt", async () => {
    const { notes } = store();
    await notes.appendJournal("user", "My budget for stocks is 500 USDG a month.");
    const context = await notes.contextFor("what is my budget", ["user"]);
    expect(context).toContain("Journal 2026-09-26 (2026-09-26)");
    expect(context).toContain("500 USDG");
    expect(await notes.contextFor("unrelated words here", ["user"])).toBe("");
  });

  it("records the key on a new vault and tells whether another key opens it", async () => {
    const { root, notes } = store();
    expect(await notes.claim()).toBe(true);
    expect(readFileSync(join(root, "key-check.json"), "utf8")).not.toContain("perkos-vault-check");
    expect(await new NoteStore(root, KEY).claim()).toBe(true);
    expect(await new NoteStore(root, deriveVaultKey(WALLET, "0x02")).claim()).toBe(false);
    await notes.appendJournal("user", "hello");
    expect((await new NoteStore(root, KEY).list()).map((n) => n.id)).toEqual(["user/journal/2026-09-26"]);
  });

  it("does not write over a note that the key cannot open", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "kept");
    await notes.writeNote("user", "goals", "Goals", "kept too");
    const other = new NoteStore(root, deriveVaultKey(WALLET, "0x02"), () => DAY);
    await expect(other.appendJournal("user", "new")).rejects.toBeInstanceOf(VaultKeyMismatch);
    await expect(other.writeNote("user", "goals", "Goals", "new")).rejects.toBeInstanceOf(VaultKeyMismatch);
    const reopened = new NoteStore(root, KEY);
    expect((await reopened.read("user/journal/2026-09-26"))?.body).toBe("kept");
    expect((await reopened.read("user/notes/goals"))?.body).toBe("kept too");
  });

  it("keeps every entry when appends run at the same time", async () => {
    const { root, notes } = store();
    await Promise.all(["one", "two", "three", "four"].map((e) => notes.appendJournal("user", e)));
    const body = (await new NoteStore(root, KEY).read("user/journal/2026-09-26"))?.body ?? "";
    expect(body.split("\n\n").sort()).toEqual(["four", "one", "three", "two"]);
    expect(readdirSync(join(root, "user", "journal"))).toEqual(["2026-09-26.json"]);
  });

  it("reads only note ids", async () => {
    const { notes } = store();
    await notes.appendJournal("user", "hello");
    expect(await notes.read("user/journal/2026-09-26")).not.toBeNull();
    for (const id of ["../session", "user/../../session", "user/journal", "user/other/x", "user/journal/2026-09-26/x", "User/journal/2026-09-26"]) {
      expect(await notes.read(id)).toBeNull();
    }
  });

  it("forgets a note for good", async () => {
    const { root, notes } = store();
    await notes.appendJournal("user", "My budget is 500 USDG.");
    await notes.writeNote("user", "goals", "Goals", "Grow the budget.");
    expect((await notes.search("budget", { scopes: ["user"] })).length).toBe(2);
    expect(await notes.remove("user/journal/2026-09-26")).toBe(true);
    expect(await notes.remove("user/journal/2026-09-26")).toBe(false);
    expect(await notes.remove("../session")).toBe(false);
    expect((await notes.search("budget", { scopes: ["user"] })).map((h) => h.id)).toEqual(["user/notes/goals"]);
    expect(readdirSync(join(root, "user", "journal"))).toEqual([]);
    expect((await new NoteStore(root, KEY).list()).map((n) => n.id)).toEqual(["user/notes/goals"]);
  });

  describe("desk turns", () => {
    const record = { v: 1, id: "20260926-120000-ab12", secret: "headline-only-in-data" };
    const body = "Asked: How is NVDA doing today?\nAnalyze · Risk medium · 71.4 s\nScout (18.2 s): NVDA holds its range [F1].";

    it("keeps a turn sealed on disk and bound to its id", async () => {
      const { root, notes } = store();
      const turn = await notes.writeTurn("eqlty-desk", record.id, "2026-09-26 12:00 How is NVDA doing today?", body, record);
      expect(turn).toMatchObject({ id: "eqlty-desk/turns/20260926-120000-ab12", scope: "eqlty-desk", kind: "turn" });
      const file = join(root, "eqlty-desk", "turns", `${record.id}.json`);
      const onDisk = readFileSync(file, "utf8");
      expect(onDisk).not.toContain("NVDA");
      expect(onDisk).not.toContain("headline-only-in-data");
      const reopened = await new NoteStore(root, KEY).read(turn.id);
      expect(reopened?.data).toEqual(record);
      expect(reopened?.body).toBe(body);

      mkdirSync(join(root, "other-desk", "turns"), { recursive: true });
      renameSync(file, join(root, "other-desk", "turns", `${record.id}.json`));
      expect(await new NoteStore(root, KEY).read(`other-desk/turns/${record.id}`)).toBeNull();
    });

    it("lists turns of one scope apart from the journal and the notes", async () => {
      const { root, notes } = store();
      await notes.appendJournal("eqlty-desk", "Watch NVDA.");
      await notes.writeNote("eqlty-desk", "memory", "Memory", "## 2026-09-26\nFacts\n- Budget 500 USDG.");
      await notes.writeTurn("eqlty-desk", record.id, "turn", body, record);
      await notes.writeTurn("user", "20260926-120001-cd34", "turn", body, record);
      const reopened = new NoteStore(root, KEY);
      expect((await reopened.list("eqlty-desk", "turn")).map((n) => n.id)).toEqual([`eqlty-desk/turns/${record.id}`]);
      expect((await reopened.list(undefined, "turn")).length).toBe(2);
      expect((await reopened.list("eqlty-desk")).length).toBe(3);
    });

    it("finds a turn by what it says, never by its record, and can search turns alone", async () => {
      const { root, notes } = store();
      await notes.appendJournal("eqlty-desk", "NVDA looked strong this morning.");
      await notes.writeTurn("eqlty-desk", record.id, "2026-09-26 12:00 How is NVDA doing today?", body, record);
      const reopened = new NoteStore(root, KEY);
      expect((await reopened.search("headline", { scopes: ["eqlty-desk"] })).length).toBe(0);
      expect((await reopened.search("NVDA", { scopes: ["eqlty-desk"] })).map((h) => h.id).sort()).toEqual([
        "eqlty-desk/journal/2026-09-26",
        `eqlty-desk/turns/${record.id}`,
      ]);
      expect((await reopened.search("NVDA", { scopes: ["eqlty-desk"], kinds: ["turn"] })).map((h) => h.id)).toEqual([`eqlty-desk/turns/${record.id}`]);
      expect(await reopened.contextFor("NVDA", ["eqlty-desk"], 1800, ["turn"])).toContain("How is NVDA doing today?");
      expect(await reopened.contextFor("NVDA", ["eqlty-desk"], 1800, ["turn"])).not.toContain("looked strong");
    });

    it("forgets a turn for good, and refuses a name that could escape the vault", async () => {
      const { root, notes } = store();
      await notes.writeTurn("eqlty-desk", record.id, "turn", body, record);
      expect(await notes.remove(`eqlty-desk/turns/${record.id}`)).toBe(true);
      expect(readdirSync(join(root, "eqlty-desk", "turns"))).toEqual([]);
      expect((await notes.search("NVDA", { scopes: ["eqlty-desk"] })).length).toBe(0);
      await expect(notes.writeTurn("eqlty-desk", "../x", "t", "b", {})).rejects.toThrow("Not a turn name");
      await expect(notes.writeTurn("../evil", record.id, "t", "b", {})).rejects.toThrow("Not a scope");
    });
  });

  it("rejects scopes and names that could escape the vault", async () => {
    const { root, notes } = store();
    await expect(notes.appendJournal("../evil", "x")).rejects.toThrow("Not a scope");
    await expect(notes.writeNote("user", "../../x", "t", "b")).rejects.toThrow("Not a note name");
    expect(readdirSync(root)).toEqual([]);
  });
});

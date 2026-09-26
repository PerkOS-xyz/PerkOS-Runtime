/**
 * Encrypted notes: journal by scope, sealed files, search within scopes.
 */

import { mkdtempSync, readdirSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveVaultKey, NoteStore } from "../src/index.ts";

const WALLET = "0xabc0000000000000000000000000000000000001";
const KEY = deriveVaultKey(WALLET, "0x01");
const DAY = new Date("2026-09-26T15:00:00.000Z");

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

  it("builds a short context block for a prompt", async () => {
    const { notes } = store();
    await notes.appendJournal("user", "My budget for stocks is 500 USDG a month.");
    const context = await notes.contextFor("what is my budget", ["user"]);
    expect(context).toContain("Journal 2026-09-26 (2026-09-26)");
    expect(context).toContain("500 USDG");
    expect(await notes.contextFor("unrelated words here", ["user"])).toBe("");
  });

  it("rejects scopes and names that could escape the vault", async () => {
    const { root, notes } = store();
    await expect(notes.appendJournal("../evil", "x")).rejects.toThrow("Not a scope");
    await expect(notes.writeNote("user", "../../x", "t", "b")).rejects.toThrow("Not a note name");
    expect(readdirSync(root)).toEqual([]);
  });
});

/**
 * Sparky's memory for a wallet: the encrypted notes in
 * ~/.perkos-runtime/vault/<wallet>, opened with the key from the vault keystore.
 */

import { rename } from "node:fs/promises";
import { join } from "node:path";

import { ChatStore, isScope, NoteStore } from "@perkos/vault";

import { homeDir } from "./home";
import { MEMORY_SLUG } from "./memoryNote";
import { vaultKeys } from "./vault";

const open = new Map<string, { key: Buffer; notes: NoteStore }>();
const chatStores = new Map<string, { key: Buffer; root: string; chats: ChatStore }>();

export const vaultRoot = (wallet: string) => join(homeDir(), "vault", wallet.toLowerCase());

/** The wallet's notes while memory is on, reusing the open store and its search index. */
export async function memoryFor(wallet: string | null): Promise<NoteStore | null> {
  if (!wallet) return null;
  const w = wallet.toLowerCase();
  const key = await vaultKeys.load(w);
  if (!key) return null;
  const hit = open.get(w);
  if (hit?.key.equals(key)) return hit.notes;
  const notes = new NoteStore(vaultRoot(w), key);
  // A key kept from before the vault had a check: record it now.
  if (!(await notes.claim().catch(() => false))) return null;
  open.set(w, { key, notes });
  return notes;
}

/** Closes the wallet's open notes, so the key is no longer held here. */
export function closeMemory(wallet: string): void {
  open.delete(wallet.toLowerCase());
  chatStores.delete(wallet.toLowerCase());
}

/** The wallet's saved chats while memory is on: sealed with the same key, after the same key check. */
export async function chatsFor(wallet: string | null): Promise<ChatStore | null> {
  if (!wallet || !(await memoryFor(wallet))) return null;
  const w = wallet.toLowerCase();
  const key = open.get(w)?.key;
  if (!key) return null;
  const root = vaultRoot(w);
  const hit = chatStores.get(w);
  if (hit?.key.equals(key) && hit.root === root) return hit.chats;
  const chats = new ChatStore(root, key);
  chatStores.set(w, { key, root, chats });
  return chats;
}

/** Moves the wallet's memory aside, still encrypted, so a new one can start. */
export async function setMemoryAside(wallet: string): Promise<void> {
  closeMemory(wallet);
  const root = vaultRoot(wallet);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(root, `${root}-${stamp}`).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
}

/** Where an exchange is kept: the open desk's notes, or the person's own. */
export const scopeFor = (desk?: string) => (desk && isScope(desk) ? desk : "user");

/** What Sparky may recall: the person's notes plus the open desk's, or every desk's from the general chat. */
export function recallScopes(desk: string | undefined, deskIds: string[]): string[] {
  const scope = scopeFor(desk);
  return scope === "user" ? ["user", ...deskIds.filter(isScope)] : ["user", scope];
}

/** What the desk's Memory note may add to a turn. */
const TEAM_NOTE_CHARS = 400;

/**
 * What a desk turn's team may be told from memory: the desk's earlier turns
 * and its Memory note. Never the person's own conversations: the team runs on
 * PerkOS infra, and the person's words stay on this machine.
 */
export async function teamMemory(notes: NoteStore, desk: string, question: string, maxChars = 900): Promise<string> {
  if (!isScope(desk) || desk === "user") return "";
  const note = await notes.read(`${desk}/notes/${MEMORY_SLUG}`).catch(() => null);
  const kept = note ? note.body.replace(/\s+/g, " ").trim().slice(0, TEAM_NOTE_CHARS) : "";
  const room = Math.max(0, maxChars - kept.length - 40);
  const turns = room ? await notes.contextFor(question, [desk], room, ["turn"]).catch(() => "") : "";
  return [turns ? `Earlier desk turns: ${turns.replace(/\n/g, " ")}` : "", kept ? `Desk notes: ${kept}` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, maxChars);
}

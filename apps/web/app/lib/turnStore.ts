/**
 * Where desk turns are kept, and the lock that allows one live turn per desk.
 *
 * With memory on, each turn is sealed into the desk's scope of the vault and
 * survives a restart. In every case the last turns of each wallet are also
 * kept in this process, so History works for the session with memory off and
 * nothing is ever written in plain text.
 *
 * Both live on `globalThis`: the app runs the Next dev server, which reloads
 * modules on a recompile, and a reload must not drop a live turn's lock or the
 * session's turns. The route, History and Sparky's summary share them.
 */

import type { NoteStore } from "@perkos/vault";

import { failureLabel } from "./turnFailure";
import { isTurnId, turnBody, turnTitle, type TurnReceipt, type TurnRecord } from "./turnRecord";

/** Turns kept per wallet in this process. */
export const SESSION_TURNS = 20;
/** A lock older than this belongs to a turn that can no longer be running. */
const LOCK_STALE_MS = 10 * 60_000;

interface Shared {
  live: Map<string, { id: string; at: number }>;
  session: Map<string, TurnRecord[]>;
}

const KEY = Symbol.for("perkos.runtime.deskTurns");

function shared(): Shared {
  const g = globalThis as unknown as Record<symbol, Shared | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { live: new Map(), session: new Map() };
    g[KEY] = s;
  }
  return s;
}

const lockKey = (wallet: string, desk: string) => `${wallet.toLowerCase()}|${desk}`;

/** Takes the desk's turn lock for this wallet. False while another turn is live. */
export function claimTurn(wallet: string, desk: string, id: string, now = Date.now()): boolean {
  const { live } = shared();
  const key = lockKey(wallet, desk);
  const held = live.get(key);
  if (held && now - held.at < LOCK_STALE_MS) return false;
  live.set(key, { id, at: now });
  return true;
}

/** Gives the lock back, if this turn still holds it. */
export function releaseTurn(wallet: string, desk: string, id: string): void {
  const { live } = shared();
  const key = lockKey(wallet, desk);
  if (live.get(key)?.id === id) live.delete(key);
}

/** The id of the turn live on this desk, or null. */
export function liveTurn(wallet: string, desk: string, now = Date.now()): string | null {
  const held = shared().live.get(lockKey(wallet, desk));
  return held && now - held.at < LOCK_STALE_MS ? held.id : null;
}

/** Forgets this process's turns of a wallet, or of every wallet. */
export function clearSessionTurns(wallet?: string): void {
  const s = shared();
  if (wallet) s.session.delete(wallet.toLowerCase());
  else {
    s.session.clear();
    s.live.clear();
  }
}

function remember(wallet: string, record: TurnRecord): void {
  const { session } = shared();
  const w = wallet.toLowerCase();
  const kept = (session.get(w) ?? []).filter((r) => r.id !== record.id);
  kept.push(record);
  session.set(w, kept.slice(-SESSION_TURNS));
}

const isRecord = (v: unknown): v is TurnRecord =>
  typeof v === "object" && v !== null && (v as TurnRecord).v === 1 && isTurnId((v as TurnRecord).id) && typeof (v as TurnRecord).desk === "string";

/** Keeps a turn: in this process always, and sealed in the vault when memory is on. */
export async function saveTurn(wallet: string, record: TurnRecord, notes: NoteStore | null): Promise<"vault" | "session"> {
  remember(wallet, record);
  if (!notes) return "session";
  try {
    await notes.writeTurn(record.desk, record.id, turnTitle(record), turnBody(record, failureLabel), record);
    return "vault";
  } catch (err) {
    console.warn(`A desk turn was kept for this session only: ${(err as Error).message}`);
    return "session";
  }
}

/** A turn by id: this session's copy first, then the vault. */
export async function getTurn(wallet: string, id: string, notes: NoteStore | null): Promise<TurnRecord | null> {
  if (!isTurnId(id)) return null;
  const mine = shared().session.get(wallet.toLowerCase())?.find((r) => r.id === id);
  if (mine) return mine;
  if (!notes) return null;
  const note = (await notes.list(undefined, "turn")).find((n) => n.id.endsWith(`/turns/${id}`));
  return note && isRecord(note.data) && note.data.id === id ? note.data : null;
}

/** A desk's turns, newest first: the vault's and this session's, each once. */
export async function listTurns(wallet: string, desk: string, notes: NoteStore | null, limit = 40): Promise<TurnRecord[]> {
  const byId = new Map<string, TurnRecord>();
  if (notes) {
    for (const n of await notes.list(desk, "turn")) if (isRecord(n.data)) byId.set(n.data.id, n.data);
  }
  for (const r of shared().session.get(wallet.toLowerCase()) ?? []) if (r.desk === desk) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)).slice(0, Math.max(0, limit));
}

async function update(wallet: string, id: string, notes: NoteStore | null, change: (r: TurnRecord) => TurnRecord): Promise<TurnRecord | null> {
  const current = await getTurn(wallet, id, notes);
  if (!current) return null;
  const next = change(current);
  await saveTurn(wallet, next, notes);
  return next;
}

/** Adds Sparky's closing message to a turn. */
export function setTurnSummary(wallet: string, id: string, summary: string, notes: NoteStore | null): Promise<TurnRecord | null> {
  return update(wallet, id, notes, (r) => ({ ...r, summary: summary.trim().slice(0, 4_000) }));
}

/** Adds the receipt of the order the person approved after a turn. */
export function setTurnReceipt(wallet: string, id: string, receipt: TurnReceipt, notes: NoteStore | null): Promise<TurnRecord | null> {
  return update(wallet, id, notes, (r) => ({ ...r, receipt }));
}

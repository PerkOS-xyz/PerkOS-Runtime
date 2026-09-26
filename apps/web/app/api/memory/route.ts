import type { Note, NoteStore } from "@perkos/vault";

import { guard } from "../../lib/guard";
import { parseJournal } from "../../lib/journal";
import { dropSummary, hasSummary, MEMORY_SLUG, parseMemory } from "../../lib/memoryNote";
import { memoryFor } from "../../lib/memory";
import { cachedDesks } from "../../lib/perkos";
import { sessionWallet } from "../../lib/vault";

const PREVIEW = 180;

/** A row for the list: a day's journal shows its first question and how many exchanges it holds; the Memory note, its latest facts. */
function row(n: Note) {
  const exchanges = n.kind === "journal" ? parseJournal(n.body) : [];
  const latest = n.kind === "note" ? parseMemory(n.body)[0]?.sections.flatMap((s) => s.items) : undefined;
  const text = exchanges[0]?.person ?? (latest?.length ? latest.join(" · ") : n.body);
  return {
    id: n.id,
    scope: n.scope,
    kind: n.kind,
    title: n.title,
    updatedAt: n.updatedAt,
    exchanges: exchanges.length,
    preview: text.length > PREVIEW ? `${text.slice(0, PREVIEW).trimEnd()}…` : text,
  };
}

/** The signed-in wallet's open notes, or the response that says why not: 401 signed out, 423 memory off. */
async function opened(req: Request): Promise<NoteStore | Response> {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  return (await memoryFor(wallet)) ?? Response.json({ error: "locked" }, { status: 423 });
}

// What Sparky remembers, for the memory panel.
//   GET               -> { scopes: [{ id, name, notes }] }   "user" first, then each desk
//   GET ?scope=<id>   -> { notes: [row] }                    newest first
//   GET ?q=<words>    -> { hits: [{ id, scope, name, title, snippet, updatedAt }] }
//   GET ?id=<note id> -> { note }
export async function GET(req: Request) {
  const notes = await opened(req);
  if (notes instanceof Response) return notes;

  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  if (id) {
    const note = await notes.read(id);
    return note ? Response.json({ note }) : Response.json({ error: "not_found" }, { status: 404 });
  }
  const scope = params.get("scope");
  if (scope) return Response.json({ notes: (await notes.list(scope)).map(row) });

  const all = await notes.list();
  const counts = new Map<string, number>([["user", 0]]);
  for (const n of all) counts.set(n.scope, (counts.get(n.scope) ?? 0) + 1);
  const names = new Map((await cachedDesks()).map((d) => [d.id, d.name]));
  const nameOf = (s: string) => (s === "user" ? "You" : (names.get(s) ?? s));

  const q = params.get("q")?.trim().slice(0, 200);
  if (q) {
    const hits = await notes.search(q, { scopes: [...counts.keys()], k: 20 });
    return Response.json({ hits: hits.map((h) => ({ ...h, name: nameOf(h.scope) })) });
  }
  return Response.json({ scopes: [...counts].map(([s, n]) => ({ id: s, name: nameOf(s), notes: n })) });
}

// PUT { id, body } -> { note }. Replaces the text of a note, such as the Memory note. A day's conversations stay as they were said.
export async function PUT(req: Request) {
  const notes = await opened(req);
  if (notes instanceof Response) return notes;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; body?: unknown };
  const note = typeof b.id === "string" ? await notes.read(b.id) : null;
  if (!note) return Response.json({ error: "not_found" }, { status: 404 });
  if (note.kind !== "note") return Response.json({ error: "journal", message: "A day's conversations cannot be edited." }, { status: 400 });
  const body = typeof b.body === "string" ? b.body.slice(0, 60_000) : "";
  if (!body.trim()) return Response.json({ error: "body", message: "The note is empty." }, { status: 400 });
  const slug = note.id.split("/")[2] ?? "";
  return Response.json({ note: await notes.writeNote(note.scope, slug, note.title, body) });
}

// DELETE ?id=<note id> -> { ok: true }. Forgets a day or a note for good. A day also leaves the Memory note.
export async function DELETE(req: Request) {
  const notes = await opened(req);
  if (notes instanceof Response) return notes;
  const note = await notes.read(new URL(req.url).searchParams.get("id") ?? "");
  if (!note || !(await notes.remove(note.id))) return Response.json({ error: "not_found" }, { status: 404 });
  if (note.kind === "journal") {
    const date = note.id.slice(-10);
    const memory = await notes.read(`${note.scope}/notes/${MEMORY_SLUG}`);
    if (memory && hasSummary(memory.body, date)) {
      const rest = dropSummary(memory.body, date);
      if (rest) await notes.writeNote(note.scope, MEMORY_SLUG, memory.title, rest);
      else await notes.remove(memory.id);
    }
  }
  return Response.json({ ok: true });
}

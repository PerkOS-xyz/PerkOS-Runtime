import type { Note } from "@perkos/vault";

import { guard } from "../../lib/guard";
import { parseJournal } from "../../lib/journal";
import { parseMemory } from "../../lib/memoryNote";
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

// What Sparky remembers, for the memory panel. 401 when signed out, 423 while memory is off.
//   GET               -> { scopes: [{ id, name, notes }] }   "user" first, then each desk
//   GET ?scope=<id>   -> { notes: [row] }                    newest first
//   GET ?q=<words>    -> { hits: [{ id, scope, name, title, snippet, updatedAt }] }
//   GET ?id=<note id> -> { note }
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  const notes = await memoryFor(wallet);
  if (!notes) return Response.json({ error: "locked" }, { status: 423 });

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

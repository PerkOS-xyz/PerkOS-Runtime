import { loadSettings } from "../../../lib/settingsStore";
import { appendJournal, listNotes, writeNote, type NoteKind } from "../../../lib/kb";

// GET  /api/kb/notes?kind=&limit=      -> notas recientes del desk activo (+ app)
// POST /api/kb/notes { kind, title, body, ticker?, journal? } -> escribe una nota
//      o agrega al diario del dia (journal: true).
const KINDS: NoteKind[] = ["journal", "analysis", "order", "memory", "decision", "app"];

export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = await loadSettings();
  const kind = u.searchParams.get("kind") as NoteKind | null;
  const notes = await listNotes({ desk: s.fleetTemplateId, kind: kind && KINDS.includes(kind) ? kind : undefined, limit: Number(u.searchParams.get("limit") ?? 40) || 40 });
  return Response.json({ desk: s.fleetTemplateId, notes });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: unknown; title?: unknown; body?: unknown; ticker?: unknown; journal?: unknown; desk?: unknown };
  const s = await loadSettings();
  const desk = typeof b.desk === "string" && b.desk === "app" ? "app" : s.fleetTemplateId;
  const body = typeof b.body === "string" ? b.body.slice(0, 20_000) : "";
  if (!body.trim()) return Response.json({ error: "body" }, { status: 400 });
  try {
    if (b.journal === true) return Response.json({ id: await appendJournal(desk, body) });
    const kind = KINDS.includes(b.kind as NoteKind) ? (b.kind as NoteKind) : "journal";
    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : `${kind} ${new Date().toISOString().slice(0, 16)}`;
    const ticker = typeof b.ticker === "string" ? b.ticker.trim().toUpperCase().slice(0, 12) : undefined;
    return Response.json({ id: await writeNote({ desk, kind, title, body, ticker }) });
  } catch (e) {
    return Response.json({ error: "kb_write_failed", detail: (e as Error).message }, { status: 500 });
  }
}

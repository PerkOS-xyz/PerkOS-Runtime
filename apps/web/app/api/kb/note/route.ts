import { guard } from "../../../lib/guard";
import { notePath, readNoteBody, replaceNote } from "../../../lib/kb";

// GET /api/kb/note?id=<rel>  -> nota completa + ruta absoluta (abrir en Obsidian/Finder)
// PUT /api/kb/note { id, body } -> reemplaza el cuerpo (editor de Notes; memory.md sobre todo)
export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  const n = id ? await readNoteBody(id) : null;
  if (!n) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ...n, path: notePath(id) });
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; body?: unknown };
  const id = typeof b.id === "string" ? b.id.trim() : "";
  const body = typeof b.body === "string" ? b.body.slice(0, 60_000) : "";
  if (!id || !body.trim()) return Response.json({ error: "id_body" }, { status: 400 });
  const ok = await replaceNote(id, body);
  if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
  const n = await readNoteBody(id);
  return Response.json({ ...n, path: notePath(id) });
}

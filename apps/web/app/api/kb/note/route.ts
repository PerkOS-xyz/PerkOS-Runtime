import { notePath, readNoteBody } from "../../../lib/kb";

// GET /api/kb/note?id=<rel> -> nota completa + ruta absoluta (para abrir en Obsidian/Finder)
export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  const n = id ? await readNoteBody(id) : null;
  if (!n) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ...n, path: notePath(id) });
}

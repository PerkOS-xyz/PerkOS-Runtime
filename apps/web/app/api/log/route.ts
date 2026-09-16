import { appendFile } from "node:fs/promises";
import { join } from "node:path";

// El log de debug de la UI tambien va a un archivo del repo (ignorado por git),
// para poder leerlo con `tail -f apps/web/.perkos-debug.log` sin abrir el panel.
// Recibe lotes (array) o una linea suelta.
const file = process.env.PERKOS_DEBUG_LOG?.trim() || join(process.cwd(), ".perkos-debug.log");

type Row = { level?: string; msg?: string; at?: number };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => [])) as Row | Row[];
  const rows = Array.isArray(body) ? body : [body];
  const text = rows
    .map((r) => `${new Date(r.at ?? Date.now()).toISOString()} ${String(r.level ?? "info").padEnd(5)} ${String(r.msg ?? "").replace(/\s+/g, " ").slice(0, 1000)}\n`)
    .join("");
  try { if (text) await appendFile(file, text); } catch {}
  return new Response(null, { status: 204 });
}

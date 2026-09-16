import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// GET /api/desk/log?limit=20[&flagsOnly=1] -> ultimos turnos de la mesa con
// prompts, respuestas, tiempos y las senales del lint de calidad. Fuente:
// ~/.perkos-floor/logs/desk-quality.jsonl (lo escribe /api/fleet/desk).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? 20) || 20));
  const flagsOnly = u.searchParams.get("flagsOnly") === "1";
  const file = join(homedir(), ".perkos-floor", "logs", "desk-quality.jsonl");
  let lines: string[] = [];
  try { lines = (await readFile(file, "utf8")).split("\n").filter(Boolean); } catch { lines = []; }
  const entries = lines.slice(-limit * 3).map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).filter((e): e is Record<string, unknown> => Boolean(e));
  const out = (flagsOnly ? entries.filter((e) => Array.isArray(e.flags) && (e.flags as string[]).length) : entries).slice(-limit).reverse();
  const totals: Record<string, number> = {};
  for (const e of entries) for (const f of (e.flags as string[] | undefined) ?? []) { const k = f.replace(/\(.*\)$/, ""); totals[k] = (totals[k] ?? 0) + 1; }
  return Response.json({ file, count: entries.length, totals, entries: out });
}

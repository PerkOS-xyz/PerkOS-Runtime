import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import MiniSearch from "minisearch";

// Conocimiento local del desk: un vault Markdown (Obsidian-compatible) en
// ~/.perkos-floor/knowledge/<desk>/... que Floor escribe en cada turno y lee
// indexado (MiniSearch, BM25 en memoria, reconstruido desde los archivos al
// arrancar) para dar contexto a la esfera y a la mesa. Nunca secretos.
//
//   <desk>/journal/YYYY-MM-DD.md            turnos del dia (quien dijo que)
//   <desk>/analysis/<TICKER>/<stamp>.md      cada Analysis card
//   <desk>/orders/<draft-id>.md              draft, veredicto, hashes
//   <desk>/memory.md                         hechos estables, editable a mano
//   app/*.md                                 notas del app (compartidas)

export const KB_DIR = process.env.PERKOS_KB_DIR?.trim() || join(homedir(), ".perkos-floor", "knowledge");

export type NoteKind = "journal" | "analysis" | "order" | "memory" | "app";
export type Note = {
  id: string;        // ruta relativa al vault
  desk: string;      // "floor-desk" | "app"
  kind: NoteKind;
  title: string;
  ticker?: string;
  body: string;
  updatedAt: string; // ISO
};

type Doc = Note & { text: string };

let index: MiniSearch<Doc> | null = null;
let docs = new Map<string, Doc>();
let scannedAt = 0;

function newIndex() {
  return new MiniSearch<Doc>({
    fields: ["title", "text", "ticker"],
    storeFields: ["id", "desk", "kind", "title", "ticker", "updatedAt"],
    searchOptions: { boost: { title: 2, ticker: 3 }, fuzzy: 0.15, prefix: true, combineWith: "OR" }
  });
}

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "note";
const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
export const today = (d = new Date()) => d.toISOString().slice(0, 10);

function parseFront(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return { meta, body: raw.slice(m[0].length) };
}

async function readNote(rel: string): Promise<Doc | null> {
  try {
    const full = join(KB_DIR, rel);
    const [raw, st] = await Promise.all([readFile(full, "utf8"), stat(full)]);
    const { meta, body } = parseFront(raw);
    const parts = rel.split("/");
    const desk = meta.desk || parts[0] || "app";
    const kind = (meta.kind as NoteKind) || (parts[0] === "app" ? "app" : parts[1] === "journal" ? "journal" : parts[1] === "analysis" ? "analysis" : parts[1] === "orders" ? "order" : rel.endsWith("memory.md") ? "memory" : "journal");
    const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1] || parts[parts.length - 1].replace(/\.md$/, "");
    return { id: rel, desk, kind, title, ticker: meta.ticker || undefined, body, text: body.slice(0, 20_000), updatedAt: meta.updated || st.mtime.toISOString() };
  } catch {
    return null;
  }
}

async function walk(dir: string, base = ""): Promise<string[]> {
  let out: string[] = [];
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(await walk(join(dir, e.name), rel));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

/** Reconstruye el indice desde los archivos (barato: cientos de notas). */
export async function reindex(force = false): Promise<number> {
  if (index && !force && Date.now() - scannedAt < 60_000) return docs.size;
  await mkdir(KB_DIR, { recursive: true, mode: 0o700 });
  const files = await walk(KB_DIR);
  const next = newIndex();
  const nextDocs = new Map<string, Doc>();
  for (const rel of files) {
    const d = await readNote(rel);
    if (d) { nextDocs.set(rel, d); next.add(d); }
  }
  index = next;
  docs = nextDocs;
  scannedAt = Date.now();
  return docs.size;
}

async function upsertIndex(rel: string) {
  if (!index) await reindex();
  const d = await readNote(rel);
  if (!d || !index) return;
  if (docs.has(rel)) index.discard(rel);
  docs.set(rel, d);
  index.add(d);
}

function front(meta: Record<string, string | undefined>): string {
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${/[:#\n]/.test(String(v)) ? JSON.stringify(v) : v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

const SECRET = /(ocv_|plt_|bk_|sk-|0x[0-9a-f]{64}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,})/gi;
const scrub = (s: string) => s.replace(SECRET, "[redacted]");

/** Crea o reemplaza una nota. Devuelve la ruta relativa. */
export async function writeNote(n: { desk: string; kind: NoteKind; title: string; body: string; ticker?: string; id?: string }): Promise<string> {
  const desk = safe(n.desk);
  let rel: string;
  if (n.id) rel = n.id;
  else if (n.kind === "journal") rel = `${desk}/journal/${today()}.md`;
  else if (n.kind === "analysis") rel = `${desk}/analysis/${(n.ticker ?? "asset").toUpperCase()}/${stamp()}.md`;
  else if (n.kind === "order") rel = `${desk}/orders/${safe(n.title)}.md`;
  else if (n.kind === "memory") rel = `${desk}/memory.md`;
  else rel = `app/${safe(n.title)}.md`;
  const full = join(KB_DIR, rel);
  await mkdir(join(full, ".."), { recursive: true, mode: 0o700 });
  const meta = { title: n.title, desk, kind: n.kind, ticker: n.ticker, updated: new Date().toISOString(), source: "PerkOS Floor" };
  await writeFile(full, `${front(meta)}\n# ${n.title}\n\n${scrub(n.body).trim()}\n`, { mode: 0o600 });
  await upsertIndex(rel);
  return rel;
}

/** Agrega una entrada al diario del dia del desk (crea el archivo si no existe). */
export async function appendJournal(desk: string, entry: string): Promise<string> {
  const rel = `${safe(desk)}/journal/${today()}.md`;
  const full = join(KB_DIR, rel);
  await mkdir(join(full, ".."), { recursive: true, mode: 0o700 });
  let cur = "";
  try { cur = await readFile(full, "utf8"); } catch {}
  const time = new Date().toISOString().slice(11, 16);
  if (!cur) {
    cur = `${front({ title: `${desk} · ${today()}`, desk: safe(desk), kind: "journal", updated: new Date().toISOString(), source: "PerkOS Floor" })}\n# ${desk} · ${today()}\n`;
  }
  cur = cur.replace(/^updated: .*$/m, `updated: ${new Date().toISOString()}`);
  await writeFile(full, `${cur}\n## ${time} UTC\n${scrub(entry).trim()}\n`, { mode: 0o600 });
  await upsertIndex(rel);
  return rel;
}

export type Hit = { id: string; desk: string; kind: NoteKind; title: string; ticker?: string; updatedAt: string; score: number; snippet: string };

/** Busqueda BM25 con boost por desk, por ticker en foco y por recencia. */
export async function searchLocal(query: string, opts: { desk?: string; ticker?: string; k?: number } = {}): Promise<Hit[]> {
  await reindex();
  if (!index || !query.trim()) return [];
  const k = opts.k ?? 6;
  const raw = index.search(query, { boostDocument: (id, _term, stored) => {
    const s = stored as Doc | undefined;
    let b = 1;
    if (opts.desk && s?.desk === safe(opts.desk)) b *= 1.5;
    if (opts.desk && s?.desk !== safe(opts.desk) && s?.desk !== "app") b *= 0.5;
    if (opts.ticker && s?.ticker?.toUpperCase() === opts.ticker.toUpperCase()) b *= 1.6;
    const age = s?.updatedAt ? (Date.now() - Date.parse(s.updatedAt)) / 86_400_000 : 30;
    b *= age < 1 ? 1.4 : age < 7 ? 1.15 : age < 30 ? 1 : 0.8;
    return b;
  } });
  return raw.slice(0, k).map((r) => {
    const d = docs.get(String(r.id));
    const body = d?.body ?? "";
    // Snippet alrededor del primer termino que matchea.
    const term = (r.terms?.[0] ?? "").toLowerCase();
    const i = term ? body.toLowerCase().indexOf(term) : -1;
    const start = Math.max(0, i - 120);
    const snippet = (i >= 0 ? body.slice(start, start + 360) : body.slice(0, 360)).replace(/\s+/g, " ").trim();
    return { id: String(r.id), desk: d?.desk ?? "", kind: d?.kind ?? "journal", title: d?.title ?? String(r.id), ticker: d?.ticker, updatedAt: d?.updatedAt ?? "", score: r.score, snippet };
  });
}

/** Bloque listo para el prompt: lo que este desk ya sabe sobre la pregunta. */
export async function contextFor(query: string, desk: string, ticker?: string, maxChars = 2200): Promise<{ text: string; hits: Hit[] }> {
  const hits = await searchLocal(query, { desk, ticker, k: 6 });
  let text = "";
  for (const h of hits) {
    const line = `- [${h.kind}${h.ticker ? ` ${h.ticker}` : ""} · ${h.updatedAt.slice(0, 16).replace("T", " ")}] ${h.title}: ${h.snippet}\n`;
    if (text.length + line.length > maxChars) break;
    text += line;
  }
  return { text, hits };
}

export async function listNotes(opts: { desk?: string; kind?: NoteKind; limit?: number } = {}): Promise<Note[]> {
  await reindex();
  const desk = opts.desk ? safe(opts.desk) : undefined;
  return [...docs.values()]
    .filter((d) => (!desk || d.desk === desk || d.desk === "app") && (!opts.kind || d.kind === opts.kind))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, opts.limit ?? 40)
    .map(({ text: _t, ...n }) => { void _t; return n; });
}

export async function readNoteBody(id: string): Promise<Note | null> {
  if (/\.\./.test(id) || !id.endsWith(".md")) return null;
  const d = await readNote(id);
  if (!d) return null;
  const { text: _t, ...n } = d; void _t;
  return n;
}

/** Ruta absoluta (para "Open in Obsidian" / Finder). */
export function notePath(id: string): string {
  return join(KB_DIR, id);
}

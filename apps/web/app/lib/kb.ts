import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import MiniSearch from "minisearch";
import { createHash } from "node:crypto";

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
//   shared/*.md                              notas de la persona para todos los desks
//
// Fase 2: embeddings locales (Transformers.js, all-MiniLM-L6-v2 q8, 384 dims,
// ~23 MB en ~/.perkos-floor/models) en .index/vectors.json; busqueda hibrida
// BM25 + coseno (fusion RRF). Resumenes del diario a memory.md via Grok.

export const KB_DIR = process.env.PERKOS_KB_DIR?.trim() || join(homedir(), ".perkos-floor", "knowledge");

export type NoteKind = "journal" | "analysis" | "order" | "memory" | "decision" | "app" | "profile";
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

// ---- vectores ------------------------------------------------------------
type Vec = { hash: string; vec: number[] };
const VEC_FILE = join(KB_DIR, ".index", "vectors.json");
let vectors: Map<string, Vec> | null = null;
let extractorP: Promise<((texts: string[]) => Promise<number[][]>) | null> | null = null;
let embedding = false;

async function loadVectors(): Promise<Map<string, Vec>> {
  if (vectors) return vectors;
  try {
    const raw = JSON.parse(await readFile(VEC_FILE, "utf8")) as Record<string, Vec>;
    vectors = new Map(Object.entries(raw));
  } catch {
    vectors = new Map();
  }
  return vectors;
}
async function saveVectors() {
  if (!vectors) return;
  await mkdir(join(KB_DIR, ".index"), { recursive: true, mode: 0o700 });
  await writeFile(VEC_FILE, JSON.stringify(Object.fromEntries(vectors)), { mode: 0o600 });
}
/** Modelo local, perezoso; null si no se puede cargar (la busqueda sigue con BM25). */
function extractor() {
  if (extractorP) return extractorP;
  extractorP = (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = join(homedir(), ".perkos-floor", "models");
      const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
      return async (texts: string[]) => {
        const out = await pipe(texts, { pooling: "mean", normalize: true });
        return out.tolist() as number[][];
      };
    } catch (e) {
      console.warn("[kb] embeddings unavailable:", (e as Error).message);
      return null;
    }
  })();
  return extractorP;
}
const embedText = (d: Doc) => `${d.title}\n${d.text.slice(0, 900)}`;
// Las embeddings corren en WASM sobre el hilo principal del servidor: de a 4
// textos y cediendo el event loop entre lotes, para que un turno de mesa o un
// status de flota nunca esperen minutos detras de una indexacion.
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));
// Compuerta: mientras una mesa o el principal trabajan (rutas /api/fleet/desk
// y /api/chat), los lotes de embeddings esperan. Un lote de 4 textos bloquea
// el loop varios segundos; quince notas nuevas (perfiles, outlook, siembra)
// retrasaron un turno 3 min. Con la compuerta el turno paga a lo sumo un lote.
let busyUntil = 0;
export function kbBusy(on: boolean, maxMs = 5 * 60_000) { busyUntil = on ? Date.now() + maxMs : 0; }
const isBusy = () => busyUntil > Date.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let embedTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEmbed(delayMs = 4000) {
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = setTimeout(() => { embedTimer = null; void embedMissing().catch(() => undefined); }, delayMs);
}
const hashOf = (t: string) => createHash("sha1").update(t).digest("hex").slice(0, 16);
/** Embebe lo que falte o cambio; en segundo plano, de a 16. */
export async function embedMissing(): Promise<number> {
  if (embedding) return 0;
  embedding = true;
  try {
    const vecs = await loadVectors();
    const todo = [...docs.values()].filter((d) => vecs.get(d.id)?.hash !== hashOf(embedText(d)));
    for (const id of [...vecs.keys()]) if (!docs.has(id)) vecs.delete(id);
    if (!todo.length) return 0;
    const embed = await extractor();
    if (!embed) return 0;
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i += 4) {
      while (isBusy()) await sleep(500);
      const batch = todo.slice(i, i + 4);
      const out = await embed(batch.map(embedText));
      batch.forEach((d, j) => vecs.set(d.id, { hash: hashOf(embedText(d)), vec: out[j] }));
      await yieldLoop();
    }
    await saveVectors();
    console.log(`[kb] embedded ${todo.length} notes in ${Date.now() - t0} ms`);
    return todo.length;
  } finally {
    embedding = false;
  }
}
const cosine = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

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
    const kind = (meta.kind as NoteKind) || (parts[0] === "app" ? (parts[1] === "profiles" ? "profile" : "app") : parts[1] === "journal" ? "journal" : parts[1] === "analysis" ? "analysis" : parts[1] === "orders" ? "order" : rel.endsWith("memory.md") ? "memory" : "journal");
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
  if (!seeded) { seeded = true; await seedBundled().catch((e) => console.warn("[kb] seed:", (e as Error).message)); }
  scheduleEmbed(1500);
  return docs.size;
}

// Notas que viajan con el app (apps/web/knowledge/desk/*.md): que son los B20,
// venues y sizing, metodo del desk. Se siembran en app/ del vault local si
// faltan o si la copia empaquetada es mas nueva, asi cada instalacion arranca
// con el mismo conocimiento base. Las mismas notas viven en PerkOS Knowledge.
let seeded = false;
export const BUNDLED_DIR = process.env.PERKOS_BUNDLED_KB?.trim() || join(process.cwd(), "knowledge", "desk");
export async function seedBundled(): Promise<number> {
  let files: string[] = [];
  try { files = (await readdir(BUNDLED_DIR)).filter((f) => f.endsWith(".md")); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    const raw = await readFile(join(BUNDLED_DIR, f), "utf8").catch(() => "");
    if (!raw) continue;
    const { meta, body } = parseFront(raw);
    const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1] || f.replace(/\.md$/, "");
    const rel = `app/${safe(title)}.md`;
    const cur = docs.get(rel);
    const bundledAt = Date.parse(meta.updated || "") || 0;
    const localAt = cur ? Date.parse(cur.updatedAt) || 0 : 0;
    if (cur && localAt >= bundledAt) continue;
    const text = body.replace(/^#\s+.+\n?/m, "").trim();
    await writeNote({ desk: "app", kind: "app", title, body: text, id: rel, ticker: meta.ticker || undefined });
    n += 1;
  }
  if (n) console.info(`[kb] seeded ${n} bundled note(s)`);
  return n;
}

async function upsertIndex(rel: string) {
  if (!index) await reindex();
  const d = await readNote(rel);
  if (!d || !index) return;
  if (docs.has(rel)) index.discard(rel);
  docs.set(rel, d);
  index.add(d);
  scheduleEmbed();
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
  else if (n.kind === "decision") rel = `${desk}/decisions/${safe(n.title)}.md`;
  else if (n.kind === "memory") rel = `${desk}/memory.md`;
  else if (n.kind === "profile") rel = `app/profiles/${(n.ticker ?? "asset").toUpperCase()}.md`;
  else if (n.desk === "shared") rel = `shared/${safe(n.title)}.md`;
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

function docBoost(s: Doc | undefined, opts: { desk?: string; ticker?: string }): number {
  let b = 1;
  const shared = s?.desk === "app" || s?.desk === "shared";
  if (opts.desk && s?.desk === safe(opts.desk)) b *= 1.5;
  if (opts.desk && s?.desk !== safe(opts.desk) && !shared) b *= 0.5;
  if (opts.ticker && s?.ticker?.toUpperCase() === opts.ticker.toUpperCase()) b *= 1.6;
  if (s?.kind === "memory") b *= 1.3;
  const age = s?.updatedAt ? (Date.now() - Date.parse(s.updatedAt)) / 86_400_000 : 30;
  b *= age < 1 ? 1.4 : age < 7 ? 1.15 : age < 30 ? 1 : 0.8;
  return b;
}

/** Busqueda hibrida: BM25 (MiniSearch) + coseno (MiniLM) fusionados por RRF,
 *  con boost por desk, ticker en foco, memoria y recencia. */
export async function searchLocal(query: string, opts: { desk?: string; ticker?: string; k?: number } = {}): Promise<Hit[]> {
  await reindex();
  if (!index || !query.trim()) return [];
  const k = opts.k ?? 6;
  const lexical = index.search(query, { boostDocument: (_id, _term, stored) => docBoost(stored as Doc | undefined, opts) });
  const rank = new Map<string, { score: number; terms: string[] }>();
  lexical.slice(0, 20).forEach((r, i) => rank.set(String(r.id), { score: 1 / (60 + i), terms: r.terms ?? [] }));
  // Semantica (si el modelo esta): top-20 por coseno, mismo boost, fusion RRF.
  try {
    const vecs = await loadVectors();
    if (vecs.size) {
      const embed = await extractor();
      if (embed) {
        const [q] = await embed([query]);
        const sem = [...vecs.entries()]
          .map(([id, v]) => ({ id, s: cosine(q, v.vec) * docBoost(docs.get(id), opts) }))
          .filter((x) => x.s > 0.12)
          .sort((a, b) => b.s - a.s)
          .slice(0, 20);
        sem.forEach((x, i) => { const cur = rank.get(x.id); rank.set(x.id, { score: (cur?.score ?? 0) + 1 / (60 + i), terms: cur?.terms ?? [] }); });
      }
    }
  } catch { /* BM25 solo */ }
  const fused = [...rank.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, k);
  return fused.map(([id, r]) => {
    const d = docs.get(id);
    const body = d?.body ?? "";
    const term = (r.terms[0] ?? query.split(/\s+/)[0] ?? "").toLowerCase();
    const i = term ? body.toLowerCase().indexOf(term) : -1;
    const start = Math.max(0, i - 120);
    const snippet = (i >= 0 ? body.slice(start, start + 360) : body.slice(0, 360)).replace(/\s+/g, " ").trim();
    return { id, desk: d?.desk ?? "", kind: d?.kind ?? "journal", title: d?.title ?? id, ticker: d?.ticker, updatedAt: d?.updatedAt ?? "", score: r.score, snippet };
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
    .filter((d) => (!desk || d.desk === desk || d.desk === "app" || d.desk === "shared") && (!opts.kind || d.kind === opts.kind))
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

/** Diario de una fecha (o hoy) del desk, crudo. */
export async function readJournal(desk: string, date = today()): Promise<{ id: string; body: string; summarized: boolean } | null> {
  const rel = `${safe(desk)}/journal/${date}.md`;
  try {
    const raw = await readFile(join(KB_DIR, rel), "utf8");
    const { meta, body } = parseFront(raw);
    return { id: rel, body, summarized: meta.summarized === "true" };
  } catch {
    return null;
  }
}
export async function markSummarized(desk: string, date: string): Promise<void> {
  const rel = `${safe(desk)}/journal/${date}.md`;
  const full = join(KB_DIR, rel);
  let raw = "";
  try { raw = await readFile(full, "utf8"); } catch { return; }
  if (/^summarized: true$/m.test(raw)) return;
  raw = raw.replace(/^---\n([\s\S]*?)\n---\n/, (m, inner) => `---\n${inner}\nsummarized: true\n---\n`);
  await writeFile(full, raw, { mode: 0o600 });
  await upsertIndex(rel);
}
/** Agrega una seccion fechada a memory.md del desk (crea si no existe). */
export async function appendMemory(desk: string, heading: string, body: string): Promise<string> {
  const rel = `${safe(desk)}/memory.md`;
  const full = join(KB_DIR, rel);
  await mkdir(join(full, ".."), { recursive: true, mode: 0o700 });
  let cur = "";
  try { cur = await readFile(full, "utf8"); } catch {}
  if (!cur) cur = `${front({ title: `${desk} · memory`, desk: safe(desk), kind: "memory", updated: new Date().toISOString(), source: "PerkOS Floor" })}\n# ${desk} · memory\n\nStable facts, decisions and preferences this desk should keep. Edit freely; Floor appends dated summaries below.\n`;
  cur = cur.replace(/^updated: .*$/m, `updated: ${new Date().toISOString()}`);
  await writeFile(full, `${cur}\n## ${heading}\n${scrub(body).trim()}\n`, { mode: 0o600 });
  await upsertIndex(rel);
  return rel;
}
/** Reemplaza el cuerpo completo de una nota existente (editor de Notes). */
export async function replaceNote(id: string, body: string): Promise<boolean> {
  if (/\.\./.test(id) || !id.endsWith(".md")) return false;
  const full = join(KB_DIR, id);
  let raw = "";
  try { raw = await readFile(full, "utf8"); } catch { return false; }
  const m = raw.match(/^---\n[\s\S]*?\n---\n/);
  const head = (m ? m[0] : "").replace(/^updated: .*$/m, `updated: ${new Date().toISOString()}`);
  await writeFile(full, `${head}${scrub(body).replace(/^\n+/, "")}`, { mode: 0o600 });
  await upsertIndex(id);
  return true;
}

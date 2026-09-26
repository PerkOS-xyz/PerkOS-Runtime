/**
 * Encrypted notes: what the person talks about with Sparky, by scope.
 *
 *   <root>/<scope>/journal/YYYY-MM-DD.json   the day's conversation
 *   <root>/<scope>/notes/<slug>.json          notes and remembered facts
 *   <root>/key-check.json                     tells whether a key opens this vault
 *
 * `scope` is "user" (the person, across desks) or a desk id. Every file is
 * sealed with the vault key and bound to its id. The search index lives in
 * memory only and is rebuilt from the notes when the vault opens.
 */

import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import MiniSearch from "minisearch";

import { isSealed, open, seal, type Sealed } from "./seal.ts";

export type NoteKind = "journal" | "note";

export interface Note {
  /** `<scope>/journal/<date>` or `<scope>/notes/<slug>` */
  id: string;
  scope: string;
  kind: NoteKind;
  title: string;
  body: string;
  updatedAt: string;
}

export interface Hit {
  id: string;
  scope: string;
  title: string;
  snippet: string;
  score: number;
  updatedAt: string;
}

const SCOPE = /^(user|[a-z0-9][a-z0-9-]{0,63})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const KINDS: Record<string, NoteKind> = { journal: "journal", notes: "note" };

export const isScope = (scope: string) => SCOPE.test(scope);

/** The calendar day on this machine, as YYYY-MM-DD. */
export const localDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

const CHECK = "perkos-vault-check-v1";

/** Words too common to tell notes apart, in English and Spanish. */
const COMMON = new Set(
  (
    "the and for you your are was were with this that these those what which who whom how why when where can could would should " +
    "will shall about from have has had not but all any some our out get got just like into than then them they their there here " +
    "its it's i'm i've don't does did done also very too please much many more most such only own same other " +
    "que los las del por para con una uno unos unas mis tus sus como cual cuales pero mas más este esta esto estos estas ese esa eso " +
    "esos esas hay muy sin sobre también tambien fue son está esta estoy están estan ser era han has hemos tengo tiene cómo qué cuál"
  ).split(" "),
);

/** Index and query terms: lowercase, without short or common words. */
const term = (word: string): string | null => {
  const w = word.toLowerCase();
  return w.length < 3 || COMMON.has(w) ? null : w;
};

/** A note is on disk but the key cannot open it, so it is left untouched. */
export class VaultKeyMismatch extends Error {
  constructor(id: string) {
    super(`This key does not open ${id}`);
    this.name = "VaultKeyMismatch";
  }
}

function snippet(body: string, query: string, width = 140): string {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const lower = body.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - width / 2);
  const text = body.slice(start, start + width).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${start + width < body.length ? "…" : ""}`;
}

export class NoteStore {
  private readonly notes = new Map<string, Note>();
  private index: MiniSearch<Note> | null = null;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private file(id: string) {
    return join(this.root, `${id}.json`);
  }

  private async load(id: string): Promise<Note | null> {
    try {
      const sealed: unknown = JSON.parse(await readFile(this.file(id), "utf8"));
      return isSealed(sealed) ? open<Note>(this.key, sealed, id) : null;
    } catch {
      return null;
    }
  }

  /** Runs writes one at a time, so two appends to the same day never race. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Writes through a temporary file, so a crash never leaves half a file. */
  private async write(file: string, sealed: Sealed): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(sealed), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  /** True when a note is on disk but this key cannot open it. */
  private async unreadable(id: string): Promise<boolean> {
    if (this.notes.has(id)) return false;
    const onDisk = await access(this.file(id)).then(() => true, () => false);
    return onDisk && (await this.load(id)) === null;
  }

  private async save(note: Note): Promise<Note> {
    if (await this.unreadable(note.id)) throw new VaultKeyMismatch(note.id);
    await this.write(this.file(note.id), seal(this.key, note, note.id));
    this.notes.set(note.id, note);
    if (this.index) {
      if (this.index.has(note.id)) this.index.replace(note);
      else this.index.add(note);
    }
    return note;
  }

  /**
   * Whether this key opens the vault. A new vault records a check sealed with
   * the key. Some wallets sign the same message differently each time, which
   * gives a different key; that key must not write over the notes.
   */
  async claim(): Promise<boolean> {
    return this.serial(async () => {
      const file = join(this.root, "key-check.json");
      const raw = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (raw === null) {
        await this.write(file, seal(this.key, CHECK, "key-check"));
        return true;
      }
      try {
        const sealed: unknown = JSON.parse(raw);
        return isSealed(sealed) && open<string>(this.key, sealed, "key-check") === CHECK;
      } catch {
        return false;
      }
    });
  }

  /** Appends one entry to today's journal of a scope. */
  async appendJournal(scope: string, entry: string): Promise<Note> {
    if (!isScope(scope)) throw new Error(`Not a scope: ${scope}`);
    return this.serial(async () => {
      const now = this.now();
      const date = localDay(now);
      const id = `${scope}/journal/${date}`;
      const existing = await this.read(id);
      const body = existing ? `${existing.body}\n\n${entry.trim()}` : entry.trim();
      return this.save({ id, scope, kind: "journal", title: `Journal ${date}`, body, updatedAt: now.toISOString() });
    });
  }

  /** Writes (or replaces) a note in a scope. */
  async writeNote(scope: string, slug: string, title: string, body: string): Promise<Note> {
    if (!isScope(scope)) throw new Error(`Not a scope: ${scope}`);
    if (!SLUG.test(slug)) throw new Error(`Not a note name: ${slug}`);
    return this.serial(() =>
      this.save({ id: `${scope}/notes/${slug}`, scope, kind: "note", title, body, updatedAt: this.now().toISOString() }),
    );
  }

  /** A note by id, or null when it is missing, sealed with another key, or not a note id at all. */
  async read(id: string): Promise<Note | null> {
    const [scope = "", dir = "", name = "", ...rest] = id.split("/");
    if (rest.length || !isScope(scope) || !(dir in KINDS) || !SLUG.test(name)) return null;
    const hit = this.notes.get(id);
    if (hit) return hit;
    const note = await this.load(id);
    if (note) this.notes.set(id, note);
    return note;
  }

  /** Deletes a note for good, file and search entry. False when there is no such note this key can open. */
  async remove(id: string): Promise<boolean> {
    if (!(await this.read(id))) return false;
    return this.serial(async () => {
      await rm(this.file(id), { force: true });
      this.notes.delete(id);
      if (this.index?.has(id)) this.index.discard(id);
      return true;
    });
  }

  private async loadAll(): Promise<void> {
    if (this.loaded) return;
    const scopes = await readdir(this.root).catch(() => [] as string[]);
    for (const scope of scopes.filter(isScope)) {
      for (const [dir] of Object.entries(KINDS)) {
        const files = await readdir(join(this.root, scope, dir)).catch(() => [] as string[]);
        for (const f of files.filter((n) => n.endsWith(".json"))) await this.read(`${scope}/${dir}/${f.slice(0, -5)}`);
      }
    }
    this.loaded = true;
  }

  /** Notes, newest first, optionally for one scope. */
  async list(scope?: string): Promise<Note[]> {
    await this.loadAll();
    return [...this.notes.values()].filter((n) => !scope || n.scope === scope).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Full-text search (BM25) over the given scopes. */
  async search(query: string, { scopes, k = 6 }: { scopes: string[]; k?: number }): Promise<Hit[]> {
    await this.loadAll();
    if (!this.index) {
      this.index = new MiniSearch<Note>({
        fields: ["title", "body"],
        storeFields: ["scope", "title", "updatedAt"],
        idField: "id",
        processTerm: term,
      });
      this.index.addAll([...this.notes.values()]);
    }
    if (!query.trim()) return [];
    return this.index
      .search(query, {
        // Prefix and typo matching only on longer words, where they help more than they add noise.
        prefix: (t) => t.length >= 4,
        fuzzy: (t) => (t.length >= 5 ? 0.2 : false),
        boost: { title: 2 },
        filter: (r) => scopes.includes(String(r.scope)),
      })
      .slice(0, k)
      .map((r) => {
        const note = this.notes.get(String(r.id));
        return {
          id: String(r.id),
          scope: String(r.scope),
          title: String(r.title),
          snippet: note ? snippet(note.body, query) : "",
          score: r.score,
          updatedAt: String(r.updatedAt),
        };
      });
  }

  /** What the notes say about a query, as a short block for a prompt. Empty when nothing matches. */
  async contextFor(query: string, scopes: string[], maxChars = 1800): Promise<string> {
    const hits = await this.search(query, { scopes });
    let out = "";
    for (const h of hits) {
      const line = `- ${h.title} (${localDay(new Date(h.updatedAt))}): ${h.snippet}\n`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
    return out.trim();
  }
}

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

import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
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

const CHECK = "perkos-vault-check-v1";

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
      const date = now.toISOString().slice(0, 10);
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

  async read(id: string): Promise<Note | null> {
    const hit = this.notes.get(id);
    if (hit) return hit;
    const note = await this.load(id);
    if (note) this.notes.set(id, note);
    return note;
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
      this.index = new MiniSearch<Note>({ fields: ["title", "body"], storeFields: ["scope", "title", "updatedAt"], idField: "id" });
      this.index.addAll([...this.notes.values()]);
    }
    if (!query.trim()) return [];
    return this.index
      .search(query, { prefix: true, fuzzy: 0.2, boost: { title: 2 }, filter: (r) => scopes.includes(String(r.scope)) })
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
      const line = `- ${h.title} (${h.updatedAt.slice(0, 10)}): ${h.snippet}\n`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
    return out.trim();
  }
}

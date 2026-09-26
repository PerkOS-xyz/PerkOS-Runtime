/**
 * Saved conversations with Sparky, one sealed file per thread:
 *
 *   <root>/<scope>/chats/<id>.json
 *
 * `scope` is where the conversation was held: "home" for the dashboard, or a
 * desk id. The whole thread, its title included, is sealed with the vault key
 * and bound to its scope and id, so a file copied to another desk or renamed
 * to another thread fails to open. Nothing about a thread is on disk in the clear.
 */

import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isScope, VaultKeyMismatch } from "./notes.ts";
import { isSealed, open, seal, type Sealed } from "./seal.ts";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** What the list shows about a thread, without its messages. */
export interface ChatMeta {
  id: string;
  scope: string;
  title: string;
  /** A group the person put it in; empty when none. */
  group: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  count: number;
  preview: string;
}

export interface ChatThread {
  id: string;
  scope: string;
  title: string;
  /** The person renamed it, so the title no longer follows the first message. */
  named: boolean;
  group: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatPatch {
  /** A new title; empty goes back to the first message. */
  title?: string;
  /** A group name; null or empty takes it out of its group. */
  group?: string | null;
  pinned?: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{5,47}$/;
export const NEW_CHAT_TITLE = "New chat";
export const MAX_CHAT_MESSAGES = 200;
const MAX_CONTENT = 20_000;
const MAX_LISTED = 500;

/** A thread id: lowercase letters, digits and dashes, so it can never leave its folder. */
export const isChatId = (id: string) => ID.test(id);

const oneLine = (text: string) => text.trim().replace(/\s+/g, " ");
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Only turns that say something, the latest ones, each within bounds. */
export function cleanChatMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string" &&
        (m as ChatMessage).content.trim() !== "",
    )
    .slice(-MAX_CHAT_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
}

/** The first thing the person asked, on one line. */
export function chatTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  return first ? clip(oneLine(first.content), 64) : NEW_CHAT_TITLE;
}

const preview = (messages: ChatMessage[]) => clip(oneLine(messages[messages.length - 1]?.content ?? ""), 120);

const metaOf = (t: ChatThread): ChatMeta => ({
  id: t.id,
  scope: t.scope,
  title: t.title,
  group: t.group,
  pinned: t.pinned,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  count: t.messages.length,
  preview: preview(t.messages),
});

/** Pinned first, then the most recent. */
export const byPinThenRecent = (a: ChatMeta, b: ChatMeta) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

export class ChatStore {
  private readonly metas = new Map<string, ChatMeta>();
  private readonly listed = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private check(scope: string, id?: string) {
    if (!isScope(scope)) throw new Error(`Not a scope: ${scope}`);
    if (id !== undefined && !isChatId(id)) throw new Error(`Not a chat id: ${id}`);
  }

  private dir(scope: string) {
    return join(this.root, scope, "chats");
  }

  private file(scope: string, id: string) {
    return join(this.dir(scope), `${id}.json`);
  }

  private aad(scope: string, id: string) {
    return `chat|${scope}|${id}`;
  }

  /** Writes one at a time, so an autosave and a rename never undo each other. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(scope: string, id: string): Promise<ChatThread | null> {
    try {
      const sealed: unknown = JSON.parse(await readFile(this.file(scope, id), "utf8"));
      const t = isSealed(sealed) ? open<ChatThread>(this.key, sealed, this.aad(scope, id)) : null;
      return t && t.id === id && t.scope === scope && Array.isArray(t.messages) ? t : null;
    } catch {
      return null;
    }
  }

  /** Through a temporary file, so a crash never leaves half a thread. */
  private async write(t: ChatThread): Promise<ChatMeta> {
    const file = this.file(t.scope, t.id);
    const sealed: Sealed = seal(this.key, t, this.aad(t.scope, t.id));
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(sealed), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    const meta = metaOf(t);
    this.metas.set(`${t.scope}/${t.id}`, meta);
    return meta;
  }

  /** A whole thread, or null when it is missing, sealed with another key, or not a valid id. */
  async read(scope: string, id: string): Promise<ChatThread | null> {
    if (!isScope(scope) || !isChatId(id)) return null;
    return this.load(scope, id);
  }

  /** The threads of one scope, pinned first, then the most recent. */
  async list(scope: string): Promise<ChatMeta[]> {
    this.check(scope);
    if (!this.listed.has(scope)) {
      const names = await readdir(this.dir(scope)).catch(() => [] as string[]);
      const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter(isChatId);
      for (const id of ids.slice(0, MAX_LISTED)) {
        const t = await this.load(scope, id);
        if (t) this.metas.set(`${scope}/${id}`, metaOf(t));
      }
      this.listed.add(scope);
    }
    return [...this.metas.values()].filter((m) => m.scope === scope).sort(byPinThenRecent);
  }

  /** Creates a thread or replaces its messages. The title follows the first message until the person renames it. */
  async save(scope: string, id: string, input: unknown): Promise<ChatMeta> {
    this.check(scope, id);
    const messages = cleanChatMessages(input);
    if (!messages.length) throw new Error("A chat needs at least one message");
    return this.serial(async () => {
      const prev = await this.load(scope, id);
      if (!prev && (await access(this.file(scope, id)).then(() => true, () => false))) throw new VaultKeyMismatch(`${scope}/chats/${id}`);
      const at = this.now().toISOString();
      return this.write({
        id,
        scope,
        title: prev?.named ? prev.title : chatTitle(messages),
        named: prev?.named ?? false,
        group: prev?.group ?? "",
        pinned: prev?.pinned ?? false,
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
        messages,
      });
    });
  }

  /** Renames, groups or pins a thread. Null when there is no such thread this key can open. */
  async update(scope: string, id: string, patch: ChatPatch): Promise<ChatMeta | null> {
    this.check(scope, id);
    return this.serial(async () => {
      const t = await this.load(scope, id);
      if (!t) return null;
      if (typeof patch.title === "string") {
        const title = clip(oneLine(patch.title), 80);
        t.named = title !== "";
        t.title = title || chatTitle(t.messages);
      }
      if (patch.group !== undefined) t.group = clip(oneLine(patch.group ?? ""), 40);
      if (typeof patch.pinned === "boolean") t.pinned = patch.pinned;
      // Organizing a thread keeps its place in time: only a new message moves it up.
      return this.write(t);
    });
  }

  /** Deletes a thread for good. False when there is no such thread this key can open. */
  async remove(scope: string, id: string): Promise<boolean> {
    if (!(await this.read(scope, id))) return false;
    return this.serial(async () => {
      await rm(this.file(scope, id), { force: true });
      this.metas.delete(`${scope}/${id}`);
      return true;
    });
  }
}

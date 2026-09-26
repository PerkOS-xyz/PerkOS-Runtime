/**
 * Small pieces of saved chats that do not need a browser: new thread ids,
 * the spoken or typed commands, how the drawer groups threads, and the words
 * around them.
 */

/** A saved thread as the drawer lists it. */
export interface ChatRow {
  id: string;
  scope: string;
  title: string;
  group: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  count: number;
  preview: string;
}

export interface ChatSection {
  key: string;
  label: string;
  chats: ChatRow[];
}

/** What happened to the conversation on screen when a new chat started. */
export type NewChatOutcome = "saved" | "unsaved" | "empty";

/** A thread id the server accepts: lowercase letters, digits and dashes. */
export function newChatId(now = Date.now(), random: () => number = Math.random): string {
  const tail = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `c-${now.toString(36)}-${tail}`;
}

/** Only the turns that say something: what is worth keeping. */
export function savable<M extends { content: string }>(messages: readonly M[]): M[] {
  return messages.filter((m) => m.content.trim() !== "");
}

/**
 * What a saved chat keeps of a conversation: the person's lines and Sparky's,
 * as text. The team's lines and any screen-only fields (ids, tones) are left
 * out, so the same conversation always gives the same saved thread.
 */
export function keptLines(messages: ReadonlyArray<{ role: string; content: string }>): Array<{ role: "user" | "assistant"; content: string }> {
  return savable(messages)
    .filter((m): m is { role: "user" | "assistant"; content: string } => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}

const NEW_PHRASES = new Set([
  "new chat",
  "start a new chat",
  "new conversation",
  "start a new conversation",
  "nuevo chat",
  "chat nuevo",
  "un nuevo chat",
  "nueva conversacion",
  "empieza un nuevo chat"
]);
const LIST_PHRASES = new Set([
  "show my chats",
  "show chats",
  "my chats",
  "open my chats",
  "open chats",
  "mis chats",
  "ver mis chats",
  "muestra mis chats",
  "muestrame mis chats",
  "abre mis chats"
]);

/**
 * A short exact phrase that starts a new chat or opens the saved ones, typed
 * or spoken, in English or Spanish. Anything longer is a message for Sparky.
 */
export function chatCommand(text: string): "new" | "list" | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |ok |okay |oye )?sparky /, "")
    .replace(/ (please|por favor)$/, "");
  if (NEW_PHRASES.has(t)) return "new";
  if (LIST_PHRASES.has(t)) return "list";
  return null;
}

/**
 * The drawer's sections: Pinned first, then each group by name, then the rest
 * under Chats. Within a section the threads keep their order, most recent first.
 * `query` keeps the threads whose title, group or last line mention it.
 */
export function groupChats(chats: readonly ChatRow[], query = ""): ChatSection[] {
  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter((c) => `${c.title} ${c.group} ${c.preview}`.toLowerCase().includes(q)) : chats;
  const pinned: ChatRow[] = [];
  const rest: ChatRow[] = [];
  const groups = new Map<string, ChatRow[]>();
  for (const c of shown) {
    if (c.pinned) pinned.push(c);
    else if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    else rest.push(c);
  }
  const named = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map(([name, list]) => ({ key: `group:${name}`, label: name, chats: list }));
  return [
    ...(pinned.length ? [{ key: "pinned", label: "Pinned", chats: pinned }] : []),
    ...named,
    ...(rest.length ? [{ key: "chats", label: "Chats", chats: rest }] : [])
  ];
}

/** The groups already in use, to pick from when grouping another thread. */
export function groupNames(chats: readonly ChatRow[]): string[] {
  return [...new Set(chats.map((c) => c.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** When a thread last moved: the time today, "Yesterday", the weekday this week, or the date. */
export function chatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Some ICU versions put a narrow no-break space before AM/PM.
  if (sameDay(d, now)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ");
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  if (d >= weekAgo && d < now) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** The line under Sparky after a new chat starts. */
/** Said when the thread a New chat set aside could not be saved after all. */
export const LOST_SAVE_CAPTION = "New chat. The last one could not be saved in Chats.";

/**
 * Whether Escape belongs to the drawer: only while focus is inside it, so a
 * panel or sheet opened on top of it gets its own Escape first.
 */
export function escapeIsMine(root: { contains(node: Node | null): boolean } | null, active: Element | null): boolean {
  return Boolean(root && active && root.contains(active));
}

export function newChatCaption(outcome: NewChatOutcome): string {
  if (outcome === "saved") return "New chat. The last one is saved in Chats.";
  if (outcome === "unsaved") return "New chat. The last one was not kept: turn on memory to save your chats.";
  return "This is a new chat. Ask me anything.";
}

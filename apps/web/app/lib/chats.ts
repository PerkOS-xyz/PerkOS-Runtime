import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homePath } from "./home";
import { chatKey, KeyRequired, open, seal, type Sealed } from "./chatKey";

// Hilos de conversacion, como en cualquier app de chat: cada hilo es un archivo
// en ~/.perkos-xyz/chats/<wallet>/<id>.json (0600), CIFRADO con la llave de la
// wallet (AES-256-GCM, ver chatKey.ts): en disco no hay texto en claro, ni el
// titulo. Dentro: titulo, grupo, fijado y los mensajes tal como los pinta Floor. Se autoguardan desde la ventana; la
// lista, "New chat", renombrar, agrupar, fijar y borrar salen de aqui.
export type ChatMeta = { id: string; title: string; desk: string; group?: string; pinned?: boolean; createdAt: string; updatedAt: string; count: number; preview?: string };
export type ChatThread = ChatMeta & { messages: unknown[] };

const ID = /^[a-z0-9][a-z0-9-]{5,47}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SECRET = /(ocv_|plt_|bk_[A-Za-z0-9_]{6,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,})/g;

export const validChatId = (id: string) => ID.test(id);
const dirFor = (wallet: string) => { if (!ADDR.test(wallet)) throw new Error("bad wallet"); return homePath("chats", wallet.toLowerCase()); };
const fileFor = (wallet: string, id: string) => { if (!ID.test(id)) throw new Error("bad chat id"); return join(dirFor(wallet), `${id}.json`); };

type Loose = { role?: unknown; text?: unknown };
function titleOf(messages: unknown[]): string {
  const first = (messages as Loose[]).find((m) => m && m.role === "you" && typeof m.text === "string" && m.text.trim());
  const t = typeof first?.text === "string" ? first.text.trim().replace(/\s+/g, " ") : "";
  return t ? (t.length > 64 ? `${t.slice(0, 61)}…` : t) : "New chat";
}
function previewOf(messages: unknown[]): string {
  const last = [...(messages as Loose[])].reverse().find((m) => m && typeof m.text === "string" && m.text.trim());
  return typeof last?.text === "string" ? last.text.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}
const meta = (t: ChatThread): ChatMeta => ({ id: t.id, title: t.title, desk: t.desk, group: t.group || undefined, pinned: t.pinned || undefined, createdAt: t.createdAt, updatedAt: t.updatedAt, count: t.messages.length, preview: previewOf(t.messages) });

async function keyOf(wallet: string): Promise<Buffer> { const k = await chatKey(wallet); if (!k) throw new KeyRequired(); return k; }
async function writeSealed(wallet: string, t: ChatThread): Promise<void> {
  await writeFile(fileFor(wallet, t.id), JSON.stringify(seal(await keyOf(wallet), t)), { mode: 0o600 });
}

export async function getChat(wallet: string, id: string): Promise<ChatThread | null> {
  const key = await keyOf(wallet);
  try { return open<ChatThread>(key, JSON.parse(await readFile(fileFor(wallet, id), "utf8")) as Sealed); } catch { return null; }
}

export async function listChats(wallet: string): Promise<ChatMeta[]> {
  await keyOf(wallet);
  let names: string[] = [];
  try { names = (await readdir(dirFor(wallet))).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out: ChatMeta[] = [];
  for (const n of names.slice(0, 500)) {
    const t = await getChat(wallet, n.replace(/\.json$/, ""));
    if (t && Array.isArray(t.messages)) out.push(meta(t));
  }
  return out.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Crea o reemplaza los mensajes de un hilo. El titulo se deriva del primer mensaje mientras nadie lo haya renombrado. */
export async function saveChat(wallet: string, id: string, input: { messages: unknown[]; desk?: string }): Promise<ChatMeta> {
  const dir = dirFor(wallet);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const prev = await getChat(wallet, id);
  const now = new Date().toISOString();
  const messages = JSON.parse(JSON.stringify(input.messages.slice(-200)).replace(SECRET, "[redacted]")) as unknown[];
  const auto = !prev || prev.title === "New chat" || prev.title === titleOf(prev.messages);
  const t: ChatThread = {
    id, desk: input.desk || prev?.desk || "floor-desk", group: prev?.group, pinned: prev?.pinned,
    title: auto ? titleOf(messages) : prev!.title, createdAt: prev?.createdAt ?? now, updatedAt: now, count: messages.length, messages
  };
  await writeSealed(wallet, t);
  return meta(t);
}

export async function patchChat(wallet: string, id: string, p: { title?: string; group?: string | null; pinned?: boolean }): Promise<ChatMeta | null> {
  const t = await getChat(wallet, id);
  if (!t) return null;
  if (typeof p.title === "string" && p.title.trim()) t.title = p.title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (p.group !== undefined) t.group = p.group ? p.group.trim().replace(/\s+/g, " ").slice(0, 40) : undefined;
  if (typeof p.pinned === "boolean") t.pinned = p.pinned;
  await writeSealed(wallet, t);
  return meta(t);
}

export async function deleteChat(wallet: string, id: string): Promise<boolean> {
  try { await rm(fileFor(wallet, id)); return true; } catch { return false; }
}

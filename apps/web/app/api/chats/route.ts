import { guard } from "../../lib/guard";
import { loadSettings } from "../../lib/settingsStore";
import { deleteChat, getChat, listChats, patchChat, saveChat, validChatId } from "../../lib/chats";
import { chatKey, chatKeyMessage, KeyRequired, unlockWithSignature } from "../../lib/chatKey";

// Hilos de conversacion de la wallet conectada (archivos locales, ver lib/chats.ts).
// GET    /api/chats            -> { chats: ChatMeta[] }
// GET    /api/chats?id=<id>    -> ChatThread
// PUT    /api/chats?id=<id>    { messages, desk? }            -> ChatMeta (autoguardado)
// PATCH  /api/chats?id=<id>    { title?, group?, pinned? }    -> ChatMeta
// DELETE /api/chats?id=<id>                                   -> { ok }
// POST   /api/chats            { signature }                  -> { unlocked } (una vez por computadora)
// Sin llave: 428 { error: "key_required", message } y la ventana pide la firma a la wallet.
async function wallet(): Promise<string | null> {
  const s = await loadSettings();
  return /^0x[0-9a-fA-F]{40}$/.test(s.wallet) ? s.wallet : null;
}
const idOf = (req: Request) => (new URL(req.url).searchParams.get("id") ?? "").trim();
const locked = (w: string) => Response.json({ error: "key_required", message: chatKeyMessage(w) }, { status: 428 });
async function guarded(w: string, run: () => Promise<Response>): Promise<Response> {
  try { return await run(); } catch (e) { if (e instanceof KeyRequired) return locked(w); return Response.json({ error: "chats_failed", detail: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const w = await wallet(); if (!w) return Response.json({ error: "wallet_required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { signature?: unknown };
  if (typeof b.signature !== "string") return (await chatKey(w)) ? Response.json({ unlocked: true }) : locked(w);
  const ok = await unlockWithSignature(w, b.signature);
  return ok ? Response.json({ unlocked: true }) : Response.json({ error: "bad_signature", detail: "The signature does not match the connected wallet" }, { status: 400 });
}

export async function GET(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const w = await wallet(); if (!w) return Response.json({ error: "wallet_required" }, { status: 401 });
  const id = idOf(req);
  if (id && !validChatId(id)) return Response.json({ error: "id" }, { status: 400 });
  return guarded(w, async () => {
    if (!id) return Response.json({ chats: await listChats(w) });
    const t = await getChat(w, id);
    return t ? Response.json(t) : Response.json({ error: "not_found" }, { status: 404 });
  });
}

export async function PUT(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const w = await wallet(); if (!w) return Response.json({ error: "wallet_required" }, { status: 401 });
  const id = idOf(req);
  if (!validChatId(id)) return Response.json({ error: "id" }, { status: 400 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  let body: { messages?: unknown; desk?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return Response.json({ error: "json" }, { status: 400 }); }
  if (!Array.isArray(body.messages)) return Response.json({ error: "messages" }, { status: 400 });
  const messages = body.messages;
  return guarded(w, async () => Response.json(await saveChat(w, id, { messages, desk: typeof body.desk === "string" ? body.desk.slice(0, 40) : undefined })));
}

export async function PATCH(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const w = await wallet(); if (!w) return Response.json({ error: "wallet_required" }, { status: 401 });
  const id = idOf(req);
  if (!validChatId(id)) return Response.json({ error: "id" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; group?: unknown; pinned?: unknown };
  return guarded(w, async () => {
    const t = await patchChat(w, id, { title: typeof b.title === "string" ? b.title : undefined, group: b.group === null ? null : typeof b.group === "string" ? b.group : undefined, pinned: typeof b.pinned === "boolean" ? b.pinned : undefined });
    return t ? Response.json(t) : Response.json({ error: "not_found" }, { status: 404 });
  });
}

export async function DELETE(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const w = await wallet(); if (!w) return Response.json({ error: "wallet_required" }, { status: 401 });
  const id = idOf(req);
  if (!validChatId(id)) return Response.json({ error: "id" }, { status: 400 });
  return Response.json({ ok: await deleteChat(w, id) });
}

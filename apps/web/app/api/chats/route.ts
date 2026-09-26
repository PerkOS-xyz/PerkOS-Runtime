import { cleanChatMessages, isChatId, isScope, VaultKeyMismatch, type ChatStore } from "@perkos/vault";

import { guard } from "../../lib/guard";
import { chatsFor } from "../../lib/memory";
import { sessionWallet } from "../../lib/vault";

const MAX_BODY = 2_000_000;
const LOCKED = "Chats are kept while memory is on. Turn on memory to keep them, encrypted with your wallet.";

type Target = { chats: ChatStore; scope: string; id: string };

/**
 * The signed-in wallet's chats and the thread asked for, or the response that says why not:
 * 401 signed out, 423 memory off, 400 a scope or id that is not valid.
 */
async function target(req: Request, needsId: boolean): Promise<Target | Response> {
  const denied = guard(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const scope = params.get("scope") ?? "";
  const id = params.get("id") ?? "";
  if (!isScope(scope)) return Response.json({ error: "scope", message: "Not a place chats are kept." }, { status: 400 });
  if ((needsId || id) && !isChatId(id)) return Response.json({ error: "id", message: "Not a chat id." }, { status: 400 });
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out", message: "Sign in to keep chats." }, { status: 401 });
  const chats = await chatsFor(wallet);
  if (!chats) return Response.json({ error: "locked", message: LOCKED }, { status: 423 });
  return { chats, scope, id };
}

const notFound = () => Response.json({ error: "not_found", message: "That chat is not here." }, { status: 404 });

/** A thread sealed with another key is left as it is. */
function failed(err: unknown): Response {
  if (err instanceof VaultKeyMismatch) {
    return Response.json({ error: "other_key", message: "This chat was saved with another key, so it stays as it is." }, { status: 409 });
  }
  return Response.json({ error: "chats_failed", message: (err as Error).message }, { status: 500 });
}

// Saved conversations with Sparky, by scope: "home" for the dashboard, or a desk id.
//   GET    ?scope=<s>              -> { chats: [ChatMeta] }   pinned first, then the most recent
//   GET    ?scope=<s>&id=<id>      -> { chat: ChatThread }
export async function GET(req: Request) {
  const t = await target(req, false);
  if (t instanceof Response) return t;
  try {
    if (!t.id) return Response.json({ chats: await t.chats.list(t.scope) });
    const chat = await t.chats.read(t.scope, t.id);
    return chat ? Response.json({ chat }) : notFound();
  } catch (err) {
    return failed(err);
  }
}

//   PUT    ?scope=<s>&id=<id>  { messages }                 -> { chat: ChatMeta }   creates or replaces the messages
export async function PUT(req: Request) {
  const t = await target(req, true);
  if (t instanceof Response) return t;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too_large", message: "This chat is too long to keep." }, { status: 413 });
  let body: { messages?: unknown } | null;
  try {
    body = JSON.parse(raw) as { messages?: unknown } | null;
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  const messages = cleanChatMessages(body?.messages);
  if (!messages.length) return Response.json({ error: "messages", message: "A chat needs at least one message." }, { status: 400 });
  try {
    return Response.json({ chat: await t.chats.save(t.scope, t.id, messages) });
  } catch (err) {
    return failed(err);
  }
}

//   PATCH  ?scope=<s>&id=<id>  { title?, group?, pinned? }  -> { chat: ChatMeta }   empty title or null group clears it
export async function PATCH(req: Request) {
  const t = await target(req, true);
  if (t instanceof Response) return t;
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; group?: unknown; pinned?: unknown };
  try {
    const chat = await t.chats.update(t.scope, t.id, {
      ...(typeof b.title === "string" ? { title: b.title } : {}),
      ...(b.group === null || typeof b.group === "string" ? { group: b.group } : {}),
      ...(typeof b.pinned === "boolean" ? { pinned: b.pinned } : {}),
    });
    return chat ? Response.json({ chat }) : notFound();
  } catch (err) {
    return failed(err);
  }
}

//   DELETE ?scope=<s>&id=<id>                               -> { ok: true }         for good
export async function DELETE(req: Request) {
  const t = await target(req, true);
  if (t instanceof Response) return t;
  try {
    return (await t.chats.remove(t.scope, t.id)) ? Response.json({ ok: true }) : notFound();
  } catch (err) {
    return failed(err);
  }
}

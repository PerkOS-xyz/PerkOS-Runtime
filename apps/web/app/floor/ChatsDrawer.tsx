"use client";

import { useEffect, useState } from "react";

// Cajon de hilos sobre la columna del chat (como la barra lateral de cualquier app
// de chat): el historial vive del lado de la conversacion, no entre las pantallas
// del desk. Los hilos se guardan cifrados con la llave de la wallet (lib/chatKey.ts).
type ChatMeta = { id: string; title: string; desk: string; group?: string; pinned?: boolean; createdAt: string; updatedAt: string; count: number; preview?: string };
export type ChatsBridge = { activeId: string; locked: boolean; canUnlock: boolean; refreshKey: number; onOpen: (id: string) => void; onNew: () => void; onUnlock: () => void; onDeleted: (id: string) => void };

export default function ChatsDrawer({ bridge, onClose }: { bridge: ChatsBridge; onClose: () => void }) {
  const [list, setList] = useState<ChatMeta[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [edit, setEdit] = useState<{ id: string; field: "title" | "group"; value: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState("");
  const [q, setQ] = useState("");
  const load = () => fetch("/api/chats").then(async (r) => { if (r.status === 428) { setLocked(true); setList([]); return; } const j = await r.json(); setLocked(false); setList(j.chats ?? []); }).catch(() => setList([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [bridge.refreshKey, bridge.locked]);
  const patch = async (id: string, body: Record<string, unknown>) => { await fetch(`/api/chats?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); void load(); };
  const del = async (id: string) => { await fetch(`/api/chats?id=${id}`, { method: "DELETE" }); setConfirmDel(""); bridge.onDeleted(id); void load(); };
  const shown = (list ?? []).filter((c) => !q || `${c.title} ${c.group ?? ""} ${c.preview ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, ChatMeta[]>();
  for (const c of shown) { const k = c.pinned ? "Pinned" : c.group || "Chats"; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const order = [...groups.keys()].sort((a, b) => (a === "Pinned" ? -1 : b === "Pinned" ? 1 : a === "Chats" ? 1 : b === "Chats" ? -1 : a.localeCompare(b)));
  const when = (iso: string) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  return (
    <aside className="chat-drawer" aria-label="Your chats">
      <header>
        <b>Chats</b>
        <span className="acts">
          <button type="button" onClick={() => { bridge.onNew(); onClose(); }}>New chat</button>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </span>
      </header>
      <small className="lead">Saved as you go, encrypted on this computer with a key from your wallet.</small>
      {locked || bridge.locked ? (
        <div className="launch-empty">
          <b>Chat history is locked</b>
          <span>One signature from your wallet, once on this computer, derives the key that encrypts your history. It moves no funds and approves nothing.</span>
          {bridge.canUnlock ? <button type="button" onClick={() => bridge.onUnlock()}>Unlock with my wallet</button> : <span>Link your wallet first.</span>}
        </div>
      ) : (
        <>
          <input className="chat-search" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          {list && shown.length === 0 ? <div className="launch-empty"><b>{q ? "No chat matches" : "No chats yet"}</b><span>{q ? "Try another word." : "Ask Sparky anything and the conversation is saved here."}</span></div> : null}
          <div className="chat-groups">
            {order.map((g) => (
              <section key={g}>
                <h4>{g}</h4>
                <ul>
                  {groups.get(g)!.map((c) => (
                    <li key={c.id} className={c.id === bridge.activeId ? "on" : ""}>
                      {edit?.id === c.id ? (
                        <form className="chat-edit" onSubmit={(e) => { e.preventDefault(); void patch(c.id, edit.field === "title" ? { title: edit.value } : { group: edit.value.trim() || null }); setEdit(null); }}>
                          <input autoFocus value={edit.value} placeholder={edit.field === "title" ? "Chat title" : "Group name, empty to remove"} onChange={(e) => setEdit({ ...edit, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
                          <button type="submit">Save</button>
                        </form>
                      ) : (
                        <button type="button" className="chat-open" onClick={() => { bridge.onOpen(c.id); onClose(); }}>
                          <b>{c.title}</b>
                          <small>{c.preview || "…"}</small>
                        </button>
                      )}
                      <span className="chat-meta">{when(c.updatedAt)} · {c.count}</span>
                      <span className="chat-acts">
                        <button type="button" title={c.pinned ? "Unpin" : "Pin to the top"} onClick={() => void patch(c.id, { pinned: !c.pinned })}>{c.pinned ? "Unpin" : "Pin"}</button>
                        <button type="button" title="Rename" onClick={() => setEdit({ id: c.id, field: "title", value: c.title })}>Rename</button>
                        <button type="button" title="Put it in a group" onClick={() => setEdit({ id: c.id, field: "group", value: c.group ?? "" })}>Group</button>
                        {confirmDel === c.id ? <button type="button" className="danger" onClick={() => void del(c.id)}>Confirm</button> : <button type="button" title="Delete this chat" onClick={() => setConfirmDel(c.id)}>Delete</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

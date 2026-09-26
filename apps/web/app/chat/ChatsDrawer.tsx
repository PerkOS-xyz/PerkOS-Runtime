"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import type { VaultState } from "../shell/useVault";
import { chatWhen, escapeIsMine, groupChats, groupNames, type ChatRow } from "./chatsView";
import type { ChatsState } from "./useChats";

type Status = "loading" | "ready" | "locked" | "signed_out" | "error";
type Edit = { id: string; field: "title" | "group"; value: string };

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

/**
 * The saved chats of one place (the dashboard or a desk), over the
 * conversation side: grouped, searchable, and each one can be opened,
 * renamed, pinned, put in a group or deleted.
 */
export function ChatsDrawer({
  scope,
  chats,
  vault,
  onNew,
  onOpen
}: {
  scope: string;
  chats: ChatsState;
  vault: VaultState;
  onNew: () => void;
  /** Puts a saved thread on screen; false when it could not be opened. */
  onOpen: (id: string) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");
  const { setOpen, deleted, version, activeId } = chats;
  const close = useCallback(() => setOpen(false), [setOpen]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/chats?${new URLSearchParams({ scope })}`).catch(() => null);
    if (!res) return setStatus("error");
    if (res.status === 423) return setStatus("locked");
    if (res.status === 401) return setStatus("signed_out");
    const body = (await res.json().catch(() => ({}))) as { chats?: ChatRow[] };
    if (!res.ok || !Array.isArray(body.chats)) return setStatus("error");
    setRows(body.chats);
    setStatus("ready");
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, version, vault.unlocked]);

  // Focus moves into the drawer when it opens, so Escape reaches it first.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Escape closes the drawer before anything else it would close, while focus
  // is inside it: a panel opened on top keeps its own Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !escapeIsMine(rootRef.current, document.activeElement)) return;
      e.stopPropagation();
      if (edit) setEdit(null);
      else if (confirm) setConfirm("");
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, confirm, edit]);

  async function change(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/chats?${new URLSearchParams({ scope, id })}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).catch(() => null);
    setNote(res?.ok ? "" : "That change was not saved. Try again.");
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/chats?${new URLSearchParams({ scope, id })}`, { method: "DELETE" }).catch(() => null);
    setConfirm("");
    if (!res?.ok) return setNote("That chat was not deleted. Try again.");
    setNote("");
    deleted(id);
    await load();
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const row = rows.find((r) => r.id === edit.id);
    const value = edit.value.trim().replace(/\s+/g, " ");
    // Nothing changed: leave the thread as it was, its title still following the first message.
    const same = edit.field === "title" ? value === row?.title : value === row?.group;
    if (!same) void change(edit.id, edit.field === "title" ? { title: value } : { group: value || null });
    setEdit(null);
  }

  async function pick(id: string) {
    if (await onOpen(id)) close();
    else setNote("That chat could not be opened.");
  }

  const sections = groupChats(rows, query);
  const groups = groupNames(rows);
  const off = status === "locked" || (chats.locked && status !== "ready");
  let n = 0;

  return (
    <aside ref={rootRef} tabIndex={-1} className="chats-drawer" aria-label="Saved chats">
      <header className="cd-head">
        <div>
          <span className="kicker">Saved</span>
          <h2>Chats</h2>
        </div>
        <div className="cd-head-acts">
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              onNew();
              close();
            }}
          >
            New chat
          </button>
          <button type="button" className="cd-x" aria-label="Close chats" title="Close (Esc)" onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>
      {off || status === "signed_out" ? null : (
        <p className="cd-seal">
          <LockIcon />
          Saved as you go, sealed with your wallet key on this computer.
        </p>
      )}

      {status === "signed_out" ? (
        <div className="cd-empty">
          <LockIcon />
          <b>Sign in to keep chats</b>
          <span>Your chats are kept with your wallet. This conversation still works; it is just not saved.</span>
        </div>
      ) : off ? (
        <div className="cd-empty">
          <LockIcon />
          <b>Chats are not being kept</b>
          <span>
            {vault.busy
              ? "Approve the signature in your wallet. It moves no funds."
              : vault.conflict
                ? "Your wallet signed differently than last time, so the memory saved on this device stays locked."
                : "Turn on memory and every conversation here is saved as you go, sealed with a key only your wallet can make. This one still works; it is just not kept."}
          </span>
          {vault.error ? <span className="cd-note">{vault.error}</span> : null}
          {vault.conflict ? (
            <button type="button" className="chip-btn" disabled={vault.busy} onClick={() => void vault.startFresh()}>
              Start a new memory
            </button>
          ) : (
            <button type="button" className="chip-btn" disabled={vault.busy} onClick={() => void vault.unlock()}>
              Turn on memory
            </button>
          )}
        </div>
      ) : (
        <>
          <label className="cd-search">
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" spellCheck={false} />
          </label>
          {note ? <p className="cd-note">{note}</p> : null}
          <div className="cd-body">
            {status === "error" ? (
              <div className="cd-empty">
                <b>Chats did not load</b>
                <button type="button" className="chip-btn" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : status === "ready" && !sections.length ? (
              <div className="cd-empty">
                <b>{query ? "No chat matches" : "No chats yet"}</b>
                <span>{query ? "Try another word." : "Ask Sparky anything. The conversation is saved here after each reply."}</span>
              </div>
            ) : null}
            {sections.map((s) => (
              <section key={s.key} className={`cd-section${s.key === "pinned" ? " pinned" : ""}`}>
                <h3>
                  {s.label}
                  <i>{s.chats.length}</i>
                </h3>
                <ul className="cd-list">
                  {s.chats.map((c) => (
                    <li key={c.id} className={`cd-row${c.id === activeId ? " on" : ""}`} style={{ "--i": n++ } as CSSProperties}>
                      {edit?.id === c.id ? (
                        <form className="cd-edit" onSubmit={submitEdit}>
                          <input
                            autoFocus
                            value={edit.value}
                            maxLength={edit.field === "title" ? 80 : 40}
                            list={edit.field === "group" ? "cd-groups" : undefined}
                            placeholder={edit.field === "title" ? "Chat title" : "Group name, empty to remove"}
                            aria-label={edit.field === "title" ? "Chat title" : "Group name"}
                            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                          />
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => setEdit(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button type="button" className="cd-open" onClick={() => void pick(c.id)} aria-current={c.id === activeId ? "true" : undefined}>
                          <b>{c.title}</b>
                          <small>{c.preview || "No words yet"}</small>
                        </button>
                      )}
                      <span className="cd-meta">
                        <time dateTime={c.updatedAt}>{chatWhen(c.updatedAt)}</time>
                        <i title={`${c.count} message${c.count === 1 ? "" : "s"}`}>{c.count}</i>
                      </span>
                      {confirm === c.id ? (
                        <span className="cd-confirm">
                          Delete for good?
                          <button type="button" className="danger" onClick={() => void remove(c.id)}>
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirm("")}>
                            Keep
                          </button>
                        </span>
                      ) : edit?.id === c.id ? null : (
                        <span className="cd-acts">
                          <button type="button" onClick={() => void change(c.id, { pinned: !c.pinned })}>
                            {c.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button type="button" onClick={() => setEdit({ id: c.id, field: "title", value: c.title })}>
                            Rename
                          </button>
                          <button type="button" onClick={() => setEdit({ id: c.id, field: "group", value: c.group })}>
                            {c.group ? "Move" : "Group"}
                          </button>
                          <button type="button" className="danger" onClick={() => setConfirm(c.id)}>
                            Delete
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <datalist id="cd-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </>
      )}
    </aside>
  );
}

/** Above the composer, on the left: the saved chats, and a new chat once this one has messages. */
export function ChatChips({ chats, hasMessages, onNew }: { chats: ChatsState; hasMessages: boolean; onNew: () => void }) {
  return (
    <div className="st-chats">
      <button
        type="button"
        className={`st-chip${chats.locked ? " off" : ""}`}
        aria-expanded={chats.open}
        title={chats.locked ? "Your chats. Turn on memory to keep them." : "Your saved chats"}
        onClick={() => chats.setOpen(!chats.open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Chats
      </button>
      {hasMessages ? (
        <button
          type="button"
          className="st-chip"
          title={chats.locked ? "Start a new conversation. Turn on memory to keep this one." : "Start a new conversation. This one stays saved in Chats."}
          onClick={onNew}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          New chat
        </button>
      ) : null}
    </div>
  );
}

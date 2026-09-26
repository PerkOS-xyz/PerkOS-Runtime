"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { parseJournal } from "../lib/journal";
import { parseMemory } from "../lib/memoryNote";
import { useVault } from "../shell/useVault";
import { useWallet } from "../wallet/context";
import { OPEN_MEMORY, type OpenMemory } from "./open";

type Kind = "journal" | "note";
type Scope = { id: string; name: string; notes: number };
type Row = { id: string; scope: string; kind: Kind; title: string; updatedAt: string; exchanges: number; preview: string };
type Hit = { id: string; scope: string; name: string; title: string; snippet: string; updatedAt: string };
type Note = { id: string; scope: string; kind: Kind; title: string; body: string; updatedAt: string };
type Status = "loading" | "locked" | "ready" | "error";

async function load<T>(query: string): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`/api/memory${query}`).catch(() => null);
  if (!res) return { status: 0, body: null };
  return { status: res.status, body: res.ok ? ((await res.json()) as T) : null };
}

/** The day of a journal (from its id), or of the last change for a note. */
function day(id: string, updatedAt: string) {
  const m = /\/(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(updatedAt);
  return {
    date: String(d.getDate()),
    month: d.toLocaleDateString("en-US", { month: "short" }),
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    long: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  };
}

/** The text with the searched words underlined. */
function marked(text: string, query: string): ReactNode {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

const isMemory = (id: string) => id.endsWith("/notes/memory");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function summarize(body: object): Promise<{ ok: boolean; reason?: string; message?: string }> {
  const res = await fetch("/api/memory/summarize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => null);
  const out = (await res?.json().catch(() => ({}))) as { results?: { reason?: string }[]; message?: string } | undefined;
  return { ok: Boolean(res?.ok), reason: out?.results?.[0]?.reason, message: out?.message };
}

// Earlier days are summarized once per app session, after memory is on.
let pendingAsked = false;

/** The Memory note as days, each with its facts, decisions, preferences and open questions. */
function MemoryDays({ body }: { body: string }) {
  const days = parseMemory(body);
  if (!days.length) return <pre className="mem-raw">{body}</pre>;
  return (
    <div className="mem-days">
      {days.map((d, i) => (
        <section key={d.date} className="mem-day" style={{ "--i": i } as CSSProperties}>
          <h4>{day(`/${d.date}`, d.date).long}</h4>
          {d.sections.length ? (
            d.sections.map((s) => (
              <div key={s.name} className="mem-section">
                <span>{s.name}</span>
                <ul>
                  {s.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="mem-quiet">Nothing lasting that day.</p>
          )}
        </section>
      ))}
    </div>
  );
}

const Lock = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

/**
 * What Sparky remembers, by scope: the person's own conversations and each
 * desk's. Days read as transcripts. Everything is decrypted on this device.
 */
export function MemoryPanel() {
  const vault = useVault(useWallet());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scope, setScope] = useState<OpenMemory>({ scope: "user" });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState({ busy: false, text: "" });
  const search = useRef<HTMLInputElement>(null);
  const current = scope.scope ?? "user";

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenMemory>).detail ?? {};
      setScope({ scope: detail.scope ?? "user", ...(detail.name ? { name: detail.name } : {}) });
      setNote(null);
      setQuery("");
      setOpen(true);
    };
    window.addEventListener(OPEN_MEMORY, onOpen);
    return () => window.removeEventListener(OPEN_MEMORY, onOpen);
  }, []);

  // The scopes, again whenever the panel opens or memory is turned on or off.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setStatus("loading");
    void load<{ scopes: Scope[] }>("").then(({ status: code, body }) => {
      if (!live) return;
      if (code === 423) return setStatus("locked");
      if (!body) return setStatus("error");
      setScopes(body.scopes);
      setStatus("ready");
    });
    return () => {
      live = false;
    };
  }, [open, vault.unlocked, refresh]);

  useEffect(() => {
    if (!open || status !== "ready") return;
    let live = true;
    setRows(null);
    void load<{ notes: Row[] }>(`?scope=${encodeURIComponent(current)}`).then(({ body }) => {
      if (live) setRows(body?.notes ?? []);
    });
    return () => {
      live = false;
    };
  }, [open, status, current, refresh]);

  useEffect(() => {
    if (!vault.unlocked || pendingAsked) return;
    pendingAsked = true;
    void summarize({ pending: true }).then(() => setRefresh((n) => n + 1));
  }, [vault.unlocked]);

  useEffect(() => setSummary({ busy: false, text: "" }), [current]);

  const summarizeToday = async () => {
    setSummary({ busy: true, text: "" });
    const r = await summarize({ scope: current, force: true });
    setSummary({
      busy: false,
      text: !r.ok
        ? (r.message ?? "Could not summarize today. Try again in a moment.")
        : r.reason === "empty"
          ? "Not enough from today to summarize yet."
          : r.reason === "busy"
            ? "Today is being summarized already."
            : "Today is in Memory now."
    });
    setRefresh((n) => n + 1);
  };

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    let live = true;
    const t = setTimeout(() => {
      void load<{ hits: Hit[] }>(`?q=${encodeURIComponent(q)}`).then(({ body }) => {
        if (live) setHits(body?.hits ?? []);
      });
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [open]);

  // Escape steps back: out of editing, out of the question, out of the note, then closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing !== null) setEditing(null);
      else if (confirming) setConfirming(false);
      else if (note) setNote(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, note, editing, confirming, close]);

  useEffect(() => {
    setEditing(null);
    setConfirming(false);
    setNoteError("");
  }, [note?.id]);

  const openNote = async (id: string) => {
    const { body } = await load<{ note: Note }>(`?id=${encodeURIComponent(id)}`);
    if (body) setNote(body.note);
  };

  const saveNote = async () => {
    if (!note || editing === null) return;
    setSaving(true);
    setNoteError("");
    const res = await fetch("/api/memory", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: note.id, body: editing })
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { note?: Note; message?: string } | null;
    setSaving(false);
    if (!res?.ok || !out?.note) return setNoteError(out?.message ?? "Could not save the note. Try again in a moment.");
    setNote(out.note);
    setEditing(null);
    setRefresh((n) => n + 1);
  };

  const forgetNote = async () => {
    if (!note) return;
    const res = await fetch(`/api/memory?id=${encodeURIComponent(note.id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setNoteError("Could not forget it. Try again in a moment.");
    setNote(null);
    setRefresh((n) => n + 1);
  };

  // A desk opened from its own screen shows up even before it has notes.
  const chips = scopes.some((s) => s.id === current) ? scopes : [...scopes, { id: current, name: scope.name ?? current, notes: 0 }];
  const scopeName = chips.find((s) => s.id === current)?.name ?? current;

  let body: ReactNode;
  if (status === "locked") {
    body = (
      <div className="mem-empty">
        <img src="/sparky-samurai-head.png" alt="" />
        <p>
          {vault.conflict
            ? "Your wallet signed differently than last time, so the memory saved on this device stays locked."
            : "Memory is off. Turn it on and Sparky keeps your conversations, encrypted with your wallet, on this device."}
        </p>
        {vault.error ? <p className="hint err">{vault.error}</p> : null}
        <button
          type="button"
          className="chip-btn"
          disabled={vault.busy || vault.unlocked === null}
          onClick={() => void (vault.conflict ? vault.startFresh() : vault.unlock())}
        >
          {vault.busy ? "Waiting for the signature…" : vault.conflict ? "Start a new memory" : "Turn on memory"}
        </button>
      </div>
    );
  } else if (status === "error") {
    body = <p className="mem-empty">Could not read the memory. Try again in a moment.</p>;
  } else if (note) {
    const exchanges = note.kind === "journal" ? parseJournal(note.body) : [];
    body = (
      <article className="mem-note">
        <div className="mem-note-head">
          <button type="button" className="link-btn mem-back" onClick={() => setNote(null)}>
            ← Back
          </button>
          {editing === null && !confirming ? (
            <div className="mem-note-acts">
              {note.kind === "note" ? (
                <button type="button" className="link-btn" onClick={() => setEditing(note.body)}>
                  Edit
                </button>
              ) : null}
              <button type="button" className="link-btn danger" onClick={() => setConfirming(true)}>
                Forget
              </button>
            </div>
          ) : null}
        </div>
        <h3>{note.kind === "journal" ? day(note.id, note.updatedAt).long : note.title}</h3>
        {confirming ? (
          <div className="mem-confirm" role="alertdialog" aria-label="Forget">
            <p>
              {note.kind === "journal"
                ? "Forget this day? Sparky will no longer remember these conversations or what it kept from them. This cannot be undone."
                : "Forget this note? Sparky will no longer remember it. This cannot be undone."}
            </p>
            <div className="memory-actions">
              <button type="button" className="chip-btn danger" onClick={() => void forgetNote()}>
                Forget
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : null}
        {noteError ? <p className="hint err">{noteError}</p> : null}
        {editing !== null ? (
          <div className="mem-edit">
            {isMemory(note.id) ? <p className="mem-quiet">Each day starts with &quot;## YYYY-MM-DD&quot;. Lines that start with &quot;- &quot; are what Sparky keeps.</p> : null}
            <textarea value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} aria-label="Note text" />
            <div className="memory-actions">
              <button type="button" className="chip-btn" disabled={saving} onClick={() => void saveNote()}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="link-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : isMemory(note.id) ? (
          <MemoryDays body={note.body} />
        ) : exchanges.length ? (
          <ol className="mem-transcript">
            {exchanges.map((e, i) => (
              <li key={i} style={{ "--i": i } as CSSProperties}>
                <time>{e.time}</time>
                <p className="mem-you">
                  <span>You</span>
                  {e.person}
                </p>
                <p className="mem-sparky">
                  <span>Sparky</span>
                  {e.sparky}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <pre className="mem-raw">{note.body}</pre>
        )}
      </article>
    );
  } else if (hits) {
    body = hits.length ? (
      <ul className="mem-rows">
        {hits.map((h, i) => {
          const d = day(h.id, h.updatedAt);
          return (
            <li key={h.id} style={{ "--i": i } as CSSProperties}>
              <button type="button" className="mem-row" onClick={() => void openNote(h.id)}>
                <span className="mem-stamp">
                  <b>{d.date}</b>
                  <small>{d.month}</small>
                </span>
                <span className="mem-text">
                  <span className="mem-title">{h.name}</span>
                  <span className="mem-preview">{marked(h.snippet.replace(/\[(\d{2}:\d{2})\] Person: /g, "$1 · You: "), query)}</span>
                </span>
                <span className="mem-go" aria-hidden>
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="mem-empty">Nothing matches. Try other words.</p>
    );
  } else if (rows && rows.length === 0) {
    body = (
      <div className="mem-empty">
        <img src="/sparky-samurai-head.png" alt="" />
        <p>
          {current === "user"
            ? "Nothing here yet. Talk to Sparky and your conversations show up here, sealed with your wallet."
            : `Nothing from ${scopeName} yet. Talk to Sparky inside the desk and it shows up here.`}
        </p>
      </div>
    );
  } else {
    const ordered = [...(rows ?? [])].sort((a, b) => Number(isMemory(b.id)) - Number(isMemory(a.id)));
    const talkedToday = ordered.some((r) => r.kind === "journal" && r.id.endsWith(`/${today()}`));
    body = (
      <>
        {talkedToday ? (
          <div className="mem-tools">
            <span aria-live="polite">{summary.text || "Sparky keeps what lasts from each day in Memory."}</span>
            <button type="button" className="chip-btn" disabled={summary.busy} onClick={() => void summarizeToday()}>
              {summary.busy ? "Summarizing…" : "Summarize today"}
            </button>
          </div>
        ) : null}
        <ul className="mem-rows" aria-busy={rows === null}>
          {ordered.map((r, i) => {
            const d = day(r.id, r.updatedAt);
            return (
              <li key={r.id} style={{ "--i": i } as CSSProperties}>
                <button type="button" className={`mem-row${isMemory(r.id) ? " pinned" : ""}`} onClick={() => void openNote(r.id)}>
                  {isMemory(r.id) ? (
                    <span className="mem-stamp mem-seal-stamp" aria-hidden>
                      <Lock />
                      <small>Kept</small>
                    </span>
                  ) : (
                    <span className="mem-stamp">
                      <b>{d.date}</b>
                      <small>{d.month}</small>
                      <small>{d.weekday}</small>
                    </span>
                  )}
                  <span className="mem-text">
                    <span className="mem-title">{r.kind === "journal" ? `${r.exchanges} ${r.exchanges === 1 ? "exchange" : "exchanges"}` : r.title}</span>
                    <span className="mem-preview">{r.preview}</span>
                  </span>
                  <span className="mem-go" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <div className={`memory${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="memory-backdrop" onClick={close} />
      <aside className="memory-sheet" role="dialog" aria-label="Memory">
        <header className="mem-head">
          <div>
            <span className="kicker">What Sparky remembers</span>
            <h2>Memory</h2>
            <p className="mem-seal">
              <Lock />
              Sealed with your wallet. It stays on this device.
            </p>
          </div>
          <button type="button" className="bubble-close" aria-label="Close" onClick={close}>
            &times;
          </button>
        </header>
        {status === "ready" ? (
          <>
            <label className="mem-search">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                ref={search}
                value={query}
                placeholder="Search what Sparky remembers"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setNote(null);
                }}
              />
              {query ? (
                <button type="button" className="link-btn" onClick={() => setQuery("")}>
                  Clear
                </button>
              ) : null}
            </label>
            {!query && !note ? (
              <nav className="mem-scopes" aria-label="Whose memory">
                {chips.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`mem-scope${s.id === current ? " on" : ""}`}
                    aria-pressed={s.id === current}
                    onClick={() => setScope({ scope: s.id, name: s.name })}
                  >
                    {s.name}
                    <i>{s.notes}</i>
                  </button>
                ))}
              </nav>
            ) : null}
          </>
        ) : null}
        <div className="mem-body">{body}</div>
      </aside>
    </div>
  );
}

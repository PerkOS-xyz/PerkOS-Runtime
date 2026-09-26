"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type { SparkyChatState } from "./useSparkyChat";

const GREETING = "Hi! Ask me anything, or tell me what you want to get done and I will point you to the right desk.";

/** The conversation view. `mic` is an optional control shown next to Send. */
export function SparkyChat({
  chat,
  greeting = GREETING,
  compact = false,
  mic,
  onSend
}: {
  chat: SparkyChatState;
  greeting?: string;
  compact?: boolean;
  mic?: ReactNode;
  /** Replaces the default send, for example to speak the reply. */
  onSend?: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (onSend) onSend(text);
    else void chat.send(text);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section className={`chat${compact ? " compact" : ""}`}>
      <div className="messages">
        <div className="msg assistant">
          <img src="/sparky.png" alt="" width={28} height={28} />
          <p>{greeting}</p>
        </div>
        {chat.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" ? <img src="/sparky.png" alt="" width={28} height={28} /> : null}
            <p>{m.content || "…"}</p>
          </div>
        ))}
        {chat.error ? <p className="hint err">{chat.error}</p> : null}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Ask Sparky" rows={2} />
        {mic}
        <button type="submit" className="pill small" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

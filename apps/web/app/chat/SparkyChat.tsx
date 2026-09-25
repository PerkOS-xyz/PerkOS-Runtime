"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type Message = { role: "user" | "assistant"; content: string };

const GREETING = "Hi! Ask me anything, or tell me what you want to get done and I will point you to the right desk.";

export function SparkyChat({ greeting = GREETING, desk, compact = false }: { greeting?: string; desk?: string; compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sparky", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, ...(desk ? { desk } : {}) })
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `Sparky could not answer (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const piece = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + piece };
          return next;
        });
        endRef.current?.scrollIntoView({ block: "end" });
      }
    } catch (err) {
      setError((err as Error).message);
      setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className={`chat${compact ? " compact" : ""}`}>
      <div className="messages">
        <div className="msg assistant">
          <img src="/sparky.png" alt="" width={28} height={28} />
          <p>{greeting}</p>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" ? <img src="/sparky.png" alt="" width={28} height={28} /> : null}
            <p>{m.content || "…"}</p>
          </div>
        ))}
        {error ? <p className="hint err">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask Sparky"
          rows={2}
          disabled={busy}
        />
        <button type="submit" className="pill small" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

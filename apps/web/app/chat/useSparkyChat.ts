"use client";

import { useCallback, useRef, useState } from "react";

export type Message = { role: "user" | "assistant"; content: string };

/** Hooks into one reply: when it starts, each streamed piece, and when it ends. */
export type ReplyHooks = { onStart?: () => void; onPiece?: (piece: string) => void; onEnd?: () => void };

export interface SparkyChatState {
  messages: Message[];
  busy: boolean;
  error: string;
  send: (text: string, hooks?: ReplyHooks) => Promise<void>;
  /** Stops the reply in progress; what already arrived stays. */
  abort: () => void;
}

/** Conversation with Sparky. `desk` is the open desk, if any. */
export function useSparkyChat({ desk }: { desk?: string } = {}): SparkyChatState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const send = useCallback(
    async (text: string, hooks: ReplyHooks = {}) => {
      const t = text.trim();
      if (!t) return;
      // A new message replaces a reply that is still arriving.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const history: Message[] = [...messagesRef.current.filter((m) => m.content), { role: "user", content: t }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setBusy(true);
      setError("");
      hooks.onStart?.();
      try {
        const res = await fetch("/api/sparky", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, ...(desk ? { desk } : {}) }),
          signal: controller.signal
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
          hooks.onPiece?.(piece);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
        setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      } finally {
        // A reply replaced by a newer one leaves the state to the newer one.
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
          hooks.onEnd?.();
        }
      }
    },
    [desk]
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  return { messages, busy, error, send, abort };
}

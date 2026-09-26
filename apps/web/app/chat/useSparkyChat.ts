"use client";

import { useCallback, useRef, useState } from "react";

import type { TurnWork } from "../turn/turnState";
import { appendPiece, dropIfEmpty, modelHistory, newMessageId, type Message, type NewMessage, type SparkyTone } from "./messages";

export type { Message, NewMessage, PersonMessage, SparkyMessage, SparkyTone, TeamMessage } from "./messages";

/** Hooks into one reply: when it starts, each streamed piece, and when it ends. */
export type ReplyHooks = { onStart?: () => void; onPiece?: (piece: string) => void; onEnd?: () => void };

export interface SendOptions {
  tone?: SparkyTone;
  /** The desk's last turn, so Sparky can answer about what the team said. */
  about?: string;
}

/** A reply from Sparky with no new line from the person. */
export interface ReplyOptions {
  /** A desk turn that just ended: Sparky sums up what the team said. */
  turn?: string;
  /** The question he answers, when the conversation may not end with it. */
  ask?: string;
  /** With `ask`: his first words while the team wakes. */
  warm?: boolean;
  tone?: SparkyTone;
  turnId?: string;
  work?: TurnWork;
  /** A new reply replaces one still arriving in the same lane. */
  lane?: string;
}

export interface SparkyChatState {
  messages: Message[];
  /** Any reply of Sparky is arriving. */
  busy: boolean;
  /** Ids of Sparky's lines still arriving. */
  replying: string[];
  error: string;
  send: (text: string, hooks?: ReplyHooks, options?: SendOptions) => Promise<void>;
  /** Sparky answers without a new line from the person: a desk turn's summary, or his words while the team wakes. */
  reply: (options: ReplyOptions, hooks?: ReplyHooks) => Promise<void>;
  /** Adds a line, and returns its id. */
  post: (message: NewMessage) => string;
  /** Changes one line. */
  patch: (id: string, change: (m: Message) => Message) => void;
  drop: (id: string) => void;
  /** Stops every reply in progress; what already arrived stays. */
  abort: () => void;
  /** Puts other messages on screen, such as a saved chat, or none for a new one. A reply in progress stops. */
  replace: (messages: Message[]) => void;
}

interface Run {
  lane: string;
  controller: AbortController;
  /** A newer reply in the same lane took its place. */
  replaced: boolean;
}

/** Conversation with Sparky. `desk` is the open desk, if any. */
export function useSparkyChat({ desk }: { desk?: string } = {}): SparkyChatState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [replying, setReplying] = useState<string[]>([]);
  const [error, setError] = useState("");
  const runs = useRef(new Map<string, Run>());
  const messagesRef = useRef<Message[]>([]);

  // Every change goes through here, so the ref is current even between renders:
  // two replies can arrive at once, and a line posted now is read by a reply sent now.
  const update = useCallback((change: (list: Message[]) => Message[]) => {
    const next = change(messagesRef.current);
    if (next === messagesRef.current) return;
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const stream = useCallback(
    async (id: string, lane: string, payload: Record<string, unknown>, hooks: ReplyHooks) => {
      // A new reply replaces one that is still arriving in its lane.
      for (const run of runs.current.values()) {
        if (run.lane === lane) {
          run.replaced = true;
          run.controller.abort();
        }
      }
      const run: Run = { lane, controller: new AbortController(), replaced: false };
      runs.current.set(id, run);
      setReplying([...runs.current.keys()]);
      setError("");
      hooks.onStart?.();
      try {
        const res = await fetch("/api/sparky", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, ...(desk ? { desk } : {}) }),
          signal: run.controller.signal
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
          // A piece that lands after a stop or a replace belongs to nothing on screen.
          if (run.controller.signal.aborted) throw new DOMException("The reply was stopped", "AbortError");
          const piece = decoder.decode(value, { stream: true });
          update((list) => appendPiece(list, id, piece));
          hooks.onPiece?.(piece);
        }
      } catch (err) {
        if (!run.controller.signal.aborted) setError((err as Error).message);
        update((list) => dropIfEmpty(list, id));
      } finally {
        runs.current.delete(id);
        setReplying([...runs.current.keys()]);
        // A reply replaced by a newer one leaves the rest to the newer one.
        if (!run.replaced) hooks.onEnd?.();
      }
    },
    [desk, update]
  );

  const send = useCallback(
    async (text: string, hooks: ReplyHooks = {}, options: SendOptions = {}) => {
      const t = text.trim();
      if (!t) return;
      const history = [...modelHistory(messagesRef.current), { role: "user" as const, content: t }];
      const id = newMessageId();
      update((list) => [...list, { id: newMessageId(), role: "user", content: t }, { id, role: "assistant", content: "", ...(options.tone ? { tone: options.tone } : {}) }]);
      await stream(id, "chat", { messages: history, ...(options.about ? { about: options.about } : {}) }, hooks);
    },
    [stream, update]
  );

  const reply = useCallback(
    async (options: ReplyOptions, hooks: ReplyHooks = {}) => {
      const history = modelHistory(messagesRef.current);
      const id = newMessageId();
      update((list) => [
        ...list,
        {
          id,
          role: "assistant",
          content: "",
          ...(options.tone ? { tone: options.tone } : {}),
          ...(options.turnId ? { turnId: options.turnId } : {}),
          ...(options.work ? { work: options.work } : {})
        }
      ]);
      const payload = {
        messages: history,
        ...(options.turn ? { turn: options.turn } : {}),
        ...(options.ask ? { ask: options.ask } : {}),
        ...(options.warm ? { warm: true } : {})
      };
      await stream(id, options.lane ?? "turn", payload, hooks);
    },
    [stream, update]
  );

  const post = useCallback(
    (message: NewMessage) => {
      const id = newMessageId();
      update((list) => [...list, { ...message, id } as Message]);
      return id;
    },
    [update]
  );

  const patch = useCallback(
    (id: string, change: (m: Message) => Message) => update((list) => (list.some((m) => m.id === id) ? list.map((m) => (m.id === id ? change(m) : m)) : list)),
    [update]
  );

  const drop = useCallback((id: string) => update((list) => (list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : list)), [update]);

  const abort = useCallback(() => {
    for (const run of runs.current.values()) run.controller.abort();
  }, []);

  const replace = useCallback(
    (next: Message[]) => {
      for (const run of runs.current.values()) run.controller.abort();
      setError("");
      // A saved chat may hold lines from before lines had ids.
      update(() => next.map((m) => (m.id ? m : { ...m, id: newMessageId() })));
    },
    [update]
  );

  return { messages, busy: replying.length > 0, replying, error, send, reply, post, patch, drop, abort, replace };
}

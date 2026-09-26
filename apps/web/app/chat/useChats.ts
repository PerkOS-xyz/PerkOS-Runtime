"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { chatCommand, newChatCaption, newChatId, savable, type NewChatOutcome } from "./chatsView";
import type { Message, SparkyChatState } from "./useSparkyChat";

/** How long after a reply ends before the thread is saved. */
const SAVE_MS = 900;
/** A thread keeps its latest messages, as many as the vault keeps. */
const KEEP = 200;

export interface ChatsState {
  /** The thread on screen; empty until its first save. */
  activeId: string;
  /** Whether the drawer of saved chats is open. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Chats are not being kept here: memory is off, or no one is signed in. */
  locked: boolean;
  /** Changes after every save, so the drawer lists the latest. */
  version: number;
  /** Keeps the conversation on screen (when it can) and starts an empty one. */
  newChat: () => NewChatOutcome;
  /** Puts a saved thread on screen, after keeping the one that was there. */
  openChat: (id: string) => Promise<boolean>;
  /** The drawer deleted a thread; when it is the one on screen, the screen clears. */
  deleted: (id: string) => void;
}

const url = (scope: string, id?: string) => `/api/chats?${new URLSearchParams(id ? { scope, id } : { scope })}`;

/**
 * Saved chats for one conversation with Sparky: each thread is saved a moment
 * after every finished reply, sealed with the vault key, under `scope` ("home"
 * or a desk id). While memory is off the conversation still works; it is just
 * not kept, and `locked` says so.
 */
export function useChats({ scope, chat, unlocked }: { scope: string; chat: SparkyChatState; unlocked: boolean | null }): ChatsState {
  const { messages, busy, replace } = chat;
  const [activeId, setActiveId] = useState("");
  const [open, setOpen] = useState(false);
  const [refused, setRefused] = useState(false);
  const [version, setVersion] = useState(0);
  const idRef = useRef("");
  // What is saved of the thread on screen, to skip saving the same thing twice.
  const savedRef = useRef("");
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const locked = unlocked === false || refused;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Memory turned on: saving can start again.
  useEffect(() => {
    if (unlocked) setRefused(false);
  }, [unlocked]);

  const save = useCallback(
    (list: Message[]) => {
      const keep = savable(list).slice(-KEEP);
      const sig = JSON.stringify(keep);
      if (!keep.length || sig === savedRef.current || lockedRef.current) return;
      let id = idRef.current;
      if (!id) {
        id = newChatId();
        idRef.current = id;
        setActiveId(id);
      }
      savedRef.current = sig;
      const undo = () => {
        if (idRef.current === id && savedRef.current === sig) savedRef.current = "";
      };
      void fetch(url(scope, id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: keep }) })
        .then((res) => {
          if (res.ok) return setVersion((v) => v + 1);
          undo();
          if (res.status === 423 || res.status === 401) setRefused(true);
        })
        .catch(undo);
    },
    [scope]
  );

  // Autosave: shortly after a reply ends, only when something changed.
  useEffect(() => {
    if (busy || locked) return;
    const timer = window.setTimeout(() => save(messages), SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [messages, busy, locked, save]);

  // Leaving the desk or the scene keeps what is on screen.
  useEffect(() => () => save(messagesRef.current), [save]);

  const newChat = useCallback((): NewChatOutcome => {
    const had = savable(messagesRef.current).length > 0;
    const kept = had && !lockedRef.current;
    if (kept) save(messagesRef.current);
    idRef.current = "";
    savedRef.current = "";
    setActiveId("");
    replace([]);
    return !had ? "empty" : kept ? "saved" : "unsaved";
  }, [replace, save]);

  const openChat = useCallback(
    async (id: string) => {
      if (id === idRef.current) return true;
      const res = await fetch(url(scope, id)).catch(() => null);
      if (!res) return false;
      if (res.status === 423 || res.status === 401) {
        setRefused(true);
        return false;
      }
      if (!res.ok) return false;
      const body = (await res.json().catch(() => ({}))) as { chat?: { messages?: Message[] } };
      const list = savable(Array.isArray(body.chat?.messages) ? body.chat.messages : []);
      save(messagesRef.current);
      idRef.current = id;
      savedRef.current = JSON.stringify(list);
      setActiveId(id);
      replace(list);
      return true;
    },
    [replace, save, scope]
  );

  const deleted = useCallback(
    (id: string) => {
      if (id !== idRef.current) return;
      idRef.current = "";
      savedRef.current = "";
      setActiveId("");
      replace([]);
    },
    [replace]
  );

  return { activeId, open, setOpen, locked, version, newChat, openChat, deleted };
}

export interface ChatActions {
  /** The line under Sparky after a new chat starts; empty otherwise. */
  caption: string;
  /** Starts a new chat and returns the line that says where the last one went. */
  newChat: (stopFirst?: boolean) => string;
  /** Opens a saved thread; false when it could not be opened. */
  openSaved: (id: string) => Promise<boolean>;
  /**
   * "new chat" or "show my chats", typed or spoken, runs here instead of going
   * to Sparky. Returns what Sparky says about it, or null for anything else.
   */
  command: (text: string, spoken: boolean) => string | null;
}

/**
 * The view's side of saved chats. `working` and `stop` are the view's own: a
 * click stops a reply in progress first; a spoken command arrives between
 * replies and leaves the live conversation listening.
 */
export function useChatActions(chats: ChatsState, { working, stop }: { working: boolean; stop: () => void }): ChatActions {
  const [caption, setCaption] = useState("");

  // Once the new thread is saved, the line about the last one has done its job.
  useEffect(() => {
    if (chats.activeId) setCaption("");
  }, [chats.activeId]);

  const newChat = (stopFirst = true) => {
    if (stopFirst && working) stop();
    const line = newChatCaption(chats.newChat());
    setCaption(line);
    return line;
  };

  const openSaved = async (id: string) => {
    if (working) stop();
    const opened = await chats.openChat(id);
    if (opened) setCaption("");
    return opened;
  };

  const command = (text: string, spoken: boolean) => {
    const asked = chatCommand(text);
    if (asked === "list") {
      chats.setOpen(true);
      return "Here are your chats.";
    }
    return asked === "new" ? newChat(!spoken) : null;
  };

  return { caption, newChat, openSaved, command };
}

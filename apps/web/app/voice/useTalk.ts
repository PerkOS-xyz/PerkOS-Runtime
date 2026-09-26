"use client";

import { useRef } from "react";

import type { ReplyHooks, ReplyOptions, SendOptions, SparkyChatState } from "../chat/useSparkyChat";
import { SentenceSplitter, spoken } from "./sentences";
import { useVoice } from "./useVoice";

export interface TalkOptions {
  /**
   * Where a spoken question goes. Without it, straight to Sparky. A desk
   * passes the same router its typed questions go through, so a task said out
   * loud reaches the team like a typed one.
   */
  route?: (text: string) => void;
  /**
   * Sees each transcript first. When it handles one (such as "new chat") it
   * returns a short line for Sparky to say, and nothing is sent.
   */
  command?: (text: string) => string | null;
}

/**
 * Voice for a conversation with Sparky: what the person says is sent, and the
 * reply is spoken sentence by sentence while it streams in.
 *
 * `command` sees each transcript first. When it handles one (such as "new
 * chat") it returns a short line for Sparky to say, and nothing is sent.
 */
export function useTalk(chat: SparkyChatState, options: TalkOptions = {}) {
  const call = useRef(0);
  const commandRef = useRef(options.command);
  commandRef.current = options.command;
  const voice = useVoice({
    onTranscript: (text) => {
      const said = commandRef.current?.(text) ?? null;
      if (said === null) return options.route ? options.route(text) : talk(text);
      // A turn with no reply: say the line, then listen again in a live conversation.
      voice.beginTurn();
      if (said) voice.speak(said);
      voice.endTurn();
    },
    onInterrupt: () => chat.abort()
  });

  /** Hooks that speak one reply. A newer spoken reply takes the voice from an older one, which goes on in text. */
  function speaking(): ReplyHooks {
    const splitter = new SentenceSplitter();
    const mine = ++call.current;
    const say = (sentences: string[]) => sentences.map(spoken).filter(Boolean).forEach(voice.speak);
    voice.beginTurn();
    return {
      onPiece: (piece) => {
        if (call.current === mine) say(splitter.push(piece));
      },
      onEnd: () => {
        if (call.current !== mine) return;
        say(splitter.flush());
        voice.endTurn();
      }
    };
  }

  function talk(text: string, sendOptions?: SendOptions) {
    void chat.send(text, speaking(), sendOptions);
  }

  /**
   * Speaks a reply that has no new line from the person: a desk turn's summary,
   * or Sparky's first words while the team wakes. While the person is talking
   * to him on purpose, or their words are being read, it stays in text.
   */
  function talkReply(replyOptions: ReplyOptions) {
    const busy = voice.status === "transcribing" || (voice.status === "listening" && !voice.continuous);
    void chat.reply(replyOptions, busy ? {} : speaking());
  }

  /** Sparky stays thinking while the team works on a question; the next reply he speaks takes over. */
  function hold() {
    if (voice.status === "idle" || voice.status === "transcribing") voice.beginTurn();
  }

  function release() {
    voice.endTurn();
  }

  return { voice, talk, talkReply, hold, release };
}

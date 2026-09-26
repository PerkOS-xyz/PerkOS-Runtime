"use client";

import { useRef } from "react";

import type { SparkyChatState } from "../chat/useSparkyChat";
import { SentenceSplitter } from "./sentences";
import { useVoice } from "./useVoice";

/**
 * Voice for a conversation with Sparky: what the person says is sent, and the
 * reply is spoken sentence by sentence while it streams in.
 *
 * `command` sees each transcript first. When it handles one (such as "new
 * chat") it returns a short line for Sparky to say, and nothing is sent.
 */
export function useTalk(chat: SparkyChatState, { command }: { command?: (text: string) => string | null } = {}) {
  const splitter = useRef(new SentenceSplitter());
  const commandRef = useRef(command);
  commandRef.current = command;
  const voice = useVoice({
    onTranscript: (text) => {
      const said = commandRef.current?.(text) ?? null;
      if (said === null) return talk(text);
      // A turn with no reply: say the line, then listen again in a live conversation.
      voice.beginTurn();
      if (said) voice.speak(said);
      voice.endTurn();
    },
    onInterrupt: () => chat.abort()
  });

  function talk(text: string) {
    splitter.current = new SentenceSplitter();
    voice.beginTurn();
    void chat.send(text, {
      onPiece: (piece) => splitter.current.push(piece).forEach(voice.speak),
      onEnd: () => {
        splitter.current.flush().forEach(voice.speak);
        voice.endTurn();
      }
    });
  }

  return { voice, talk };
}

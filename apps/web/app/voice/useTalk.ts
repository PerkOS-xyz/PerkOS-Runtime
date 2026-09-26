"use client";

import { useRef } from "react";

import type { SparkyChatState } from "../chat/useSparkyChat";
import { SentenceSplitter } from "./sentences";
import { useVoice } from "./useVoice";

/**
 * Voice for a conversation with Sparky: what the person says is sent, and the
 * reply is spoken sentence by sentence while it streams in.
 */
export function useTalk(chat: SparkyChatState) {
  const splitter = useRef(new SentenceSplitter());
  const voice = useVoice({
    onTranscript: (text) => talk(text),
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

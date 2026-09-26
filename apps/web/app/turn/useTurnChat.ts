"use client";

import type { DeskAsset, DeskMarket } from "@perkos/desk-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ReplyOptions, SparkyChatState } from "../chat/useSparkyChat";
import type { LaunchTurnFacts } from "../lib/launchTurn";
import type { TurnKind } from "../lib/turnRecord";
import { freshMemo, stopNote, turnChatSteps, type TurnChatStep } from "./turnChat";
import { workOf, type TurnView } from "./turnState";
import { useDeskTurn } from "./useDeskTurn";

/** Sparky's voice, when it works here: his replies are spoken, and he stays attentive while the team works. */
export interface TurnVoice {
  /** Speaks a reply that has no new line from the person. */
  reply: (options: ReplyOptions) => void;
  /** Keeps Sparky thinking out loud, so the microphone does not reopen over the team. */
  hold: () => void;
  release: () => void;
}

export interface TurnChat {
  view: TurnView;
  live: boolean;
  /** The desk's last finished turn, for questions about it. */
  lastTurn: string | null;
  /** Gives the desk's team a task: the person's line, then the turn, then Sparky's summary. */
  ask: (text: string, kind: TurnKind, extra?: { tickers?: string[]; launch?: LaunchTurnFacts }) => Promise<void>;
  /** Stops waiting for the team. The agents already asked are not cancelled on PerkOS. */
  stop: () => void;
}

/**
 * A desk turn, told in the conversation: every event of the turn becomes the
 * lines `turnChatSteps` says, and Sparky speaks around it.
 */
export function useTurnChat({ desk, chat, voice }: { desk: string; chat: SparkyChatState; voice: TurnVoice | null }): TurnChat {
  const turn = useDeskTurn();
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const ask = useCallback(
    async (text: string, kind: TurnKind, extra: { tickers?: string[]; launch?: LaunchTurnFacts } = {}) => {
      chat.post({ role: "user", content: text });
      const memo = freshMemo();
      // Sparky thinks while the team works; the first reply he speaks takes over from here.
      let held = false;
      if (voiceRef.current) {
        voiceRef.current.hold();
        held = true;
      }
      const say = (options: ReplyOptions) => {
        held = false;
        if (voiceRef.current) voiceRef.current.reply(options);
        else void chat.reply(options);
      };
      const run = (step: TurnChatStep, view: TurnView) => {
        switch (step.do) {
          case "principal":
            chat.post({ role: "team", kind: "principal", who: "sparky", content: step.content, turnId: step.turnId, facts: step.facts });
            return;
          case "warm":
            say({ ask: text, warm: true, tone: "warm", lane: "warm" });
            return;
          case "agent":
            chat.post({ role: "team", kind: "agent", who: step.role, content: step.content, turnId: step.turnId, ...(step.agentName ? { agentName: step.agentName } : {}) });
            return;
          case "missed":
            chat.post({ role: "team", kind: "agent", who: step.role, content: "", turnId: step.turnId, failure: { label: step.label, ...(step.detail ? { detail: step.detail } : {}) } });
            return;
          case "note":
            chat.post({ role: "team", kind: "note", who: "sparky", content: step.content, ...(step.turnId ? { turnId: step.turnId } : {}) });
            return;
          case "alone":
            say({ ask: text });
            return;
          case "summary":
            setLastTurn(step.turnId);
            say({ turn: step.turnId, ask: text, tone: "summary", turnId: step.turnId, work: workOf(view), lane: "summary" });
            return;
        }
      };
      const end = await turn.start({ desk, text, kind, ...extra }, (event, view) => {
        for (const step of turnChatSteps(event, view, memo)) run(step, view);
      });
      if (end.end === "refused" || end.end === "busy") {
        // The team could not take this one: Sparky answers on his own, and says why first.
        const why = end.end === "busy" ? "The team is still on the last question." : end.message;
        chat.post({ role: "team", kind: "note", who: "sparky", content: why });
        say(end.end === "busy" ? { ask: text, tone: "to-you" } : { ask: text });
      } else if (end.end === "cut") {
        chat.post({ role: "team", kind: "note", who: "sparky", content: end.message });
      }
      if (held) voiceRef.current?.release();
    },
    [chat, desk, turn]
  );

  const stop = useCallback(() => {
    const view = turn.view;
    if (turn.stop()) chat.post({ role: "team", kind: "note", who: "sparky", content: stopNote(view), ...(view.turnId ? { turnId: view.turnId } : {}) });
  }, [chat, turn]);

  return { view: turn.view, live: turn.live, lastTurn, ask, stop };
}

/**
 * The assets of a desk, read once when it opens, so a question can name a
 * stock in plain words ("how is nvidia doing") and still reach the team.
 * Without them, only tickers in capitals are recognized.
 */
export function useDeskAssets(module: string | undefined, enabled: boolean): DeskAsset[] | undefined {
  const [assets, setAssets] = useState<DeskAsset[] | undefined>(undefined);
  useEffect(() => {
    setAssets(undefined);
    if (!module || !enabled) return;
    let live = true;
    fetch(`/api/desks/market?module=${encodeURIComponent(module)}`)
      .then((res): Promise<{ market?: DeskMarket }> | { market?: DeskMarket } => (res.ok ? res.json() : {}))
      .then((body) => {
        if (live && body.market) setAssets(body.market.assets);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [module, enabled]);
  return assets;
}

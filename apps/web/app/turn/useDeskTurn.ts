"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LaunchTurnFacts } from "../lib/launchTurn";
import type { TurnEvent, TurnKind } from "../lib/turnRecord";
import { cutTurn, idleTurn, pendingTurn, reduceTurn, stopLocally, type TurnView } from "./turnState";
import { TurnFrames } from "./turnStream";

export interface TurnAsk {
  desk: string;
  text: string;
  kind: TurnKind;
  tickers?: string[];
  /** A launch turn's draft. */
  launch?: LaunchTurnFacts;
}

/** How a turn the window asked for came to an end. */
export type TurnEnd =
  /** The route sent `done`. */
  | { end: "done"; turnId: string; view: TurnView }
  /** The route answered with an error before any stream: signed out, a turn already live, a kind the desk does not run. */
  | { end: "refused"; status: number; error: string; message: string }
  /** The turn ended before it opened: the desk's market did not answer. Nothing was kept. */
  | { end: "early"; message: string }
  /** The person stopped waiting. */
  | { end: "stopped" }
  /** The stream closed, or could not be read, before the turn ended. */
  | { end: "cut"; message: string }
  /** Another turn is still live in this window. */
  | { end: "busy" };

/** Called for every event, with the turn as it stands after it and before it. */
export type TurnListener = (event: TurnEvent, view: TurnView, before: TurnView) => void;

export interface DeskTurnState {
  view: TurnView;
  live: boolean;
  start: (ask: TurnAsk, listen?: TurnListener) => Promise<TurnEnd>;
  /**
   * Stops waiting for the team; false when no turn was live. PerkOS has no way
   * to cancel a task, so an agent already asked may still finish there.
   */
  stop: () => boolean;
}

export const CUT_MESSAGE = "The turn's stream closed before it ended. History keeps the turn as far as it got.";

/**
 * One desk turn at a time, streamed from /api/desks/turn and read into a
 * `TurnView`. Closing the stream, by Stop or by leaving the desk, is how the
 * window stops waiting.
 */
export function useDeskTurn(): DeskTurnState {
  const [view, setView] = useState<TurnView>(idleTurn);
  const viewRef = useRef<TurnView>(idleTurn);
  const runRef = useRef<AbortController | null>(null);

  const set = useCallback((next: TurnView) => {
    viewRef.current = next;
    setView(next);
    return next;
  }, []);

  useEffect(() => () => runRef.current?.abort(), []);

  const start = useCallback(
    async (ask: TurnAsk, listen?: TurnListener): Promise<TurnEnd> => {
      if (runRef.current) return { end: "busy" };
      const controller = new AbortController();
      runRef.current = controller;
      set(pendingTurn(ask.text, ask.kind));
      try {
        const res = await fetch("/api/desks/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ desk: ask.desk, text: ask.text, kind: ask.kind, ...(ask.tickers?.length ? { tickers: ask.tickers } : {}), ...(ask.launch ? { launch: ask.launch } : {}) }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          set(idleTurn);
          return { end: "refused", status: res.status, error: body.error ?? "", message: body.message ?? `The team could not start (${res.status}).` };
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const frames = new TurnFrames();
        let early = "";
        const take = (events: TurnEvent[]) => {
          for (const event of events) {
            const before = viewRef.current;
            const next = set(reduceTurn(before, event));
            if (event.step === "error" && before.turnId === null) early = event.message;
            listen?.(event, next, before);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            take([...frames.push(decoder.decode()), ...frames.flush()]);
            break;
          }
          take(frames.push(decoder.decode(value, { stream: true })));
        }
        const last = viewRef.current;
        if (early) return { end: "early", message: early };
        if (last.turnId && !last.live) return { end: "done", turnId: last.turnId, view: last };
        set(cutTurn(last, CUT_MESSAGE));
        return { end: "cut", message: CUT_MESSAGE };
      } catch (err) {
        if (controller.signal.aborted) return { end: "stopped" };
        const message = `The desk turn stopped: ${(err as Error).message}`;
        set(cutTurn(viewRef.current, message));
        return { end: "cut", message };
      } finally {
        if (runRef.current === controller) runRef.current = null;
      }
    },
    [set],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return false;
    // After `done` the stream may still be closing: that is not a turn to stop.
    const live = viewRef.current.live;
    if (live) set(stopLocally(viewRef.current));
    run.abort();
    return live;
  }, [set]);

  return { view, live: view.live, start, stop };
}

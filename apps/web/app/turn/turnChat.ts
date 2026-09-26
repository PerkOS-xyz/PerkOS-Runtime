/**
 * What a desk turn says in the conversation, event by event, and where the
 * person's words go.
 *
 * The rules, in one place so they can be tested without a window:
 *   - Sparky opens the turn with his line to the first roles.
 *   - While the team wakes, Sparky speaks first; the team follows.
 *   - Each agent's answer is its own line; an agent that gave no answer gets
 *     a short line saying why, not a bubble.
 *   - When the whole team could not take part, one note says why, and Sparky
 *     answers on his own.
 *   - Once the turn ends, Sparky sums it up. A turn the person stopped gets
 *     no summary.
 *   - While a turn is live, whatever the person says goes to Sparky alone.
 */

import type { DeskAsset, DeskManifest, DeskStarter } from "@perkos/desk-contract";

import type { TurnEvent, TurnKind } from "../lib/turnRecord";
import { turnKindFor } from "./classify";
import type { TurnView } from "./turnState";

export type TurnChatStep =
  /** Sparky's line to the first roles: "@Scout @Risk <question> Facts attached: ..." */
  | { do: "principal"; turnId: string; content: string; facts: string[] }
  /** Sparky's first words while the team wakes. */
  | { do: "warm" }
  | { do: "agent"; turnId: string; role: string; content: string; agentName?: string }
  /** "Auditor did not answer: model failed" */
  | { do: "missed"; turnId: string; role: string; label: string; detail?: string }
  | { do: "note"; turnId?: string; content: string }
  /** The turn never opened: Sparky answers on his own. */
  | { do: "alone" }
  | { do: "summary"; turnId: string };

/** What one turn has already said, so each thing is said once. */
export interface TurnChatMemo {
  warmed: boolean;
  /** The whole team could not take part, and the note said why. */
  teamDown: boolean;
}

export const freshMemo = (): TurnChatMemo => ({ warmed: false, teamDown: false });

/** The conversation's lines for one event of the turn. `view` is the turn after the event. */
export function turnChatSteps(event: TurnEvent, view: TurnView, memo: TurnChatMemo): TurnChatStep[] {
  switch (event.step) {
    case "open":
      return [{ do: "principal", turnId: event.turnId, content: event.principal, facts: event.facts }];
    case "wake":
      if (memo.warmed || event.waiting.length === 0) return [];
      memo.warmed = true;
      return [{ do: "warm" }];
    case "reply":
      if (!event.ok || !view.turnId) return [];
      return [{ do: "agent", turnId: view.turnId, role: event.role, content: event.reply, ...(event.agentName ? { agentName: event.agentName } : {}) }];
    case "failure":
      if (memo.teamDown || !view.turnId) return [];
      return [{ do: "missed", turnId: view.turnId, role: event.role, label: event.label, ...(event.detail ? { detail: event.detail } : {}) }];
    case "error":
      if (!view.turnId) return [{ do: "note", content: event.message }, { do: "alone" }];
      memo.teamDown = true;
      return [{ do: "note", turnId: view.turnId, content: event.message }];
    case "done":
      return event.stopped ? [] : [{ do: "summary", turnId: event.turnId }];
    default:
      return [];
  }
}

/**
 * What the chat says when the person stops waiting. Honest about what Stop
 * does: it ends the wait here, and an agent already asked may still finish
 * its task on PerkOS.
 */
export function stopNote(view: TurnView): string {
  const asked = Object.values(view.roles).some((r) => r.startedAt !== undefined || r.status === "delivered");
  return asked
    ? "Stopped waiting for the team. Agents already asked may still finish on PerkOS; those answers are not kept."
    : "Stopped before the team was asked.";
}

export interface RouteContext {
  manifest: Pick<DeskManifest, "turns" | "starters"> | null;
  assets?: DeskAsset[];
  starter?: DeskStarter | null;
  /** A turn is live on this desk. */
  live: boolean;
}

export type Route = { to: "team"; kind: TurnKind } | { to: "sparky"; tone?: "to-you" };

/**
 * Where the person's words go, typed or spoken: a desk task to the team,
 * anything else to Sparky alone. While the team works, everything goes to
 * Sparky, who answers the person directly.
 */
export function routeFor(text: string, ctx: RouteContext): Route {
  if (ctx.live) return { to: "sparky", tone: "to-you" };
  const kind = turnKindFor(text, { manifest: ctx.manifest, ...(ctx.assets ? { assets: ctx.assets } : {}), ...(ctx.starter ? { starter: ctx.starter } : {}) });
  return kind ? { to: "team", kind } : { to: "sparky" };
}

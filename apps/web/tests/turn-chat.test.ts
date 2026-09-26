/**
 * A desk turn in the conversation: which lines each event adds, where the
 * person's words, typed or spoken, go, and what Stop says.
 */

import type { DeskManifest } from "@perkos/desk-contract";
import { describe, expect, it } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { freshMemo, routeFor, stopNote, turnChatSteps, type TurnChatStep } from "../app/turn/turnChat";
import { idleTurn, pendingTurn, reduceTurn, type TurnView } from "../app/turn/turnState";
import { spoken } from "../app/voice/sentences";

const T0 = Date.parse("2026-09-26T14:32:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ID = "20260926-143200-ab12";

const open: TurnEvent = {
  step: "open",
  turnId: ID,
  kind: "analyze",
  desk: "eqlty-desk",
  question: "How is NVDA doing today?",
  principal: "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG.",
  facts: ["[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable."],
  roles: ["scout", "risk", "trader", "auditor"],
  at: at(0),
};

/** Plays events through the reducer and the chat rules, as the window does. */
function play(events: TurnEvent[], view: TurnView = idleTurn) {
  const memo = freshMemo();
  const steps: TurnChatStep[] = [];
  let v = view;
  for (const e of events) {
    v = reduceTurn(v, e, T0);
    steps.push(...turnChatSteps(e, v, memo));
  }
  return { steps, view: v };
}

describe("a turn in the conversation", () => {
  it("opens with Sparky's line, gives each answer its own line, names who did not answer, then asks for the summary", () => {
    const { steps } = play([
      open,
      { step: "working", at: at(0), text: "Reading the market" },
      { step: "phase", phase: 1, roles: ["scout", "risk"], at: at(1) },
      { step: "start", role: "scout", phase: 1, at: at(1), agentName: "eqlty-scout-1a2b" },
      { step: "reply", role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA holds [F1].", ms: 18_200, agentName: "eqlty-scout-1a2b" },
      { step: "reply", role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
      { step: "failure", role: "auditor", phase: 2, failure: "model", label: "model failed", detail: "API call failed after 3 retries: HTTP 502: upstream_failed" },
      { step: "done", turnId: ID, replies: [], flags: ["auditor:no-answer"], ms: 71_400, kept: "vault" },
    ]);
    expect(steps).toEqual([
      { do: "principal", turnId: ID, content: open.principal, facts: open.facts },
      { do: "agent", turnId: ID, role: "scout", content: "@Trader @Auditor NVDA holds [F1].", agentName: "eqlty-scout-1a2b" },
      { do: "missed", turnId: ID, role: "auditor", label: "model failed", detail: "API call failed after 3 retries: HTTP 502: upstream_failed" },
      { do: "summary", turnId: ID },
    ]);
  });

  it("lets Sparky speak once while the team wakes, not on every poll", () => {
    const wake = (waiting: string[], woke: boolean): TurnEvent => ({ step: "wake", status: "waking", ready: [], waiting, waitedMs: 0, woke });
    const { steps } = play([open, wake(["scout", "risk"], false), wake(["scout", "risk"], true), wake(["risk"], true), wake([], true)]);
    expect(steps.filter((s) => s.do === "warm")).toHaveLength(1);
  });

  it("does not speak first when the team is already up", () => {
    const { steps } = play([open, { step: "wake", status: "ready", ready: ["scout"], waiting: [], waitedMs: 0, woke: false }]);
    expect(steps.some((s) => s.do === "warm")).toBe(false);
  });

  it("says once why the whole team could not take part, and Sparky still sums up", () => {
    const events: TurnEvent[] = [open, { step: "error", code: "NO_DESK_TIME", message: "Add desk time to run the team." }];
    for (const role of ["scout", "risk", "trader", "auditor"]) {
      events.push({ step: "reply", role, phase: 1, ok: false, reply: "", failure: "no_time", detail: "Add desk time to run the team.", ms: 0 });
      events.push({ step: "failure", role, phase: 1, failure: "no_time", label: "no desk time", detail: "Add desk time to run the team." });
    }
    events.push({ step: "done", turnId: ID, replies: [], flags: [], ms: 900, kept: "session", error: "NO_DESK_TIME" });
    const { steps } = play(events);
    expect(steps.map((s) => s.do)).toEqual(["principal", "note", "summary"]);
    expect(steps[1]).toEqual({ do: "note", turnId: ID, content: "Add desk time to run the team." });
  });

  it("lets Sparky answer on his own when the turn never opened", () => {
    const { steps } = play([{ step: "error", code: "DESK_MARKET", message: "The desk's market did not answer." }], pendingTurn("How is NVDA doing today?", "analyze", T0));
    expect(steps).toEqual([{ do: "note", content: "The desk's market did not answer." }, { do: "alone" }]);
  });

  it("gives a turn the person stopped no summary", () => {
    const { steps } = play([open, { step: "done", turnId: ID, replies: [], flags: [], ms: 5_000, kept: "vault", stopped: true }]);
    expect(steps.map((s) => s.do)).toEqual(["principal"]);
  });
});

describe("what Stop says", () => {
  it("is honest that agents already asked may still finish on PerkOS", () => {
    const asked = play([open, { step: "start", role: "scout", phase: 1, at: at(1) }]).view;
    expect(stopNote(asked)).toBe("Stopped waiting for the team. Agents already asked may still finish on PerkOS; those answers are not kept.");
    expect(stopNote(pendingTurn("x", "analyze", T0))).toBe("Stopped before the team was asked.");
    expect(stopNote(play([open]).view)).toBe("Stopped before the team was asked.");
  });
});

describe("where the person's words go", () => {
  const prompts = { scout: "s", risk: "r", trader: "t", auditor: "a" };
  const manifest: Pick<DeskManifest, "turns" | "starters"> = {
    starters: [
      { text: "What should I buy this month?", tag: "Picks", turn: "advise" },
      { text: "What can I trade on this desk?", tag: "The market" },
    ],
    turns: { analyze: prompts, advise: prompts },
  };
  const assets = [
    { ticker: "NVDA", name: "NVIDIA", address: "0x1", decimals: 18, priceUsd: 181.2, priceAt: at(0), change24hPct: 1.2, volume24hUsd: 1, tradeable: true, logoUrl: null },
  ];

  it("sends a desk task to the team and plain chat to Sparky", () => {
    expect(routeFor("How is NVDA doing today?", { manifest, assets, live: false })).toEqual({ to: "team", kind: "analyze" });
    expect(routeFor("how is nvidia doing today?", { manifest, assets, live: false })).toEqual({ to: "team", kind: "analyze" });
    expect(routeFor("¿Qué acción me conviene comprar este mes?", { manifest, assets, live: false })).toEqual({ to: "team", kind: "advise" });
    expect(routeFor("What can I trade on this desk?", { manifest, assets, live: false, starter: manifest.starters[1]! })).toEqual({ to: "sparky" });
    expect(routeFor("hi", { manifest, assets, live: false })).toEqual({ to: "sparky" });
    expect(routeFor("How is NVDA doing today?", { manifest: null, live: false })).toEqual({ to: "sparky" });
  });

  it("follows the starter the person tapped", () => {
    expect(routeFor("What should I buy this month?", { manifest, live: false, starter: manifest.starters[0]! })).toEqual({ to: "team", kind: "advise" });
  });

  it("sends everything to Sparky, to the person, while the team works", () => {
    expect(routeFor("Analyze NVDA", { manifest, assets, live: true })).toEqual({ to: "sparky", tone: "to-you" });
    expect(routeFor("hi", { manifest, assets, live: true })).toEqual({ to: "sparky", tone: "to-you" });
  });
});

describe("Sparky's voice", () => {
  it("speaks Sparky's words without fact tags or @", () => {
    expect(spoken("NVDA trades at 181.20 USDG [F1], and @Trader plans 50 USDG [F2].")).toBe("NVDA trades at 181.20 USDG, and Trader plans 50 USDG.");
  });
});

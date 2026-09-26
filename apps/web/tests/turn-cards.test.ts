/**
 * The team row during a desk turn: a card under each seat at the table while
 * the turn runs, the portraits following it, and chips once it folds. The
 * specialists keep their own look.
 */

import type { DeskTeam } from "@perkos/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { TeamRow } from "../app/team/TeamRow";
import { idleTurn, reduceTurn } from "../app/turn/turnState";

const team: DeskTeam = {
  templateId: "eqlty-desk",
  status: "ready",
  agents: ["scout", "risk", "trader", "auditor", "hooks", "quote", "treasury"].map((role) => ({ role, name: `eqlty-${role}-1`, state: "ready" as const })),
};

const ID = "20260926-143200-ab12";
const T0 = Date.now() - 30_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const live: TurnEvent[] = [
  {
    step: "open",
    turnId: ID,
    kind: "advise",
    desk: "eqlty-desk",
    question: "What should I buy this month?",
    principal: "@Scout @Risk What should I buy this month?",
    facts: ["[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable."],
    roles: ["scout", "risk", "trader", "auditor"],
    at: at(0),
  },
  { step: "start", role: "scout", phase: 1, at: at(1) },
  { step: "start", role: "risk", phase: 1, at: at(1) },
  { step: "reply", role: "risk", phase: 1, ok: false, reply: "", failure: "timeout", detail: "timed out after 55000ms", ms: 2_500 },
];
const view = (events: TurnEvent[]) => events.reduce((v, e) => reduceTurn(v, e, T0), idleTurn);
const html = (turn: Parameters<typeof TeamRow>[0]["turn"]) => renderToStaticMarkup(createElement(TeamRow, { team, turn })).replace(/<!-- -->/g, "");
const noop = () => undefined;

describe("the team row during a turn", () => {
  it("puts a card under each seat at the table, and none under a specialist", () => {
    const out = html({ view: view(live), lines: new Set(["risk"]), onFocus: noop });
    expect(out).toContain('class="st-team turn open"');
    for (const title of ["01 · SCOUT", "02 · RISK", "03 · TRADER", "04 · AUDITOR"]) expect(out).toContain(title);
    expect(out.match(/class="st-card /g)).toHaveLength(4);
    expect(out).toContain('<span class="st-card-value long">no answer</span><span class="st-card-label">timed out</span>');
    expect(out).toContain("2.5 s");
    expect(out).toContain("waiting for Scout + Risk");
    // Scout works and Risk has a line: both can be focused; Trader and Auditor have nothing to show yet.
    expect(out.match(/<button type="button" class="st-card-focus"(?! disabled)/g)).toHaveLength(2);
    expect(out.match(/class="st-card-focus" disabled=""/g)).toHaveLength(2);
  });

  it("lights the portraits for the turn and says who is thinking", () => {
    const out = html({ view: view(live), lines: new Set(), onFocus: noop });
    expect(out).toMatch(/class="st-member seat-1 thinking"[^>]*>.*?data-state="thinking"/);
    expect(out).toMatch(/class="st-member seat-2 warning"/);
    expect(out).toMatch(/class="st-member seat-3 idle"/);
    expect(out).toContain("<small>Thinking</small>");
    expect(out).toMatch(/class="st-member st-spec idle"/);
  });

  it("lights a specialist the turn asks, with no card, and leaves the others alone", () => {
    const withQuote = view([
      { ...(live[0] as Extract<TurnEvent, { step: "open" }>), roles: ["scout", "risk", "quote", "trader", "auditor"] },
      ...live.slice(1),
      { step: "start", role: "quote", phase: 1, at: at(1) },
    ]);
    const out = html({ view: withQuote, lines: new Set(), onFocus: noop });
    expect(out).toMatch(/class="st-member st-spec thinking"[^>]*title="Quote/);
    expect(out).toMatch(/class="st-member st-spec idle"[^>]*title="Hooks/);
    expect(out.match(/class="st-card /g)).toHaveLength(4);
    expect(out.match(/<small>Thinking<\/small>/g)).toHaveLength(2);
  });

  it("folds into chips once the turn is over, and the portraits go back to the team's look", () => {
    const over = view([...live, { step: "done", turnId: ID, replies: [], flags: ["risk:no-answer"], ms: 3_000, kept: "vault", stopped: true }]);
    const out = html({ view: over, lines: new Set(["risk"]), onFocus: noop });
    expect(out).toContain('class="st-team turn"');
    expect(out).toMatch(/class="st-member seat-2 idle"/);
    expect(out).toContain('<button type="button" class="st-card-chip" aria-label="Risk: no answer / TIMED OUT. Show Risk&#x27;s last line.">');
    expect(out).toContain("<span>did not run</span>");
  });

  it("shows no card before the turn opens or once the conversation no longer holds it", () => {
    expect(html({ view: { ...idleTurn, live: true }, lines: new Set(), onFocus: noop })).toContain('class="st-team"');
    expect(html(null)).not.toContain("st-card");
  });
});

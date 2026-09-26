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

  const finished = view([
    ...live,
    { step: "start", role: "trader", phase: 2, at: at(5) },
    { step: "reply", role: "trader", phase: 2, ok: true, reply: "@Sparky Entry plan for NVDA [F1]: 50 USDG, take profit at 190, stop at 172.", ms: 9_000 },
    { step: "start", role: "auditor", phase: 2, at: at(5) },
    { step: "reply", role: "auditor", phase: 2, ok: true, reply: "@Sparky Outlook recorded [F1].", ms: 9_500 },
    { step: "done", turnId: ID, replies: [], flags: [], ms: 15_000, kept: "vault" },
  ]);
  const seat = (out: string, n: number) => out.slice(out.indexOf(`st-member seat-${n}`), out.indexOf(`st-member seat-${n + 1}`) > 0 ? out.indexOf(`st-member seat-${n + 1}`) : undefined);

  it("offers Buy in Trader on the Trader's card and its chip once the turn is over, and on no other seat", () => {
    const out = html({ view: finished, lines: new Set(["trader"]), onFocus: noop, onBuy: noop, buyTitle: "NVDA for 50 USDG" });
    expect(out.match(/class="st-card-buy( chip)?"/g)).toEqual(['class="st-card-buy"', 'class="st-card-buy chip"']);
    expect(seat(out, 3).match(/Buy in Trader/g)).toHaveLength(2);
    expect(out).toContain('title="Opens the Trader with NVDA for 50 USDG filled in. Nothing is bought until you get a quote and hold to approve."');
    expect(html({ view: finished, lines: new Set(), onFocus: noop })).not.toContain("st-card-buy");
  });

  it("shows the receipt on the Auditor's card and its chip once the person signed, in place of the slot", () => {
    const unsigned = html({ view: finished, lines: new Set(), onFocus: noop });
    expect(seat(unsigned, 4)).toContain("Receipt after your signature");
    const receipt = { hash: "0xfeed", status: "success" as const, ticker: "NVDA", amount: "50", at: at(60) };
    const out = html({ view: finished, lines: new Set(), onFocus: noop, receipt });
    expect(out).not.toContain("Receipt after your signature");
    const auditor = seat(out, 4);
    expect(auditor).toContain('<a class="st-card-slot st-receipt success" href="https://robinhoodchain.blockscout.com/tx/0xfeed" target="_blank" rel="noreferrer"');
    expect(auditor).toContain('<a class="st-card-receipt st-receipt success"');
    expect(auditor.match(/<span>Signed · NVDA 50<\/span>/g)).toHaveLength(2);
    expect(seat(out, 3)).not.toContain("st-receipt");
    const pending = html({ view: finished, lines: new Set(), onFocus: noop, receipt: { ...receipt, status: "pending", explorerUrl: "https://example.org/tx/0xfeed" } });
    expect(pending).toContain('<a class="st-card-slot st-receipt pending" href="https://example.org/tx/0xfeed"');
    expect(pending).toContain("<span>Signed · NVDA 50 · pending</span>");
  });

  it("shows no card before the turn opens or once the conversation no longer holds it", () => {
    expect(html({ view: { ...idleTurn, live: true }, lines: new Set(), onFocus: noop })).toContain('class="st-team"');
    expect(html(null)).not.toContain("st-card");
  });
});

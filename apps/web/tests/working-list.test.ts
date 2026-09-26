/**
 * "Sparky · working" as the chat draws it: the checklist while the team
 * works, and the one line it folds into on Sparky's summary.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { ChatLine } from "../app/turn/ChatLine";
import { idleTurn, reduceTurn, workOf } from "../app/turn/turnState";
import { WorkFold, WorkingList } from "../app/turn/WorkingList";

const T0 = Date.now() - 50_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const events: TurnEvent[] = [
  { step: "open", turnId: "20260926-143200-ab12", kind: "analyze", desk: "eqlty-desk", question: "How is NVDA doing today?", principal: "@Scout @Risk How is NVDA doing today?", facts: [], roles: ["scout", "risk"], at: at(0) },
  ...["Reading the market", "Read 1 fact from the market", "Checking the team", "Waking the team", "Waiting for Scout and Risk to wake", "Scout is reading the facts"].map(
    (text, i): TurnEvent => ({ step: "working", at: at(i), text }),
  ),
];
const view = events.reduce((v, e) => reduceTurn(v, e, T0), idleTurn);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

describe("the working checklist", () => {
  it("shows the last four finished steps with a check, how many came before, and the step in progress with its seconds", () => {
    const out = html(createElement(WorkingList, { view }));
    expect(out).toContain("Sparky · working");
    expect(out).toContain("1 earlier step");
    expect(out.match(/<li class="done">/g)).toHaveLength(4);
    expect(out).not.toContain("✓</b>Reading the market");
    expect(out).toMatch(/Scout is reading the facts<em> · 4\d s<\/em>/);
    expect(out).toMatch(/5\d s · 6 steps/);
  });

  it("folds into one line on Sparky's summary, with every step inside", () => {
    const done = reduceTurn(view, { step: "done", turnId: "20260926-143200-ab12", replies: [], flags: [], ms: 71_400, kept: "vault" }, T0);
    const work = workOf(done);
    expect(work.line).toBe("Worked 71 s · 6 steps");
    const fold = html(createElement(WorkFold, { work }));
    expect(fold).toContain("<summary>Worked 71 s · 6 steps</summary>");
    expect(fold.match(/<li>/g)).toHaveLength(6);
    const summary = html(
      createElement(ChatLine, { message: { id: "s", role: "assistant", content: "", tone: "summary", work } }, createElement(WorkFold, { work })),
    );
    expect(summary).not.toContain("<p>");
    expect(summary).toContain("Worked 71 s · 6 steps");
  });
});

describe("the team's lines", () => {
  it("draws an agent in its role's color with its mentions as chips, and a missing answer as one muted line", () => {
    const scout = html(createElement(ChatLine, { message: { id: "a", role: "team", kind: "agent", who: "scout", content: "@Trader NVDA holds [F1].", turnId: "t" }, facts: ["[F1] NVDA (NVIDIA): 181.20 USDG"] }));
    expect(scout).toContain('data-who="scout"');
    expect(scout).toContain("--role:#3d8bff");
    expect(scout).toContain("Scout · PerkOS");
    expect(scout).toContain('<span class="st-at" style="--role:#35e08a">@Trader</span>');
    expect(scout).toContain('<abbr class="st-fact" title="NVDA (NVIDIA): 181.20 USDG">F1</abbr>');
    const auditor = html(
      createElement(ChatLine, { message: { id: "b", role: "team", kind: "agent", who: "auditor", content: "", turnId: "t", failure: { label: "model failed", detail: "API call failed after 3 retries" } } }),
    );
    expect(auditor).toContain("Auditor did not answer: model failed");
    expect(auditor).toContain("<small>API call failed after 3 retries</small>");
    const principal = html(createElement(ChatLine, { message: { id: "c", role: "team", kind: "principal", who: "sparky", content: "@Scout @Risk How is NVDA doing today?", turnId: "t" } }));
    expect(principal).toContain("Sparky · principal");
    expect(principal).toContain('<span class="st-at" style="--role:#ffb020">@Risk</span>');
    const side = html(createElement(ChatLine, { message: { id: "d", role: "assistant", content: "It is 14:32.", tone: "to-you" } }));
    expect(side).toContain("Sparky · to you");
  });
});

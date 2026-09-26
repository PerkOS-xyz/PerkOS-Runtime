/**
 * The live picture of a turn, built from the route's events.
 */

import { describe, expect, it } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { idleTurn, reduceTurn, workingView, type TurnView } from "../app/turn/turnState";

const T0 = Date.parse("2026-09-26T14:32:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const events: TurnEvent[] = [
  { step: "open", turnId: "20260926-143200-ab12", kind: "analyze", desk: "eqlty-desk", question: "How is NVDA doing today?", principal: "@Scout @Risk How is NVDA doing today?", facts: ["[F1] NVDA"], roles: ["scout", "risk", "trader", "auditor"], at: at(0) },
  { step: "working", at: at(0), text: "Reading the market" },
  { step: "wake", status: "waking", ready: ["scout"], waiting: ["risk", "trader", "auditor"], waitedMs: 0, woke: true },
  { step: "working", at: at(1), text: "Waking the team" },
  { step: "wake", status: "ready", ready: ["scout", "risk", "trader", "auditor"], waiting: [], waitedMs: 40_000, woke: true },
  { step: "phase", phase: 1, roles: ["scout", "risk"], at: at(41) },
  { step: "start", role: "scout", phase: 1, at: at(41), agentName: "eqlty-scout-1" },
  { step: "start", role: "risk", phase: 1, at: at(41) },
  { step: "working", at: at(41), text: "Scout is reading the facts" },
  { step: "reply", role: "scout", phase: 1, ok: true, reply: "@Trader NVDA holds [F1].", ms: 18_200, startedAt: at(41) },
  { step: "reply", role: "risk", phase: 1, ok: true, reply: "RISK: medium", ms: 12_900, riskLevel: "medium" },
  { step: "phase", phase: 2, roles: ["trader", "auditor"], at: at(60) },
  { step: "start", role: "trader", phase: 2, at: at(60) },
  { step: "reply", role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries", ms: 20_000 },
  { step: "failure", role: "auditor", phase: 2, failure: "model", label: "model failed", detail: "API call failed after 3 retries" },
];

const run = (list: TurnEvent[], view: TurnView = idleTurn) => list.reduce((v, e) => reduceTurn(v, e, T0), view);

describe("a turn's live picture", () => {
  it("follows each role from waiting to its answer", () => {
    const v = run(events);
    expect(v.live).toBe(true);
    expect(v.order).toEqual(["scout", "risk", "trader", "auditor"]);
    expect(v.roles.scout).toMatchObject({ status: "delivered", ms: 18_200, agentName: "eqlty-scout-1", phase: 1 });
    expect(v.roles.risk).toMatchObject({ status: "delivered", riskLevel: "medium" });
    expect(v.roles.trader).toMatchObject({ status: "thinking", phase: 2 });
    expect(v.roles.auditor).toMatchObject({ status: "failed", failure: "model", label: "model failed", detail: "API call failed after 3 retries" });
    expect(v.riskLevel).toBe("medium");
  });

  it("knows while the team is waking, so Sparky can keep the person company", () => {
    const waking = run(events.slice(0, 3));
    expect(waking.waking).toBe(true);
    expect(waking.waiting).toEqual(["risk", "trader", "auditor"]);
    expect(run(events.slice(0, 5)).waking).toBe(false);
  });

  it("turns roles still waiting or thinking into skipped when the turn ends", () => {
    const v = run([...events, { step: "done", turnId: "20260926-143200-ab12", replies: [], flags: ["auditor:no-answer"], ms: 71_400, kept: "vault", stopped: true }]);
    expect(v.live).toBe(false);
    expect(v.roles.trader?.status).toBe("skipped");
    expect(v.roles.auditor?.status).toBe("failed");
    expect(v).toMatchObject({ flags: ["auditor:no-answer"], kept: "vault", stopped: true, endedAt: T0 + 71_400 });
  });

  it("keeps an error, and one before the turn opened leaves nothing live", () => {
    const early = reduceTurn(idleTurn, { step: "error", code: "DESK_MARKET", message: "The desk's market did not answer." }, T0);
    expect(early).toMatchObject({ live: false, error: { code: "DESK_MARKET" } });
    const late = run([...events.slice(0, 3), { step: "error", code: "NO_DESK_TIME", message: "Add desk time to run the team." }]);
    expect(late).toMatchObject({ live: true, waking: false, error: { code: "NO_DESK_TIME" } });
  });
});

describe("the working checklist", () => {
  it("shows the last finished steps, the current one with seconds after three, and the total", () => {
    const v = run(events);
    const early = workingView(v, T0 + 42_000);
    expect(early.done).toEqual(["Reading the market", "Waking the team"]);
    expect(early.current).toEqual({ text: "Scout is reading the facts", seconds: null });
    expect(early.line).toBe("42 s · 3 steps");
    expect(workingView(v, T0 + 50_000).current).toEqual({ text: "Scout is reading the facts", seconds: 9 });
  });

  it("keeps only four finished steps in view", () => {
    const many = run([
      events[0]!,
      ...Array.from({ length: 7 }, (_, i): TurnEvent => ({ step: "working", at: at(i), text: `step ${i + 1}` })),
    ]);
    expect(workingView(many, T0 + 7_000).done).toEqual(["step 3", "step 4", "step 5", "step 6"]);
  });

  it("folds into one line once the turn is over", () => {
    const v = run([...events, { step: "done", turnId: "x", replies: [], flags: [], ms: 71_400, kept: "session" }]);
    const w = workingView(v, T0 + 999_000);
    expect(w.current).toBeNull();
    expect(w.line).toBe("Worked 71 s · 3 steps");
    expect(w.done).toEqual(["Reading the market", "Waking the team", "Scout is reading the facts"]);
  });
});

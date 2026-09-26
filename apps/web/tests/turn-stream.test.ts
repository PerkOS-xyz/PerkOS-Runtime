/**
 * The window's side of a turn: reading the route's frames as they arrive,
 * and the turn's picture before it opens, once the person stops waiting, and
 * when the stream closes early.
 */

import { describe, expect, it } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { cutTurn, FIRST_STEP, idleTurn, pendingTurn, reduceTurn, stopLocally, workOf, type TurnView } from "../app/turn/turnState";
import { parseFrame, TurnFrames } from "../app/turn/turnStream";

const T0 = Date.parse("2026-09-26T14:32:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const frame = (e: TurnEvent) => `data: ${JSON.stringify(e)}\n\n`;

const open: TurnEvent = {
  step: "open",
  turnId: "20260926-143200-ab12",
  kind: "analyze",
  desk: "eqlty-desk",
  question: "How is NVDA doing today?",
  principal: "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG.",
  facts: ["[F1] NVDA (NVIDIA): 181.20 USDG"],
  roles: ["scout", "risk", "trader", "auditor"],
  at: at(0),
};
const working: TurnEvent = { step: "working", at: at(0), text: "Reading the market" };
const start: TurnEvent = { step: "start", role: "scout", phase: 1, at: at(2) };

describe("reading the turn's frames", () => {
  it("reads several frames that arrive together", () => {
    const frames = new TurnFrames();
    expect(frames.push(frame(open) + frame(working))).toEqual([open, working]);
  });

  it("waits for the rest of a frame split over two reads", () => {
    const frames = new TurnFrames();
    const text = frame(open);
    expect(frames.push(text.slice(0, 40))).toEqual([]);
    expect(frames.push(text.slice(40, -1))).toEqual([]);
    expect(frames.push(text.slice(-1) + frame(start).slice(0, 10))).toEqual([open]);
    expect(frames.push(frame(start).slice(10))).toEqual([start]);
  });

  it("reads a blank line sent as CRLF, even split between reads", () => {
    const frames = new TurnFrames();
    const text = `data: ${JSON.stringify(working)}\r\n\r`;
    expect(frames.push(text)).toEqual([]);
    expect(frames.push("\n")).toEqual([working]);
  });

  it("skips comments, empty frames, bad JSON and anything that is not a turn event", () => {
    const frames = new TurnFrames();
    const junk = [": keep-alive\n\n", "\n\n", "data: {not json\n\n", 'data: {"step":"launch"}\n\n', "data: 42\n\n"].join("");
    expect(frames.push(junk + frame(working))).toEqual([working]);
    expect(parseFrame("event: turn")).toBeNull();
  });

  it("keeps the last frame when the stream ends without a blank line", () => {
    const frames = new TurnFrames();
    expect(frames.push(`data: ${JSON.stringify(working)}`)).toEqual([]);
    expect(frames.flush()).toEqual([working]);
    expect(frames.flush()).toEqual([]);
  });
});

describe("a turn before it opens", () => {
  it("is live with the first step on screen, and the route's open replaces it", () => {
    const pending = pendingTurn("How is NVDA doing today?", "analyze", T0);
    expect(pending).toMatchObject({ live: true, turnId: null, kind: "analyze", question: "How is NVDA doing today?", startedAt: T0 });
    expect(pending.steps).toEqual([{ at: T0, text: FIRST_STEP }]);
    const opened = reduceTurn(reduceTurn(pending, open, T0), working, T0);
    expect(opened.turnId).toBe(open.turnId);
    expect(opened.steps.map((s) => s.text)).toEqual(["Reading the market"]);
  });

  it("is over when the route ends it before it opens", () => {
    const ended = reduceTurn(pendingTurn("How is NVDA doing today?", "analyze", T0), { step: "error", code: "DESK_MARKET", message: "The desk's market did not answer." }, T0);
    expect(ended).toMatchObject({ live: false, error: { code: "DESK_MARKET" } });
  });
});

const midTurn = (): TurnView =>
  [open, working, { step: "phase", phase: 1, roles: ["scout", "risk"], at: at(2) } as TurnEvent, start, { step: "reply", role: "risk", phase: 1, ok: true, reply: "RISK: low", ms: 9_000 } as TurnEvent].reduce(
    (v, e) => reduceTurn(v, e, T0),
    idleTurn,
  );

describe("stopping the wait", () => {
  it("marks a thinking role stopped and a role not asked yet skipped, and keeps what arrived", () => {
    const stopped = stopLocally(midTurn(), T0 + 12_000);
    expect(stopped).toMatchObject({ live: false, stopped: true, endedAt: T0 + 12_000 });
    expect(stopped.roles.scout).toMatchObject({ status: "failed", failure: "stopped", label: "stopped waiting", ms: 10_000 });
    expect(stopped.roles.risk).toMatchObject({ status: "delivered", reply: "RISK: low" });
    expect(stopped.roles.trader?.status).toBe("skipped");
  });

  it("leaves a turn that is already over as it is", () => {
    const done = reduceTurn(midTurn(), { step: "done", turnId: open.turnId, replies: [], flags: [], ms: 20_000, kept: "vault" }, T0);
    expect(stopLocally(done, T0 + 30_000)).toBe(done);
  });

  it("before the turn opened, ends it with nothing asked", () => {
    const stopped = stopLocally(pendingTurn("x", "advise", T0), T0 + 1_000);
    expect(stopped).toMatchObject({ live: false, stopped: true, roles: {} });
  });
});

describe("a stream that closes early", () => {
  it("ends the turn with the reason and no role left thinking", () => {
    const cut = cutTurn(midTurn(), "The stream closed.", T0 + 15_000);
    expect(cut).toMatchObject({ live: false, stopped: false, error: { code: "INTERNAL", message: "The stream closed." } });
    expect(cut.roles.scout?.status).toBe("skipped");
    expect(cut.roles.risk?.status).toBe("delivered");
  });
});

describe("the checklist folded onto Sparky's message", () => {
  it("says how long the team worked and keeps every step", () => {
    const done = reduceTurn(
      reduceTurn(midTurn(), { step: "working", at: at(40), text: "Checking the answers" }, T0),
      { step: "done", turnId: open.turnId, replies: [], flags: [], ms: 71_400, kept: "vault" },
      T0,
    );
    expect(workOf(done, T0 + 500_000)).toEqual({ line: "Worked 71 s · 2 steps", steps: ["Reading the market", "Checking the answers"] });
  });
});

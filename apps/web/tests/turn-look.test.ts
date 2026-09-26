/**
 * Each agent's part of a turn as its card reads it: the three steps, the
 * time, the result, the portrait's state, and when the cards fold.
 */

import { describe, expect, it } from "vitest";

import type { Message } from "../app/chat/messages";
import type { TurnEvent } from "../app/lib/turnRecord";
import {
  BEAMS_AFTER_MS,
  cardLook,
  cardsMode,
  chatOfTurn,
  factTickers,
  firstTicker,
  FOLD_AFTER_MS,
  handoffOf,
  metricFor,
  metricText,
  seatState,
  stepStates,
} from "../app/turn/turnLook";
import { idleTurn, reduceTurn, stopLocally, type RoleView, type TurnView } from "../app/turn/turnState";

const T0 = Date.parse("2026-09-26T14:32:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ID = "20260926-143200-ab12";
const FACTS = [
  "[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable. 7-day range 172.10 to 184.00 USDG (pool).",
  "[F2] AAPL (Apple): 228.40 USDG at 14:30, -0.40% in 24h, tradeable.",
  "[F3] BRK.B (Berkshire Hathaway): 471.00 USDG at 14:30, +0.10% in 24h, tradeable.",
  "[F4] F (Ford): 11.20 USDG at 14:30, +0.90% in 24h, tradeable.",
];

const open = (kind: "analyze" | "advise" = "advise"): TurnEvent => ({
  step: "open",
  turnId: ID,
  kind,
  desk: "eqlty-desk",
  question: kind === "advise" ? "What should I buy this month?" : "How is NVDA doing today?",
  principal: "@Scout @Risk ...",
  facts: FACTS,
  roles: ["scout", "risk", "trader", "auditor"],
  at: at(0),
});

const replies = {
  scout: "@Trader @Auditor Top two: NVDA [F1] holds the top of its range; AAPL [F2] is the slower pick. Avoid BRK.B [F3] for now.",
  risk: "RISK: medium\n@Trader @Auditor NVDA can take 50 USDG, AAPL 30 USDG. Block if NVDA loses 172 [F1].",
  trader: "@Sparky Entry plan for AAPL [F2]: 40 USDG, take profit at 240, stop at 220. Add NVDA on a dip.",
  auditor: "@Sparky Outlook recorded: NVDA first [F1], AAPL second [F2], avoid BRK.B [F3]. Review on 2026-10-26.",
};

/** A whole turn: Scout and Risk, then Trader and Auditor, each with its reply. */
function fullTurn(kind: "analyze" | "advise" = "advise"): TurnEvent[] {
  return [
    open(kind),
    { step: "phase", phase: 1, roles: ["scout", "risk"], at: at(1) },
    { step: "start", role: "scout", phase: 1, at: at(1), agentName: "eqlty-scout-1" },
    { step: "start", role: "risk", phase: 1, at: at(1) },
    { step: "reply", role: "scout", phase: 1, ok: true, reply: replies.scout, ms: 18_200 },
    { step: "reply", role: "risk", phase: 1, ok: true, reply: replies.risk, ms: 12_900, riskLevel: "medium" },
    { step: "phase", phase: 2, roles: ["trader", "auditor"], at: at(20) },
    { step: "start", role: "trader", phase: 2, at: at(20) },
    { step: "start", role: "auditor", phase: 2, at: at(20) },
    { step: "reply", role: "trader", phase: 2, ok: true, reply: replies.trader, ms: 15_100 },
    { step: "reply", role: "auditor", phase: 2, ok: true, reply: replies.auditor, ms: 21_700 },
  ];
}

const done = (ms = 42_000, extra: Partial<Extract<TurnEvent, { step: "done" }>> = {}): TurnEvent => ({ step: "done", turnId: ID, replies: [], flags: [], ms, kept: "vault", ...extra });
const run = (events: TurnEvent[], view: TurnView = idleTurn) => events.reduce((v, e) => reduceTurn(v, e, T0), view);
const role = (view: TurnView, name: string) => view.roles[name] as RoleView;
const metric = (view: TurnView, name: string) => {
  const m = metricFor(view, role(view, name));
  return m ? metricText(m) : null;
};

describe("a card's result", () => {
  it("reads each role's answer: the top pick, the risk level, the entry plan and the record", () => {
    const v = run(fullTurn("advise"));
    expect(metric(v, "scout")).toBe("NVDA / TOP PICK");
    expect(metric(v, "risk")).toBe("medium / RISK LEVEL");
    expect(metric(v, "trader")).toBe("AAPL / ENTRY PLAN");
    expect(metric(v, "auditor")).toBe("outlook / RECORD");
  });

  it("gives a read, not a pick, when the person asked about one stock", () => {
    const v = run(fullTurn("analyze"));
    expect(metric(v, "scout")).toBe("read / MARKET READ");
    expect(metric(v, "auditor")).toBe("analysis / RECORD");
    expect(metric(v, "trader")).toBe("AAPL / ENTRY PLAN");
  });

  it("falls back to a plain read or plan when the answer names no level and no stock of the facts", () => {
    const v = run([
      open("advise"),
      { step: "start", role: "risk", phase: 1, at: at(1) },
      { step: "reply", role: "risk", phase: 1, ok: true, reply: "@Trader Sizes stay small today.", ms: 9_000 },
      { step: "start", role: "trader", phase: 2, at: at(10) },
      { step: "reply", role: "trader", phase: 2, ok: true, reply: "@Sparky I would WAIT for the reference to unfreeze. TSLA is not on this list.", ms: 9_000 },
    ]);
    expect(metric(v, "risk")).toBe("read / RISK READ");
    expect(metric(v, "trader")).toBe("plan / ENTRY PLAN");
  });

  it("shows a runtime's failure as no answer, even when it arrived as an answer", () => {
    const failed = run([
      open(),
      { step: "start", role: "auditor", phase: 2, at: at(20) },
      { step: "reply", role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
    ]);
    expect(metric(failed, "auditor")).toBe("no answer / MODEL FAILED");
    const disguised = run([
      open(),
      { step: "start", role: "auditor", phase: 2, at: at(20) },
      { step: "reply", role: "auditor", phase: 2, ok: true, reply: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
    ]);
    expect(metric(disguised, "auditor")).toBe("no answer / MODEL FAILED");
    const look = cardLook(disguised, "auditor", { index: 4, now: T0 + 60_000 });
    expect(look).toMatchObject({ tone: "error", avatar: "error", receiptSlot: false, chip: "model failed" });
    expect(look?.detail).toBe("API call failed after 3 retries: HTTP 502: upstream_failed");
  });

  it("says an agent that was not up was asleep, and gives each other reason its own label", () => {
    const v = run([
      open(),
      { step: "reply", role: "trader", phase: 2, ok: false, reply: "", failure: "offline", detail: "Agent is not ready", ms: 0 },
      { step: "reply", role: "scout", phase: 1, ok: false, reply: "", failure: "timeout", detail: "timed out after 55000ms", ms: 55_000 },
      { step: "reply", role: "risk", phase: 1, ok: false, reply: "", failure: "no_time", ms: 0 },
      { step: "reply", role: "auditor", phase: 2, ok: false, reply: "", failure: "byok", ms: 0 },
    ]);
    expect(metric(v, "trader")).toBe("no answer / ASLEEP");
    expect(metric(v, "scout")).toBe("no answer / TIMED OUT");
    expect(metric(v, "risk")).toBe("no answer / NO DESK TIME");
    expect(metric(v, "auditor")).toBe("no answer / NEEDS ITS OWN MODEL KEY");
    expect(stepStates(role(v, "trader"))).toEqual(["failed", "idle", "idle"]);
  });

  it("turns roles still waiting or thinking at the end into did not run", () => {
    const v = run([open(), { step: "start", role: "scout", phase: 1, at: at(1) }, done()]);
    expect(metric(v, "scout")).toBe("no answer / DID NOT RUN");
    expect(metric(v, "trader")).toBe("no answer / DID NOT RUN");
    expect(stepStates(role(v, "scout"))).toEqual(["done", "idle", "idle"]);
    expect(stepStates(role(v, "trader"))).toEqual(["idle", "idle", "idle"]);
  });

  it("says stopped, not failed, when the person stopped waiting", () => {
    const v = stopLocally(run([open(), { step: "start", role: "scout", phase: 1, at: at(1) }]), T0 + 5_000);
    expect(metric(v, "scout")).toBe("stopped / STOPPED WAITING");
    expect(seatState(role(v, "scout"))).toBe("idle");
    expect(cardLook(v, "scout", { index: 1, now: T0 + 5_000 })?.tone).toBe("dim");
  });

  it("has nothing to show while the role waits or works", () => {
    const v = run([open(), { step: "start", role: "scout", phase: 1, at: at(1) }]);
    expect(metricFor(v, role(v, "scout"))).toBeNull();
    expect(metricFor(v, role(v, "trader"))).toBeNull();
  });

  it("follows Risk's verdict on an order turn", () => {
    const v = run([
      { ...open(), kind: "order" } as TurnEvent,
      { step: "start", role: "risk", phase: 1, at: at(1) },
      { step: "reply", role: "risk", phase: 1, ok: true, reply: "RISK: high\nVERDICT: BLOCK", ms: 8_000, riskLevel: "high", verdict: "BLOCK" },
      { step: "start", role: "trader", phase: 2, at: at(10) },
      { step: "reply", role: "trader", phase: 2, ok: true, reply: replies.trader, ms: 8_000 },
    ]);
    expect(metric(v, "risk")).toBe("BLOCK / VERDICT");
    expect(metric(v, "trader")).toBe("stand down / RISK BLOCKED");
  });
});

describe("the desk's tickers", () => {
  it("come from the facts, and the first one a line names wins", () => {
    const tickers = factTickers(FACTS);
    expect(tickers).toEqual(["NVDA", "AAPL", "BRK.B", "F"]);
    expect(firstTicker("Avoid BRK.B [F3]; NVDA [F1] leads.", tickers)).toBe("BRK.B");
    expect(firstTicker("$AAPL first, then NVDA.", tickers)).toBe("AAPL");
  });

  it("never take a word in capitals, a fact tag or a lone letter for a stock", () => {
    const tickers = factTickers(FACTS);
    expect(firstTicker("RISK: medium. WAIT for TSLA [F1].", tickers)).toBeNull();
    expect(firstTicker("F is cheap [F4]", tickers)).toBeNull();
    expect(firstTicker("Take $F at 11 [F4]", tickers)).toBe("F");
    expect(firstTicker("NVDAX is not NVDA's cousin", tickers)).toBe("NVDA");
  });

  it("leave Uniswap's quote line out, so the venue is never read as a stock", () => {
    const quoted = [...FACTS, "[F5] Uniswap now: 50.00 USDG buys 0.2741 NVDA (182.42 USDG each), price impact 0.12%, UniswapX route."];
    expect(factTickers(quoted)).toEqual(["NVDA", "AAPL", "BRK.B", "F"]);
    expect(firstTicker("Entry through Uniswap [F5]: 50 USDG of NVDA [F1].", factTickers(quoted))).toBe("NVDA");
    const v = run([
      { ...(open("analyze") as Extract<TurnEvent, { step: "open" }>), facts: quoted },
      { step: "start", role: "trader", phase: 2, at: at(10) },
      { step: "reply", role: "trader", phase: 2, ok: true, reply: "@Sparky Entry through Uniswap [F5]: 50 USDG, take profit at 190, stop at 172.", ms: 9_000 },
    ]);
    expect(metric(v, "trader")).toBe("plan / ENTRY PLAN");
  });
});

describe("a card's steps, time and portrait", () => {
  it("moves through the three steps as the role starts and answers", () => {
    const early = run([open()]);
    expect(stepStates(role(early, "scout"))).toEqual(["idle", "idle", "idle"]);
    expect(stepStates(role(early, "trader"))).toEqual(["active", "idle", "idle"]);
    const working = run([open(), { step: "start", role: "scout", phase: 1, at: at(1) }]);
    expect(stepStates(role(working, "scout"))).toEqual(["done", "active", "idle"]);
    const v = run(fullTurn());
    expect(stepStates(role(v, "scout"))).toEqual(["done", "done", "done"]);
    expect(stepStates(role(v, "trader"))).toEqual(["done", "done", "done"]);
  });

  it("keeps the Auditor's receipt step for the person's signature", () => {
    const v = run(fullTurn());
    expect(stepStates(role(v, "auditor"))).toEqual(["done", "done", "awaiting"]);
    expect(stepStates(role(v, "auditor"), true)).toEqual(["done", "done", "done"]);
  });

  it("shows the receipt slot only on a delivered Auditor without a receipt", () => {
    const v = run(fullTurn());
    const now = T0 + 60_000;
    expect(cardLook(v, "auditor", { index: 4, now })?.receiptSlot).toBe(true);
    expect(cardLook(v, "auditor", { index: 4, now, receipt: true })?.receiptSlot).toBe(false);
    expect(cardLook(v, "trader", { index: 3, now })?.receiptSlot).toBe(false);
    const working = run([open(), { step: "start", role: "auditor", phase: 2, at: at(20) }]);
    expect(cardLook(working, "auditor", { index: 4, now })?.receiptSlot).toBe(false);
  });

  it("puts the receipt itself on the Auditor's card once the person signed, and on no other card", () => {
    const v = run(fullTurn());
    const receipt = { hash: "0xfeed", status: "success" as const, ticker: "AAPL", amount: "40", at: at(90), explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed" };
    const auditor = cardLook(v, "auditor", { index: 4, now: T0 + 90_000, receipt });
    expect(auditor).toMatchObject({ receiptSlot: false, receipt: { text: "Signed · AAPL 40", status: "success", hash: "0xfeed", explorerUrl: receipt.explorerUrl } });
    expect(auditor?.steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(cardLook(v, "trader", { index: 3, now: T0 + 90_000, receipt })).not.toHaveProperty("receipt");
    expect(cardLook(v, "auditor", { index: 4, now: T0 + 90_000, receipt: null })).toMatchObject({ receiptSlot: true });
    expect(cardLook(v, "auditor", { index: 4, now: T0 + 90_000, receipt: true })).not.toHaveProperty("receipt");
  });

  it("counts whole seconds while the role works, then the time it took with one decimal", () => {
    const working = run([open(), { step: "start", role: "scout", phase: 1, at: at(1) }]);
    expect(cardLook(working, "scout", { index: 1, now: T0 + 13_700 })).toMatchObject({ time: "12 s", chip: "12 s", title: "01 · SCOUT", tone: "active" });
    expect(cardLook(working, "trader", { index: 3, now: T0 + 13_700 })?.time).toBe("waiting");
    const v = run(fullTurn());
    expect(cardLook(v, "scout", { index: 1, now: T0 + 60_000 })).toMatchObject({ time: "18.2 s", chip: "NVDA", summary: "Scout: NVDA / TOP PICK" });
  });

  it("says a role is waking while the team wakes for it", () => {
    const v = run([open(), { step: "wake", status: "waking", ready: ["scout"], waiting: ["risk", "trader", "auditor"], waitedMs: 0, woke: true }]);
    expect(cardLook(v, "risk", { index: 2, now: T0 })?.time).toBe("waking");
    expect(cardLook(v, "scout", { index: 1, now: T0 })?.time).toBe("waiting");
  });

  it("lights the portrait for the turn: thinking, delivered, a failure, or the team's own look", () => {
    const at20 = { role: "x", phase: 1 as const, startedAt: T0, ms: 20_000 };
    expect(seatState({ ...at20, status: "thinking" })).toBe("thinking");
    expect(seatState({ ...at20, status: "delivered", reply: "@Trader NVDA [F1]" })).toBe("success");
    expect(seatState({ ...at20, status: "failed", failure: "model" })).toBe("error");
    expect(seatState({ ...at20, status: "failed", failure: "other" })).toBe("error");
    expect(seatState({ ...at20, status: "failed", failure: "timeout" })).toBe("warning");
    expect(seatState({ ...at20, status: "failed", failure: "offline" })).toBe("warning");
    expect(seatState({ ...at20, status: "failed", failure: "no_time" })).toBe("warning");
    expect(seatState({ ...at20, status: "waiting" })).toBeNull();
    expect(seatState({ ...at20, status: "skipped" })).toBeNull();
  });

  it("has no card for a role that takes no part in the turn", () => {
    expect(cardLook(run([open()]), "hooks", { index: 5, now: T0 })).toBeNull();
  });
});

describe("when the cards fold", () => {
  it("opens once the turn opens, stays open while it runs, and folds into chips two seconds after it ends", () => {
    expect(cardsMode(idleTurn, T0)).toBe("none");
    const live = run(fullTurn());
    expect(cardsMode(live, T0 + 999_000)).toBe("open");
    const over = run([...fullTurn(), done(42_000)]);
    expect(over.endedAt).toBe(T0 + 42_000);
    expect(cardsMode(over, T0 + 42_000 + FOLD_AFTER_MS - 1)).toBe("open");
    expect(cardsMode(over, T0 + 42_000 + FOLD_AFTER_MS)).toBe("chips");
  });

  it("draws the handoff while the second roles work, and lets it fade once the turn is over", () => {
    const first = run(fullTurn().slice(0, 6));
    expect(handoffOf(first, T0 + 10_000)).toBe("none");
    expect(handoffOf(run(fullTurn()), T0 + 30_000)).toBe("flowing");
    const over = run([...fullTurn(), done(42_000)]);
    expect(handoffOf(over, T0 + 42_000 + BEAMS_AFTER_MS - 1)).toBe("fading");
    expect(handoffOf(over, T0 + 42_000 + BEAMS_AFTER_MS)).toBe("none");
    const stoppedEarly = run([...fullTurn().slice(0, 4), done(5_000, { stopped: true })]);
    expect(handoffOf(stoppedEarly, T0 + 5_100)).toBe("none");
  });
});

describe("the turn in the conversation", () => {
  it("knows which roles have a line there, and whether the chat still holds the turn", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "What should I buy this month?" },
      { id: "2", role: "team", kind: "principal", who: "sparky", content: "@Scout @Risk ...", turnId: ID },
      { id: "3", role: "team", kind: "agent", who: "scout", content: replies.scout, turnId: ID },
      { id: "4", role: "team", kind: "agent", who: "auditor", content: "", turnId: ID, failure: { label: "model failed" } },
      { id: "5", role: "team", kind: "agent", who: "risk", content: replies.risk, turnId: "20260926-120000-0000" },
    ];
    const seen = chatOfTurn(messages, ID);
    expect(seen.held).toBe(true);
    expect([...seen.lines].sort()).toEqual(["auditor", "scout"]);
    expect(chatOfTurn(messages.slice(0, 1), ID)).toEqual({ held: false, lines: new Set() });
    expect(chatOfTurn(messages, null).held).toBe(false);
  });
});

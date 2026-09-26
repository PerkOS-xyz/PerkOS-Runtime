/**
 * How History reads a kept turn: when it ran, the cards as they ended, why it
 * went that way, and each agent's own words or the exact reason there are none.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { clockOf, dayOf, factParts, failureText, partsOf, replayView, secondsOf, whyOf, WHY_CHARS } from "../app/desks/history";
import type { RoleReply, TurnRecord } from "../app/lib/turnRecord";
import { TurnCard } from "../app/turn/TurnCards";
import { cardLook, metricFor, metricText } from "../app/turn/turnLook";

const FACTS = [
  "[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable.",
  "[F2] AAPL (Apple): 228.40 USDG at 14:30, -0.40% in 24h, tradeable.",
];
const HERMES = "API call failed after 3 retries: HTTP 502: upstream_failed";

const replies: RoleReply[] = [
  { role: "scout", phase: 1, ok: true, agentName: "eqlty-scout-1a2b3c4d", reply: "@Trader @Auditor NVDA [F1] holds the top of its range; AAPL [F2] is the slower pick.", ms: 18_200, startedAt: "2026-09-26T14:32:01.000Z" },
  { role: "risk", phase: 1, ok: true, reply: "RISK: medium\n@Trader @Auditor NVDA can take 50 USDG. Block if NVDA loses 172 [F1].", ms: 12_900, startedAt: "2026-09-26T14:32:01.000Z" },
  { role: "trader", phase: 2, ok: true, reply: "@Sparky Entry plan for NVDA [F1]: 40 USDG, stop at 172.", ms: 15_100, startedAt: "2026-09-26T14:32:20.000Z" },
  { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: HERMES, ms: 9_400, startedAt: "2026-09-26T14:32:20.000Z" },
];

const record = (extra: Partial<TurnRecord> = {}): TurnRecord => ({
  v: 1,
  id: "20260926-143200-ab12",
  desk: "eqlty-desk",
  module: "stocks-robinhood",
  kind: "advise",
  question: "What should I buy this month?",
  principal: "@Scout @Risk What should I buy this month? Facts attached: NVDA 181.20 USDG, +1.20% in 24h.",
  startedAt: "2026-09-26T14:32:00.000Z",
  endedAt: "2026-09-26T14:33:11.400Z",
  ms: 71_400,
  facts: FACTS,
  memory: "",
  head: "Request to the desk: \"What should I buy this month?\".",
  prompts: { scout: "Pick two.", risk: "Rate the risk.", trader: "Scout said ...\n\nPlan the entry.", auditor: "Scout said ...\n\nRecord the outlook." },
  replies,
  guests: [],
  riskLevel: "medium",
  flags: ["auditor:no-answer"],
  trace: [{ at: "2026-09-26T14:32:00.500Z", text: "Reading the market" }],
  summary: "The desk would start with NVDA, 40 USDG, and stop out under 172.",
  ...extra,
});

describe("when a turn ran", () => {
  const now = new Date(2026, 8, 26, 18, 0);
  it("reads the local time and the day, and seconds with one decimal", () => {
    expect(clockOf(new Date(2026, 8, 26, 9, 5).toISOString())).toBe("09:05");
    expect(dayOf(new Date(2026, 8, 26, 9, 5).toISOString(), now)).toBe("Today");
    expect(dayOf(new Date(2026, 8, 25, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(dayOf(new Date(2026, 8, 3, 12).toISOString(), now)).toBe("Sep 3");
    expect(dayOf(new Date(2025, 11, 31, 12).toISOString(), now)).toBe("Dec 31, 2025");
    expect(dayOf("not a date", now)).toBe("");
    expect(secondsOf(71_400)).toBe("71.4 s");
    expect(secondsOf(0)).toBe("0.0 s");
  });
});

describe("a kept turn, replayed", () => {
  it("draws each card as the role ended, with no clock running", () => {
    const view = replayView(record());
    expect(view).toMatchObject({ live: false, turnId: "20260926-143200-ab12", kind: "advise", order: ["scout", "risk", "trader", "auditor"], riskLevel: "medium" });
    expect(view.endedAt! - view.startedAt!).toBe(71_400);
    const metric = (role: string) => metricText(metricFor(view, view.roles[role]!)!);
    expect(metric("scout")).toBe("NVDA / TOP PICK");
    expect(metric("risk")).toBe("medium / RISK LEVEL");
    expect(metric("trader")).toBe("NVDA / ENTRY PLAN");
    expect(metric("auditor")).toBe("no answer / MODEL FAILED");
    // The same moment or a day later, the card reads the same.
    const look = (now: number) => cardLook(view, "scout", { index: 1, now });
    expect(look(0)?.time).toBe("18.2 s");
    expect(look(Date.now() + 86_400_000)).toEqual(look(0));
    expect(cardLook(view, "auditor", { index: 4, now: 0 })).toMatchObject({ tone: "error", detail: HERMES, receiptSlot: false });
  });

  it("shows the receipt slot only while the turn is unsigned", () => {
    const signed = record({
      replies: replies.map((r) => (r.role === "auditor" ? { ...r, ok: true, reply: "@Sparky Outlook recorded [F1].", failure: undefined, detail: undefined } as RoleReply : r)),
      receipt: { hash: "0x12", status: "success", ticker: "NVDA", amount: "40", at: "2026-09-26T14:40:00.000Z" },
    });
    expect(cardLook(replayView(signed), "auditor", { index: 4, now: 0, receipt: true })?.receiptSlot).toBe(false);
    expect(cardLook(replayView({ ...signed, receipt: undefined }), "auditor", { index: 4, now: 0 })?.receiptSlot).toBe(true);
  });

  it("draws a replay card without Focus and without the chip", () => {
    const view = replayView(record());
    const look = cardLook(view, "auditor", { index: 4, now: 0 })!;
    const html = renderToStaticMarkup(createElement(TurnCard, { look, replay: true })).replace(/<!-- -->/g, "");
    expect(html).toContain("04 · AUDITOR");
    expect(html).toContain("model failed");
    expect(html).not.toContain("st-card-focus");
    expect(html).not.toContain("st-card-chip");
    expect(html).not.toContain("<button");
    // The live card keeps both.
    expect(renderToStaticMarkup(createElement(TurnCard, { look }))).toContain("st-card-focus");
  });
});

describe("each agent's part", () => {
  it("keeps every answer whole and gives a failure its label and the reason verbatim", () => {
    const parts = partsOf(record());
    expect(parts.map((p) => p.role)).toEqual(["scout", "risk", "trader", "auditor"]);
    expect(parts[0]).toMatchObject({ name: "Scout", agentName: "eqlty-scout-1a2b3c4d", time: "18.2 s", ok: true, tone: "done", text: replies[0]!.reply });
    expect(parts[3]).toMatchObject({ name: "Auditor", ok: false, tone: "error", failure: "Model failed: API call failed after 3 retries: HTTP 502: upstream_failed" });
  });

  it("reads a runtime's failure sent as an answer as no answer", () => {
    const parts = partsOf(record({ replies: [{ role: "trader", phase: 2, ok: true, reply: HERMES, ms: 4_000 }] }));
    expect(parts[0]).toMatchObject({ ok: false, failure: `Model failed: ${HERMES}` });
  });

  it("marks a role that slept as a warning and one the person stopped waiting for as quiet", () => {
    const parts = partsOf(
      record({
        replies: [
          { role: "scout", phase: 1, ok: false, reply: "", failure: "offline", ms: 0 },
          { role: "risk", phase: 1, ok: false, reply: "", failure: "stopped", detail: "Stopped waiting for Risk.", ms: 3_000 },
        ],
      }),
    );
    expect(parts[0]).toMatchObject({ tone: "warn", time: "", failure: "Asleep" });
    expect(parts[1]).toMatchObject({ tone: "dim", failure: "Stopped waiting: Stopped waiting for Risk." });
  });

  it("labels any failure the same way", () => {
    expect(failureText("timeout", "timed out after 55000ms")).toBe("Timed out: timed out after 55000ms");
    expect(failureText(undefined, "  ")).toBe("Failed");
  });
});

describe("why the turn went that way", () => {
  it("gives Risk's line, the Trader's plan, the Auditor's record and Sparky's summary", () => {
    const why = whyOf(record());
    expect(why.map((w) => w.label)).toEqual(["Risk", "Trader's plan", "Auditor's record", "Sparky's summary"]);
    expect(why[0]).toMatchObject({ who: "risk", level: "medium", missing: false, text: "NVDA can take 50 USDG. Block if NVDA loses 172 [F1]." });
    expect(why[1]).toMatchObject({ text: "Entry plan for NVDA [F1]: 40 USDG, stop at 172.", missing: false });
    expect(why[2]).toMatchObject({ text: "No answer: model failed", missing: true });
    expect(why[3]).toMatchObject({ who: "sparky", text: "The desk would start with NVDA, 40 USDG, and stop out under 172.", missing: false });
  });

  it("keeps it to one short line per agent, and says why there is no summary", () => {
    const long = `@Sparky ${"Hold NVDA while it keeps the range. ".repeat(20)}`;
    const why = whyOf(record({ replies: [{ ...replies[2]!, reply: long }], summary: undefined, stopped: true }));
    expect(why.map((w) => w.who)).toEqual(["trader", "sparky"]);
    expect(why[0]!.text.length).toBe(WHY_CHARS);
    expect(why[0]!.text.endsWith("…")).toBe(true);
    expect(why[0]!.text).not.toMatch(/\s{2}|@Sparky/);
    expect(why[1]).toMatchObject({ text: "No summary: you stopped waiting for the team.", missing: true });
    expect(whyOf(record({ summary: " " }))[3]).toMatchObject({ text: "No summary was kept for this turn.", missing: true });
  });

  it("reads a fact line as its number and its text", () => {
    expect(factParts(FACTS[0]!)).toEqual({ n: 1, text: "NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable." });
    expect(factParts("A line without a tag")).toEqual({ n: null, text: "A line without a tag" });
  });
});

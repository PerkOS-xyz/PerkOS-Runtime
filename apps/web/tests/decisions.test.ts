/**
 * A desk turn as Memory reads it: a decision.
 */

import { describe, expect, it } from "vitest";

import { asTurnRecord, checkName, decisionLines, decisionOf, decisionRow, decisionsBlock, firstSentence, plainAnswer, withoutHashes } from "../app/lib/decisions";
import type { TurnRecord } from "../app/lib/turnRecord";

const HASH = `0x${"ab".repeat(32)}`;

const record = (extra: Partial<TurnRecord> = {}): TurnRecord => ({
  v: 1,
  id: "20260926-143205-ab12",
  desk: "eqlty-desk",
  module: "stocks-robinhood",
  kind: "analyze",
  question: "How is NVDA doing today?",
  principal: "@Scout @Risk How is NVDA doing today?",
  startedAt: new Date(2026, 8, 26, 14, 32, 5).toISOString(),
  endedAt: new Date(2026, 8, 26, 14, 33, 16).toISOString(),
  ms: 71_400,
  facts: ["[F1] NVDA (NVIDIA): 181.20 USDG, +1.20% in 24h"],
  memory: "",
  head: "",
  prompts: {},
  replies: [
    { role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA trades at 181.20 USDG, up 1.2% on the day [F1]. The range holds [F2].", ms: 18_200 },
    { role: "risk", phase: 1, ok: true, reply: "RISK: medium\n@Trader @Auditor keep it under 50 USDG; block above 2% slippage.", ms: 12_900 },
    { role: "trader", phase: 2, ok: true, reply: "@Sparky Buy 50 USDG of NVDA below 178 USDG [F1].\nTake profit 195, stop 170.", ms: 20_100 },
    { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
  ],
  guests: [],
  riskLevel: "medium",
  flags: ["auditor:no-answer"],
  trace: [],
  summary: "The desk reads NVDA as steady [F1]. Risk is medium, and the Auditor did not answer.",
  ...extra,
});

describe("decisionOf", () => {
  it("reads each agent's line or why it gave none, the plan, the record and Sparky's summary", () => {
    const d = decisionOf(record());
    expect(d.agents).toEqual([
      { role: "scout", name: "Scout", phase: 1, ok: true, line: "NVDA trades at 181.20 USDG, up 1.2% on the day.", time: "18.2 s" },
      { role: "risk", name: "Risk", phase: 1, ok: true, line: "Keep it under 50 USDG; block above 2% slippage.", time: "12.9 s" },
      { role: "trader", name: "Trader", phase: 2, ok: true, line: "Buy 50 USDG of NVDA below 178 USDG.", time: "20.1 s" },
      { role: "auditor", name: "Auditor", phase: 2, ok: false, line: "model failed", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", time: "20.0 s" },
    ]);
    expect(d.voices).toEqual([
      { role: "scout", ok: true },
      { role: "risk", ok: true },
      { role: "trader", ok: true },
      { role: "auditor", ok: false },
    ]);
    expect(d.plan).toBe("Buy 50 USDG of NVDA below 178 USDG.\nTake profit 195, stop 170.");
    expect(d.record).toBeUndefined();
    expect(d.recordMissing).toBe("model failed");
    expect(d.summary).toBe("The desk reads NVDA as steady. Risk is medium, and the Auditor did not answer.");
    expect(d).toMatchObject({ kind: "analyze", riskLevel: "medium", time: "71.4 s", answered: 3, missing: 1, checks: ["Auditor · no answer"] });
    expect(d.outcome).toBe("The desk reads NVDA as steady.");
  });

  it("never reads a runtime's failure text as an answer", () => {
    const d = decisionOf(
      record({ replies: [{ role: "trader", phase: 2, ok: true, reply: "API call failed after 3 retries: HTTP 502", ms: 4_000 }], summary: undefined }),
    );
    expect(d.agents[0]).toMatchObject({ ok: false, line: "model failed", detail: "API call failed after 3 retries: HTTP 502" });
    expect(d.plan).toBeUndefined();
    expect(d.planMissing).toBe("model failed");
    expect(d.outcome).toBe("No answer from the team: model failed.");
  });

  it("sums a turn up by its plan without Sparky's summary, and by why it ended early without answers", () => {
    expect(decisionOf(record({ summary: undefined })).outcome).toBe("Plan: Buy 50 USDG of NVDA below 178 USDG.");
    const early = record({
      summary: undefined,
      error: { code: "TEAM_ASLEEP", message: "The team is asleep. Wake it and ask again." },
      replies: [{ role: "scout", phase: 1, ok: false, reply: "", failure: "offline", ms: 0 }],
    });
    expect(decisionOf(early)).toMatchObject({ outcome: "Ended early: The team is asleep. Wake it and ask again.", ended: "The team is asleep. Wake it and ask again.", answered: 0 });
    expect(decisionOf(early).agents[0]).toEqual({ role: "scout", name: "Scout", phase: 1, ok: false, line: "asleep" });
  });

  it("keeps a signed order without its hash, and a short row for the list", () => {
    const signed = record({ receipt: { hash: HASH, explorerUrl: `https://explorer.example/tx/${HASH}`, status: "success", ticker: "NVDA", amount: "50", at: "x" } });
    expect(decisionOf(signed).signed).toBe("NVDA 50, success");
    expect(JSON.stringify(decisionOf(signed))).not.toContain("0x");
    const row = decisionRow(record({ question: `  ${"Why ".repeat(80)}?` }));
    expect(row.question.length).toBeLessThanOrEqual(200);
    expect(Object.keys(row).sort()).toEqual(["answered", "kind", "missing", "outcome", "question", "riskLevel", "startedAt", "voices"]);
  });
});

describe("decisionLines", () => {
  it("gives the summary the question, the risk, the plan and the record, one line each", () => {
    const lines = decisionLines(record()).split("\n");
    expect(lines).toEqual([
      "Question (14:32, analyze): How is NVDA doing today?",
      "Risk: medium",
      "Plan: Buy 50 USDG of NVDA below 178 USDG. Take profit 195, stop 170.",
      "Record: none (the Auditor did not answer: model failed)",
    ]);
  });

  it("never gives the summary a hash, an address or a link to one", () => {
    const text = decisionLines(
      record({
        question: `Did ${HASH} go through?`,
        riskLevel: undefined,
        replies: [
          { role: "trader", phase: 2, ok: true, reply: `@Sparky Sent from 0x3f0D${"1".repeat(36)}, tx 0xab12…9f00.`, ms: 1 },
          { role: "auditor", phase: 2, ok: true, reply: `@Sparky Logged at https://explorer.example/tx/${HASH} for review.`, ms: 1 },
        ],
        receipt: { hash: HASH, explorerUrl: `https://explorer.example/tx/${HASH}`, status: "success", ticker: "NVDA", amount: "50", at: "x" },
      }),
    );
    expect(text).not.toMatch(/0x/i);
    expect(text).not.toContain("explorer.example");
    expect(text).toContain("Risk: not rated");
    expect(text).toContain("Record: Logged at for review. Signed NVDA 50, success.");
  });

  it("keeps the newest decisions of a day when they do not all fit", () => {
    const at = (h: number) => new Date(2026, 8, 26, h, 0).toISOString();
    const turns = [9, 10, 11].map((h) => record({ id: `20260926-${h}0000-0000`, startedAt: at(h), question: `Question at ${h}?` }));
    const all = decisionsBlock(turns, "2026-09-26", 10_000);
    expect(all.startsWith("Desk decisions of 2026-09-26, oldest first. Keep each one under Decisions")).toBe(true);
    expect(all.indexOf("Question at 9?")).toBeLessThan(all.indexOf("Question at 11?"));
    const two = decisionsBlock(turns, "2026-09-26", all.length - 100);
    expect(two).toContain("(1 earlier left out)");
    expect(two).not.toContain("Question at 9?");
    expect(two).toContain("Question at 11?");
    expect(two.length).toBeLessThanOrEqual(all.length - 100);
    expect(decisionsBlock([], "2026-09-26", 10_000)).toBe("");
  });
});

describe("reading helpers", () => {
  it("takes hashes, addresses and explorer links out of a text", () => {
    expect(withoutHashes(`Signed ${HASH} on https://explorer.example/tx/${HASH} today`)).toBe("Signed on today");
    expect(withoutHashes("tx 0xab12…9f00 and 0xab12...9f00 done")).toBe("tx and done");
    expect(withoutHashes("NVDA at 181.20 USDG, 10x volume")).toBe("NVDA at 181.20 USDG, 10x volume");
  });

  it("reads an answer without the mentions and the RISK line it opens with", () => {
    expect(plainAnswer("RISK: high\n@Trader, @Auditor: stand down [F1, F2].")).toBe("Stand down.");
    expect(plainAnswer("@Sparky VERDICT: BLOCK over the cap.")).toBe("Over the cap.");
    expect(firstSentence("Wait. NVDA is near the top of its range. Buy later.")).toBe("Wait. NVDA is near the top of its range.");
    expect(checkName("scout:no-citation")).toBe("Scout · no citation");
  });

  it("reads only a whole turn record from a note", () => {
    expect(asTurnRecord({ v: 1 })).toBeNull();
    expect(asTurnRecord(null)).toBeNull();
    const { guests: _guests, ...withoutGuests } = record();
    expect(asTurnRecord(withoutGuests)?.guests).toEqual([]);
    expect(asTurnRecord(record())?.id).toBe("20260926-143205-ab12");
  });
});

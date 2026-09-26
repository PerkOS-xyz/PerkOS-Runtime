/**
 * Why an agent gave no answer. Every card and every History line is labelled
 * from this, so each shape PerkOS or a runtime uses for a failure is here.
 */

import { PerkosApiError } from "@perkos/client";
import { describe, expect, it } from "vitest";

import { classifyAnswer, classifyError, failureLabel, runtimeFailure } from "../app/lib/turnFailure";
import { newTurnId, turnBody, turnTitle, withoutFactTags, type TurnRecord } from "../app/lib/turnRecord";

describe("a task that came back", () => {
  it("keeps a delivered answer and never keeps PerkOS's reply length as a reason", () => {
    expect(classifyAnswer({ ok: true, reply: "  @Trader NVDA holds [F1].  ", detail: "reply len=12" })).toEqual({ ok: true, reply: "@Trader NVDA holds [F1]." });
  });

  it("reads a runtime's failure text sent as a reply as a model failure, with the text as the reason", () => {
    const text = "API call failed after 3 retries: HTTP 502: upstream_failed";
    expect(classifyAnswer({ ok: true, reply: text, detail: "reply len=58" })).toEqual({ ok: false, reply: "", failure: "model", detail: text });
  });

  it("knows every failure text the runtime sends as a reply", () => {
    const texts: Array<[string, string]> = [
      ["API call failed after 1 retry: HTTP 500", "model"],
      ["Invalid API response after 3 retries: empty choices", "model"],
      ["Stream repeatedly dropped mid tool-call (network); the tool was not executed", "model"],
      ["I apologize, but I encountered repeated errors: rate limited", "model"],
      ["I apologize, but I encountered an error while processing the model response: bad json", "model"],
      ["I reached the maximum iterations (90) but couldn't summarize. Error: boom", "model"],
      ["Operation interrupted: waiting for model response (61.2s elapsed).", "model"],
      ["Session is shutting down. Your conversation can be resumed with: hermes --resume <session-id>", "offline"],
      ["Operation interrupted during retry (empty response, attempt 2/3).", "model"],
      ["Operation interrupted: handling API error (RateLimitError: slow down).", "model"],
      ["Operation interrupted: retrying API call after error (retry 1/3).", "model"],
      ["Operation interrupted: retrying empty response from model (retry 1/2).", "model"],
      ["Operation interrupted.", "model"],
      ["Billing or credits exhausted: insufficient_quota", "model"],
      ["Provider reported usage/credit exhaustion (unverified, the same error can be a content-filter rejection, not billing): 429", "model"],
    ];
    for (const [text, kind] of texts) expect([text, classifyAnswer({ ok: true, reply: text }).failure]).toEqual([text, kind]);
    expect(runtimeFailure("The operation was interrupted twice, but NVDA held its range [F1].")).toBeNull();
    expect(runtimeFailure("The API call failed after 3 retries, says the log")).toBeNull();
  });

  it("labels each of PerkOS's reasons", () => {
    const cases: Array<[string, string]> = [
      ["timed out after 55000ms", "timeout"],
      ["agent 'eqlty-scout-1234abcd' not connected to relay", "offline"],
      ["Agent is not ready", "offline"],
      ["Runtime delivery failed: 503", "model"],
      ["HTTP 502: upstream_failed", "model"],
      ["runtime task failed", "model"],
      ["relay connect failed", "network"],
      ["relay disconnected: socket closed", "network"],
      ['relay error: {"code":"x"}', "network"],
      ["empty reply from runtime", "empty"],
      ["API call failed after 3 retries: HTTP 502", "model"],
      ["something new", "other"],
    ];
    for (const [detail, kind] of cases) {
      expect([detail, classifyAnswer({ ok: false, reply: "", detail })]).toEqual([detail, { ok: false, reply: "", failure: kind, detail }]);
    }
  });

  it("calls a blank answer empty", () => {
    expect(classifyAnswer({ ok: true, reply: "   " })).toMatchObject({ ok: false, failure: "empty" });
    expect(classifyAnswer({ ok: false, reply: "" })).toMatchObject({ ok: false, failure: "other", detail: "PerkOS gave no reason." });
  });
});

describe("a task that did not come back", () => {
  it("gives desk time, admin approval and a missing model key their own labels", () => {
    expect(classifyError(new PerkosApiError("Payment is required", 402, "INFRA_PAYMENT_REQUIRED")).failure).toBe("no_time");
    expect(classifyError(new PerkosApiError("Credits are exhausted", 402, "INFRA_CREDITS_EXHAUSTED")).failure).toBe("no_time");
    expect(classifyError(new PerkosApiError("Requires administrator approval", 403, "INFRA_APPROVAL_REQUIRED"))).toEqual({
      failure: "approval",
      detail: "Requires administrator approval",
    });
    expect(classifyError(new PerkosApiError("Provide your own LLM API key.", 403, "LLM_BYOK_REQUIRED")).failure).toBe("byok");
  });

  it("tells a sleeping agent, a deadline, an unreachable PerkOS and a stop apart", () => {
    expect(classifyError(new PerkosApiError("Agent is not ready", 409, "AGENT_NOT_READY")).failure).toBe("offline");
    expect(classifyError(new PerkosApiError("PerkOS did not answer: timeout", 0, "PERKOS_TIMEOUT")).failure).toBe("timeout");
    expect(classifyError(new PerkosApiError("PerkOS did not answer: ECONNREFUSED", 0, "PERKOS_UNREACHABLE")).failure).toBe("network");
    expect(classifyError(new PerkosApiError("PerkOS did not answer: aborted", 0, "PERKOS_ABORTED")).failure).toBe("stopped");
    expect(classifyError(new DOMException("timed out", "TimeoutError")).failure).toBe("timeout");
    expect(classifyError(new Error("anything"), true).failure).toBe("stopped");
    expect(classifyError(new PerkosApiError("Agent not found", 404, "NOT_FOUND"))).toEqual({ failure: "other", detail: "Agent not found" });
  });

  it("has a short label for every failure", () => {
    expect(failureLabel("model")).toBe("model failed");
    expect(failureLabel("approval")).toBe("needs admin approval");
    expect(failureLabel("byok")).toBe("needs its own model key");
    expect(failureLabel("no_time")).toBe("no desk time");
    expect(failureLabel("stopped")).toBe("stopped waiting");
    expect(failureLabel("offline")).toBe("asleep");
    expect(failureLabel("setting_up")).toBe("still being set up");
    expect(failureLabel("start_failed")).toBe("failed to start");
  });
});

describe("a turn's record", () => {
  const record: TurnRecord = {
    v: 1,
    id: "20260926-143205-ab12",
    desk: "eqlty-desk",
    module: "stocks-robinhood",
    kind: "analyze",
    question: "How is NVDA doing today?",
    principal: "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG.",
    startedAt: new Date(2026, 8, 26, 14, 32, 5).toISOString(),
    endedAt: new Date(2026, 8, 26, 14, 33, 16).toISOString(),
    ms: 71_400,
    facts: ["[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, tradeable."],
    memory: "",
    head: "Request to the desk",
    prompts: {},
    replies: [
      { role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA trades at 181.20 USDG [F1].", ms: 18_200 },
      { role: "risk", phase: 1, ok: true, reply: "RISK: medium\n@Trader @Auditor keep it small.", ms: 12_900 },
      { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
    ],
    guests: [],
    riskLevel: "medium",
    flags: ["auditor:no-answer"],
    trace: [],
    summary: "The desk reads NVDA as steady.",
  };

  it("has a dated title in local time and an id that sorts by time", () => {
    expect(turnTitle(record)).toBe("2026-09-26 14:32 How is NVDA doing today?");
    expect(turnTitle({ ...record, question: "x".repeat(80) })).toHaveLength(17 + 60);
    expect(newTurnId(new Date(2026, 8, 26, 14, 32, 5), () => 0.6668)).toBe("20260926-143205-aab3");
  });

  it("reads as an account of what happened, failures included", () => {
    expect(turnBody(record, failureLabel)).toBe(
      [
        "Asked: How is NVDA doing today?",
        "Analyze · Risk medium · 71.4 s",
        "Scout (18.2 s): @Trader @Auditor NVDA trades at 181.20 USDG.",
        "Risk (12.9 s): RISK: medium @Trader @Auditor keep it small.",
        "Auditor: no answer, model failed (API call failed after 3 retries: HTTP 502: upstream_failed)",
        "Sparky: The desk reads NVDA as steady.",
        "Checks: auditor:no-answer",
      ].join("\n"),
    );
  });

  it("keeps the [Fn] tags out of the note, since each turn numbers its own facts, and in the record for History", () => {
    const tagged: TurnRecord = { ...record, summary: "NVDA holds [F1], AAPL slips [F2][F3]." };
    const body = turnBody(tagged, failureLabel);
    expect(body).not.toMatch(/\[F\d+\]/);
    expect(body).toContain("Sparky: NVDA holds, AAPL slips.");
    expect(tagged.replies[0]!.reply).toContain("[F1]");
    expect(withoutFactTags("Up 1.2% [F1] and near the top [F12].")).toBe("Up 1.2% and near the top.");
  });
});

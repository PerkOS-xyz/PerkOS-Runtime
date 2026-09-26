/**
 * The turn against a fake team: who is asked when, with what, and how each
 * way of not answering ends up in the record.
 */

import { PerkosApiError, type AgentAnswer } from "@perkos/client";
import { describe, expect, it, vi } from "vitest";

import { riskLevelOf, runTurn, STARTING_RETRY_MS, verdictOf, type AskAgent, type RunTurnInput, type TurnSeat } from "../app/lib/turnEngine";
import { TURN_PHASES, type TurnEvent } from "../app/lib/turnRecord";

const rolePrompts = {
  scout: "As Scout: read the facts.",
  risk: 'As Risk: first line "RISK: low", "RISK: medium" or "RISK: high".',
  trader: "As Trader: the entry plan.",
  auditor: "As Auditor: the record.",
};
const seat = (role: string, extra: Partial<TurnSeat> = {}): TurnSeat => ({ role, ready: true, agentId: `id-${role}`, agentName: `eqlty-${role}-1234abcd`, ...extra });
const seats = (extra: Record<string, Partial<TurnSeat>> = {}) =>
  Object.fromEntries(["scout", "risk", "trader", "auditor"].map((r) => [r, seat(r, extra[r])])) as Record<string, TurnSeat>;

const answers: Record<string, string> = {
  "id-scout": "@Trader @Auditor NVDA holds its range [F1].",
  "id-risk": "RISK: medium\n@Trader @Auditor Keep it to 50 USDG.",
  "id-trader": "@Sparky Entry: 50 USDG.",
  "id-auditor": "@Sparky Thesis: NVDA holds [F1].",
};
const answer = (agentId: string, text = answers[agentId] ?? "ok"): AgentAnswer => ({ ok: true, reply: text, detail: `reply len=${text.length}`, agentId, agentName: "", ms: 5 });
/** What PerkOS sends back when the agent's bridge is up and its runtime is not listening yet. */
const starting = (agentId: string, detail = "Runtime delivery failed: fetch failed"): AgentAnswer => ({ ok: false, reply: "", detail, agentId, agentName: "", ms: 5 });

function setup(ask: AskAgent, extra: Partial<RunTurnInput> = {}) {
  const events: TurnEvent[] = [];
  const stop = new AbortController();
  const touch = vi.fn(async () => undefined);
  const input: RunTurnInput = {
    kind: "analyze",
    phases: TURN_PHASES,
    seats: seats(),
    head: "HEAD",
    rolePrompts,
    ask,
    touch,
    emit: (e) => events.push(e),
    signal: stop.signal,
    ...extra,
  };
  return { input, events, stop, touch, steps: () => events.map((e) => (e.step === "start" || e.step === "reply" ? `${e.step}:${e.role}` : e.step)) };
}

describe("a desk turn", () => {
  it("asks Scout and Risk first, then Trader and Auditor with what the first two said", async () => {
    const asked: Array<{ id: string; prompt: string; timeoutMs: number }> = [];
    const ask: AskAgent = async (id, prompt, o) => {
      asked.push({ id, prompt, timeoutMs: o.timeoutMs });
      return answer(id);
    };
    const { input, events, touch, steps } = setup(ask);
    const out = await runTurn(input);
    expect(steps().filter((s) => s.startsWith("start") || s.startsWith("reply") || s === "phase")).toEqual([
      "phase",
      "start:scout",
      "start:risk",
      "reply:scout",
      "reply:risk",
      "phase",
      "start:trader",
      "start:auditor",
      "reply:trader",
      "reply:auditor",
    ]);
    expect(asked.map((a) => a.id)).toEqual(["id-scout", "id-risk", "id-trader", "id-auditor"]);
    expect(asked.every((a) => a.prompt.startsWith("HEAD\n\n") && a.timeoutMs === 55_000)).toBe(true);
    for (const a of asked.slice(2)) {
      expect(a.prompt).toContain('Scout said: "@Trader @Auditor NVDA holds its range [F1]."');
      expect(a.prompt).toContain('Risk said: "RISK: medium @Trader @Auditor Keep it to 50 USDG." (risk medium).');
    }
    expect(asked[0]!.prompt).not.toContain("Scout said");
    expect(out.prompts.trader).toContain("As Trader: the entry plan.");
    expect(out.prompts.scout).toBe("As Scout: read the facts.");
    expect(out.riskLevel).toBe("medium");
    expect(out.verdict).toBeUndefined();
    expect(out.stopped).toBe(false);
    expect(out.replies.map((r) => [r.role, r.phase, r.ok])).toEqual([
      ["scout", 1, true],
      ["risk", 1, true],
      ["trader", 2, true],
      ["auditor", 2, true],
    ]);
    expect(out.replies[0]).not.toHaveProperty("detail");
    expect(events.find((e) => e.step === "reply" && e.role === "risk")).toMatchObject({ riskLevel: "medium" });
    expect(touch).toHaveBeenCalledTimes(4);
    const working = events.filter((e) => e.step === "working").map((e) => (e as { text: string }).text);
    expect(working).toContain("Scout is reading the facts");
    expect(working).toContain("Handing Scout and Risk to Trader and Auditor");
    expect(working).toContain("Auditor is writing the record");
    expect(working.some((t) => /^Scout answered in \d+\.\d s$/.test(t))).toBe(true);
  });

  it("does not ask a role that is not up, and records why with no start", async () => {
    const ask = vi.fn(async (id: string, _prompt: string) => answer(id));
    const { input, events } = setup(ask, { seats: seats({ risk: { ready: false, failure: "offline", detail: "Still asleep after 240 s" } }) });
    const out = await runTurn(input);
    expect(events.some((e) => e.step === "start" && e.role === "risk")).toBe(false);
    expect(out.replies.find((r) => r.role === "risk")).toEqual({
      role: "risk",
      phase: 1,
      agentName: "eqlty-risk-1234abcd",
      ok: false,
      reply: "",
      failure: "offline",
      detail: "Still asleep after 240 s",
      ms: 0,
    });
    expect(events).toContainEqual({ step: "failure", role: "risk", phase: 1, failure: "offline", label: "asleep", detail: "Still asleep after 240 s" });
    expect(ask.mock.calls.map((c) => c[0])).toEqual(["id-scout", "id-trader", "id-auditor"]);
    expect(String(ask.mock.calls[1]![1])).toContain("(Risk did not answer: asleep).");
  });

  it("records a runtime failure sent as a reply as a failure, and a refusal with its own label", async () => {
    const ask: AskAgent = async (id) => {
      if (id === "id-auditor") return answer(id, "API call failed after 3 retries: HTTP 502: upstream_failed");
      if (id === "id-trader") throw new PerkosApiError("Provide your own LLM API key.", 403, "LLM_BYOK_REQUIRED");
      return answer(id);
    };
    const { input } = setup(ask);
    const out = await runTurn(input);
    expect(out.replies.find((r) => r.role === "auditor")).toMatchObject({ ok: false, failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed" });
    expect(out.replies.find((r) => r.role === "trader")).toMatchObject({ ok: false, failure: "byok", detail: "Provide your own LLM API key." });
  });

  it("stops waiting when the person stops, without claiming the agents were cancelled", async () => {
    let release: () => void = () => undefined;
    const ask: AskAgent = (id, _prompt, o) =>
      new Promise((resolve, reject) => {
        if (id === "id-scout") return resolve(answer(id));
        release = () => reject(new PerkosApiError("PerkOS did not answer: aborted", 0, "PERKOS_ABORTED"));
        o.signal.addEventListener("abort", () => release());
      });
    const { input, stop } = setup(ask);
    const running = runTurn(input);
    await new Promise((r) => setTimeout(r, 5));
    stop.abort();
    const out = await running;
    expect(out.stopped).toBe(true);
    const risk = out.replies.find((r) => r.role === "risk")!;
    expect(risk).toMatchObject({ ok: false, failure: "stopped" });
    expect(risk.detail).toBe("Stopped waiting for Risk. Risk may still finish the task on PerkOS; that answer is not kept.");
    expect(out.replies.find((r) => r.role === "trader")).toMatchObject({ ok: false, failure: "stopped", ms: 0, detail: "Stopped before Trader was asked." });
    expect(out.replies.find((r) => r.role === "scout")?.ok).toBe(true);
  });

  it("asks an agent that is still starting again until it answers", async () => {
    let scoutAsks = 0;
    const ask: AskAgent = async (id) => (id === "id-scout" && ++scoutAsks < 3 ? starting(id) : answer(id));
    const pauses: number[] = [];
    const { input, events } = setup(ask, {
      pause: async (ms) => {
        pauses.push(ms);
      },
    });
    const out = await runTurn(input);
    expect(scoutAsks).toBe(3);
    expect(pauses).toEqual([STARTING_RETRY_MS, STARTING_RETRY_MS]);
    expect(out.replies.find((r) => r.role === "scout")).toMatchObject({ ok: true, reply: answers["id-scout"] });
    const working = events.filter((e) => e.step === "working").map((e) => (e as { text: string }).text);
    expect(working.filter((t) => t === "Scout is still starting up; asking again")).toHaveLength(1);
  });

  it("gives up on an agent still starting after a while, and does not ask again after the runtime's own error", async () => {
    let clock = 0;
    const asks: Record<string, number> = {};
    const ask: AskAgent = async (id) => {
      asks[id] = (asks[id] ?? 0) + 1;
      if (id === "id-scout") return starting(id);
      if (id === "id-risk") return starting(id, "Runtime delivery failed: Hermes API delivery failed (500) at http://127.0.0.1:8642/v1/responses: boom");
      return answer(id);
    };
    const { input } = setup(ask, {
      now: () => clock,
      pause: async (ms) => {
        clock += ms;
      },
    });
    const out = await runTurn(input);
    // Asked right away, then every 8 s while under 90 s had passed: at 0, 8, ... 88 s, and once more at 96 s.
    expect(asks["id-scout"]).toBe(13);
    expect(out.replies.find((r) => r.role === "scout")).toMatchObject({ ok: false, failure: "offline", detail: "Runtime delivery failed: fetch failed", ms: 96_000 });
    expect(asks["id-risk"]).toBe(1);
    expect(out.replies.find((r) => r.role === "risk")).toMatchObject({ ok: false, failure: "model" });
  });

  it("stops asking an agent still starting when the person stops", async () => {
    const asked: string[] = [];
    const ask: AskAgent = async (id) => {
      asked.push(id);
      return id === "id-scout" ? starting(id) : answer(id);
    };
    const holder: { stop?: AbortController } = {};
    const { input, stop } = setup(ask, {
      pause: async () => {
        holder.stop?.abort();
      },
    });
    holder.stop = stop;
    const out = await runTurn(input);
    expect(asked.filter((a) => a === "id-scout")).toHaveLength(1);
    expect(out.stopped).toBe(true);
    expect(out.replies.find((r) => r.role === "scout")).toMatchObject({ ok: false, failure: "stopped", detail: "Stopped while Scout was still starting." });
  });

  it("reads Risk's verdict on an order turn, and blocks when there is none", async () => {
    const withVerdict = setup(async (id) => answer(id, id === "id-risk" ? "VERDICT: GO\n@Trader @Auditor within limits." : answers[id]));
    expect((await runTurn({ ...withVerdict.input, kind: "order" })).verdict).toBe("GO");
    const without = setup(async (id) => answer(id));
    const asked: string[] = [];
    const out = await runTurn({
      ...without.input,
      kind: "order",
      ask: async (id, prompt) => {
        asked.push(prompt);
        return answer(id);
      },
    });
    expect(out.verdict).toBe("BLOCK");
    expect(asked[2]).toContain("(verdict BLOCK)");
  });
});

describe("reading Risk", () => {
  it("finds the level on its own line and the verdict", () => {
    expect(riskLevelOf("RISK: High\n@Trader")).toBe("high");
    expect(riskLevelOf("@Trader\nRISK: low")).toBe("low");
    expect(riskLevelOf("The risk: low")).toBeUndefined();
    expect(verdictOf("VERDICT - block")).toBe("BLOCK");
    expect(verdictOf("no verdict")).toBeUndefined();
  });
});

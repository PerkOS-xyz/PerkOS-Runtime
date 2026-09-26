/**
 * Making the team ready for a turn: wake only what sleeps, never create
 * agents, never wait on one that is being created or that failed.
 */

import { PerkosApiError, type DeskTeam, type TeamAgentState } from "@perkos/client";
import { describe, expect, it, vi } from "vitest";

import type { TurnEvent } from "../app/lib/turnRecord";
import { readyTeam, turnErrorFor, type TeamCalls } from "../app/lib/turnTeam";

const ROLES = ["scout", "risk", "trader", "auditor"];
const team = (states: Record<string, TeamAgentState>, status: DeskTeam["status"] = "partial"): DeskTeam => ({
  templateId: "eqlty-desk",
  status,
  agents: ROLES.map((role) => ({
    role,
    name: `eqlty-${role}-1234abcd`,
    state: states[role] ?? "ready",
    ...(states[role] === "planned" ? {} : { agentId: `id-${role}` }),
  })),
});
/** A desk that seats three specialists beside the turn's four roles. */
const seven = (states: Record<string, TeamAgentState>, specialists: TeamAgentState, status: DeskTeam["status"] = "partial"): DeskTeam => {
  const four = team(states, status);
  return {
    ...four,
    agents: [
      ...four.agents,
      ...["hooks", "quote", "treasury"].map((role) => ({ role, name: `eqlty-${role}-1234abcd`, state: specialists, ...(specialists === "planned" ? {} : { agentId: `id-${role}` }) })),
    ],
  };
};
const sleepingFour = { scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" } as const;

/** A fake clock the fake sleep moves forward. */
function run(calls: TeamCalls, extra: { maxWaitMs?: number } = {}) {
  let t = 0;
  const events: TurnEvent[] = [];
  const stop = new AbortController();
  const promise = readyTeam({
    team: calls,
    desk: "eqlty-desk",
    roles: ROLES,
    emit: (e) => events.push(e),
    signal: stop.signal,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    ...extra,
  });
  return { promise, events, stop, steps: () => events.filter((e) => e.step === "working").map((e) => (e as { text: string }).text) };
}

describe("making the team ready", () => {
  it("does nothing when the whole team is up", async () => {
    const calls = { status: vi.fn(async () => team({}, "ready")), wake: vi.fn() };
    const { promise, events } = run(calls);
    const out = await promise;
    expect(out.ok).toBe(true);
    expect(calls.wake).not.toHaveBeenCalled();
    expect(events.some((e) => e.step === "wake")).toBe(false);
    if (out.ok) expect(out.seats.scout).toEqual({ role: "scout", agentId: "id-scout", agentName: "eqlty-scout-1234abcd", ready: true });
  });

  it("wakes a sleeping team once and waits for it, saying so as it goes", async () => {
    const polls = [team({ scout: "waking", risk: "waking" }, "waking"), team({}, "ready")];
    const calls = {
      status: vi.fn(async () => (calls.status.mock.calls.length === 1 ? team({ scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" }, "hibernated") : polls.shift()!)),
      wake: vi.fn(async () => team({ scout: "waking", risk: "waking", trader: "waking", auditor: "waking" }, "waking")),
    };
    const { promise, events, steps } = run(calls);
    const out = await promise;
    expect(out.ok).toBe(true);
    expect(calls.wake).toHaveBeenCalledTimes(1);
    const wakes = events.filter((e) => e.step === "wake");
    expect(wakes[0]).toMatchObject({ waiting: ROLES, woke: false });
    expect(wakes.at(-1)).toMatchObject({ waiting: [], woke: true, status: "ready" });
    expect(steps()).toEqual(["Checking the team", "Waking the team", "Waiting for Scout, Risk, Trader and Auditor to wake", "The team is up after 10 s"]);
  });

  it("waits for agents already waking without asking PerkOS to wake anything", async () => {
    const answers = [team({ trader: "waking" }), team({}, "ready")];
    const calls = { status: vi.fn(async () => answers.shift()!), wake: vi.fn() };
    const out = await run(calls).promise;
    expect(out.ok).toBe(true);
    expect(calls.wake).not.toHaveBeenCalled();
    expect(calls.status).toHaveBeenCalledTimes(2);
  });

  it("never waits on an agent being created or one that failed", async () => {
    const calls = { status: vi.fn(async () => team({ risk: "provisioning", auditor: "failed" })), wake: vi.fn() };
    const out = await run(calls).promise;
    expect(calls.status).toHaveBeenCalledTimes(1);
    expect(calls.wake).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.seats.risk).toMatchObject({ ready: false, failure: "setting_up", detail: "Still being set up on PerkOS." });
    expect(out.seats.auditor).toMatchObject({ ready: false, failure: "start_failed", detail: "The agent failed to start on PerkOS." });
  });

  it("says why no role can take part when none is asleep: still being set up, or failed to start", async () => {
    const cases: Array<[Record<string, TeamAgentState>, string]> = [
      [{ scout: "failed", risk: "failed", trader: "failed", auditor: "failed" }, "TEAM_FAILED"],
      [{ scout: "provisioning", risk: "provisioning", trader: "provisioning", auditor: "provisioning" }, "TEAM_SETTING_UP"],
      [{ scout: "failed", risk: "provisioning", trader: "failed", auditor: "failed" }, "TEAM_SETTING_UP"],
    ];
    for (const [states, code] of cases) {
      const calls = { status: vi.fn(async () => team(states)), wake: vi.fn() };
      const out = await run(calls).promise;
      expect(out).toMatchObject({ ok: false, code });
      expect(calls.wake).not.toHaveBeenCalled();
      expect(calls.status).toHaveBeenCalledTimes(1);
    }
  });

  it("never wakes a desk whose specialists are not set up, since waking would set them up", async () => {
    const calls = { status: vi.fn(async () => seven(sleepingFour, "planned")), wake: vi.fn() };
    const { promise, steps } = run(calls);
    const out = await promise;
    expect(calls.wake).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: false, code: "TEAM_NOT_SET_UP", message: expect.stringContaining("Part of the desk's team is not set up yet") });
    expect(out.seats.scout).toMatchObject({ ready: false, failure: "offline", detail: "Asleep. The team was not woken, because part of it is not set up yet." });
    expect(steps()).toContain("Part of the team is not set up, so the team was not woken");

    const oneAwake = { status: vi.fn(async () => seven({ ...sleepingFour, scout: "ready" }, "planned")), wake: vi.fn() };
    const partly = await run(oneAwake).promise;
    expect(oneAwake.wake).not.toHaveBeenCalled();
    expect(partly.ok).toBe(true);
    expect(partly.seats.scout?.ready).toBe(true);
    expect(partly.seats.risk).toMatchObject({ ready: false, failure: "offline" });
  });

  it("names the turn's roles' own trouble on a seven-agent desk whose specialists are not set up", async () => {
    const failed = { scout: "failed", risk: "failed", trader: "failed", auditor: "failed" } as const;
    const calls = { status: vi.fn(async () => seven(failed, "planned")), wake: vi.fn() };
    expect(await run(calls).promise).toMatchObject({ ok: false, code: "TEAM_FAILED" });
    expect(calls.wake).not.toHaveBeenCalled();
  });

  it("runs a seven-agent desk as it is when the turn's roles are awake", async () => {
    const calls = { status: vi.fn(async () => seven({}, "planned")), wake: vi.fn() };
    const out = await run(calls).promise;
    expect(calls.wake).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(Object.keys(out.seats)).toEqual(ROLES);
  });

  it("wakes a seven-agent desk once every agent of it exists", async () => {
    const calls = {
      status: vi.fn(async () => seven(sleepingFour, "hibernated", "hibernated")),
      wake: vi.fn(async () => seven({}, "ready", "ready")),
    };
    const out = await run(calls).promise;
    expect(calls.wake).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it("never creates agents: a team that is not set up is sent back to be set up", async () => {
    for (const t of [team({ scout: "planned", risk: "planned", trader: "planned", auditor: "planned" }, "none"), { templateId: "eqlty-desk", status: "none" as const, agents: [] }]) {
      const calls = { status: vi.fn(async () => t), wake: vi.fn() };
      const out = await run(calls).promise;
      expect(out).toMatchObject({ ok: false, code: "TEAM_NOT_SET_UP" });
      expect(calls.wake).not.toHaveBeenCalled();
    }
  });

  it("does not wake a team that is partly set up, since waking would create the rest", async () => {
    const calls = { status: vi.fn(async () => team({ scout: "hibernated", risk: "planned" })), wake: vi.fn() };
    const { promise, steps } = run(calls);
    const out = await promise;
    expect(calls.wake).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.seats.risk).toMatchObject({ ready: false, failure: "not_set_up" });
    expect(out.seats.scout).toMatchObject({ ready: false, failure: "offline", detail: "Asleep. The team was not woken, because part of it is not set up yet." });
    expect(out.seats.trader?.ready).toBe(true);
    expect(steps()).toContain("Part of the team is not set up, so the team was not woken");

    const none = { status: vi.fn(async () => team({ scout: "hibernated", risk: "planned", trader: "hibernated", auditor: "hibernated" })), wake: vi.fn() };
    expect(await run(none).promise).toMatchObject({ ok: false, code: "TEAM_NOT_SET_UP" });
  });

  it("stops waiting after the limit, and says who is still asleep", async () => {
    const asleep = team({ scout: "waking", risk: "waking", trader: "waking", auditor: "waking" }, "waking");
    const calls = { status: vi.fn(async () => asleep), wake: vi.fn() };
    const { promise, steps } = run(calls, { maxWaitMs: 20_000 });
    const out = await promise;
    expect(out).toMatchObject({ ok: false, code: "TEAM_ASLEEP" });
    expect(out.seats.scout).toMatchObject({ ready: false, failure: "offline" });
    expect(steps().at(-1)).toBe("Scout, Risk, Trader and Auditor are still asleep after 20 s");
  });

  it("gives desk time, admin approval and a model key their own error when waking is refused", async () => {
    const refusals: Array<[PerkosApiError, string]> = [
      [new PerkosApiError("Payment is required", 402, "INFRA_PAYMENT_REQUIRED"), "NO_DESK_TIME"],
      [new PerkosApiError("Needs approval", 403, "INFRA_APPROVAL_REQUIRED"), "INFRA_APPROVAL_REQUIRED"],
      [new PerkosApiError("Provide your own LLM API key.", 403, "LLM_BYOK_REQUIRED"), "LLM_BYOK_REQUIRED"],
    ];
    for (const [err, code] of refusals) {
      const calls = { status: vi.fn(async () => team({ scout: "hibernated" })), wake: vi.fn(async () => Promise.reject(err)) };
      expect(await run(calls).promise).toMatchObject({ ok: false, code });
    }
    expect(turnErrorFor(new PerkosApiError("down", 0, "PERKOS_UNREACHABLE")).code).toBe("TEAM_UNREACHABLE");
    expect(turnErrorFor(new PerkosApiError("Sign in", 401, "PERKOS_SESSION")).code).toBe("SIGNED_OUT");
  });

  it("stops waiting as soon as the person stops", async () => {
    const calls = { status: vi.fn(async () => team({ scout: "waking" })), wake: vi.fn() };
    const r = run(calls);
    r.stop.abort();
    const out = await r.promise;
    expect(out.ok).toBe(true);
    expect(calls.status).toHaveBeenCalledTimes(1);
  });
});

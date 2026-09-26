/**
 * The desk's team in the scene: what each state looks like, what the wake
 * button offers, and the local route that asks PerkOS.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST, PUT } from "../app/api/desks/team/route";
import { KEEP_AWAKE_MS, memberLook, pollEvery, seating, specialistSeat, wakeAction, wakesOnOpen } from "../app/team/look";

describe("how the team shows", () => {
  it("maps where PerkOS says each agent stands", () => {
    expect(memberLook("ready")).toEqual({ avatar: "idle", label: "Online" });
    expect(memberLook("hibernated")).toEqual({ avatar: "hibernating", label: "Asleep" });
    expect(memberLook("waking").avatar).toBe("thinking");
    expect(memberLook(undefined)).toEqual({ avatar: "offline", label: "Not set up" });
  });

  it("seats the table beside Sparky and every other agent as a specialist, whatever the count", () => {
    const agent = (role: string) => ({ role, name: `eqlty-${role}-1`, state: "planned" as const });
    const { table, specialists } = seating(["hooks", "auditor", "quote", "scout", "risk", "treasury", "trader"].map(agent));
    expect(table.map((a) => a.role)).toEqual(["scout", "risk", "trader", "auditor"]);
    expect(specialists.map((a) => a.role)).toEqual(["hooks", "quote", "treasury"]);
    expect([0, 1, 2, 3, 4, 5].map((i) => specialistSeat(i, 6).x)).toEqual([-406, -318, -230, 230, 318, 406]);
    expect(specialistSeat(0, 1)).toEqual({ x: -230, row: 0 });
  });

  it("offers to wake only when waking would do something", () => {
    expect(wakeAction("hibernated", false)).toEqual({ label: "Wake team", enabled: true });
    expect(wakeAction("none", false)).toEqual({ label: "Set up the team", enabled: true });
    expect(wakeAction("ready", false).enabled).toBe(false);
    expect(wakeAction("hibernated", true)).toEqual({ label: "Waking…", enabled: false });
    expect(pollEvery("waking")).toBeLessThan(pollEvery("ready"));
  });

  it("wakes a sleeping team on its own when the desk opens, and never sets one up", () => {
    const team = (...states: string[]) => ({ status: "hibernated" as const, agents: states.map((state) => ({ state })) });
    expect(wakesOnOpen(team("hibernated", "hibernated"))).toBe(true);
    expect(wakesOnOpen(team("ready", "hibernated"))).toBe(true);
    expect(wakesOnOpen(team("ready", "ready"))).toBe(false);
    expect(wakesOnOpen(team("waking", "provisioning"))).toBe(false);
    expect(wakesOnOpen(team("hibernated", "planned"))).toBe(false);
    expect(wakesOnOpen(team("hibernated", "failed"))).toBe(false);
    expect(wakesOnOpen(team())).toBe(false);
    expect(wakesOnOpen(null)).toBe(false);
    // Well inside the shortest idle window PerkOS gives a desk agent.
    expect(KEEP_AWAKE_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});

describe("/api/desks/team", () => {
  const req = (method: string, query = "", body?: unknown) =>
    new Request(`http://127.0.0.1:3100/api/desks/team${query}`, {
      method,
      headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const instance = { templateId: "eqlty-desk", status: "hibernated", agents: [{ role: "scout", name: "eqlty-scout-1", state: "hibernated" }] };

  beforeEach(async () => {
    process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
    await writeFile(
      join(process.env.PERKOS_HOME, "session.json"),
      JSON.stringify({ wallet: "0xabc", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PERKOS_HOME;
  });

  it("reads the team, and wakes it only on POST", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) =>
      Response.json({ ...instance, status: url.endsWith("/instantiate") && init?.method === "POST" ? "waking" : "hibernated" }),
    );
    vi.stubGlobal("fetch", http);
    expect((await (await GET(req("GET", "?desk=eqlty-desk"))).json()).team.status).toBe("hibernated");
    expect((await (await POST(req("POST", "", { desk: "eqlty-desk" }))).json()).team.status).toBe("waking");
    expect(http.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api.perkos.xyz/project-templates/eqlty-desk/instance",
      "https://api.perkos.xyz/project-templates/eqlty-desk/instantiate",
    ]);
  });

  it("tells PerkOS the awake agents are in use on PUT, and wakes nothing", async () => {
    const team = {
      templateId: "eqlty-desk",
      status: "partial",
      agents: [
        { role: "scout", name: "eqlty-scout-1", agentId: "id-scout", state: "ready" },
        { role: "risk", name: "eqlty-risk-1", agentId: "id-risk", state: "hibernated" },
        { role: "trader", name: "eqlty-trader-1", state: "ready" },
        { role: "auditor", name: "eqlty-auditor-1", agentId: "id-auditor", state: "ready" },
      ],
    };
    const http = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith("/instance") ? Response.json(team) : Response.json({ ok: true })));
    vi.stubGlobal("fetch", http);
    expect(await (await PUT(req("PUT", "", { desk: "eqlty-desk" }))).json()).toEqual({ touched: 2 });
    // The touches go out together, so they can land in either order.
    expect(http.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${String(c[0])}`).sort()).toEqual([
      "GET https://api.perkos.xyz/project-templates/eqlty-desk/instance",
      "POST https://api.perkos.xyz/agents/id-auditor/activity",
      "POST https://api.perkos.xyz/agents/id-scout/activity",
    ]);
    expect((await PUT(req("PUT", "", { desk: "Bad Desk" }))).status).toBe(400);
  });

  it("passes PerkOS's 402 on, and asks which desk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "no desk time", code: "PAYMENT_REQUIRED" } }, { status: 402 })));
    expect((await POST(req("POST", "", { desk: "eqlty-desk" }))).status).toBe(402);
    expect((await GET(req("GET", "?desk=Bad Desk"))).status).toBe(400);
  });
});

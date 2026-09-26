/**
 * POST /api/desks/turn against a fake PerkOS: the frames the window gets, when
 * the team is woken, how each refusal ends the turn, and what is kept.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PerkosApiError } from "@perkos/client";
import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as TURN } from "../app/api/desks/turn/route";
import { GET as TURNS } from "../app/api/desks/turns/route";
import { DELETE as VAULT_OFF, POST as VAULT_ON } from "../app/api/vault/route";
import { sessions } from "../app/lib/session";
import type { TurnEvent } from "../app/lib/turnRecord";
import { clearSessionTurns, liveTurn } from "../app/lib/turnStore";

const account = privateKeyToAccount(generatePrivateKey());
const WALLET = account.address.toLowerCase();
const ROLES = ["scout", "risk", "trader", "auditor"];
const prompts = {
  scout: 'As Scout: read the facts. Open with "@Trader @Auditor". Under 70 words.',
  risk: 'As Risk: a first line "RISK: low", "RISK: medium" or "RISK: high". Under 50 words.',
  trader: 'As Trader (open with "@Sparky"): the entry plan. Under 60 words.',
  auditor: 'As Auditor (open with "@Sparky"): the record. Under 80 words.',
};
const manifest = {
  ok: true,
  module: "stocks-robinhood",
  tagline: "Tokenized stocks on Robinhood Chain",
  starters: [{ text: "How is NVDA doing today?", tag: "Price and recent range" }],
  screens: ["market", "trader"],
  rules: "This desk trades tokenized stocks on Robinhood Chain, priced in USDG. An order is at most 100 USDG.",
  turns: { analyze: prompts, advise: prompts },
};
const market = {
  ok: true,
  module: "stocks-robinhood",
  chain: "robinhood",
  chainId: 4663,
  quoteSymbol: "USDG",
  observedAt: "2026-09-26T14:30:00.000Z",
  assets: [
    { ticker: "NVDA", name: "NVIDIA", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18, priceUsd: 181.2, priceAt: "2026-09-26T14:30:00.000Z", change24hPct: 1.2, volume24hUsd: 2_000_000, tradeable: true, logoUrl: null },
    { ticker: "AAPL", name: "Apple", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eed", decimals: 18, priceUsd: 341.67, priceAt: "2026-09-26T14:30:00.000Z", change24hPct: -0.4, volume24hUsd: 1_000_000, tradeable: true, logoUrl: null },
  ],
};
const replies: Record<string, string> = {
  scout: "@Trader @Auditor NVDA is up 1.2% in 24h [F1].",
  risk: "RISK: medium\n@Trader @Auditor Keep it to 50 USDG.",
  trader: "@Sparky Entry: 50 USDG, take profit at 190 USDG.",
  auditor: "@Sparky Thesis: NVDA holds its range [F1]. Check the next close.",
  quote: "@Trader @Risk 50 USDG buys 0.2741 NVDA on Uniswap [F3], price impact 0.12%.",
};

type State = "ready" | "hibernated" | "waking" | "planned" | "provisioning" | "failed";
interface Fake {
  states: Record<string, State>;
  /** Agents the desk's template seats beside the turn's roles. */
  specialists?: Record<string, State>;
  status: string;
  wake?: () => Response;
  task?: (role: string, prompt: string, signal: AbortSignal | undefined) => Promise<Response> | Response;
  marketDown?: boolean;
  /** The desk answers Uniswap quotes. */
  quotes?: boolean;
  manifest?: unknown;
}
let fake: Fake;
let calls: Array<{ method: string; path: string; body?: unknown }> = [];

const teamBody = () => ({
  templateId: "eqlty-desk",
  status: fake.status,
  agents: [
    ...ROLES.map((role) => ({ role, name: `eqlty-${role}-1234abcd`, state: fake.states[role] ?? "ready", ...(fake.states[role] === "planned" ? {} : { agentId: `id-${role}` }) })),
    ...Object.entries(fake.specialists ?? {}).map(([role, state]) => ({ role, name: `eqlty-${role}-1234abcd`, state, ...(state === "planned" ? {} : { agentId: `id-${role}` }) })),
  ],
});

async function perkos(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path: u.pathname, ...(body === undefined ? {} : { body }) });
  const p = u.pathname;
  if (p === "/project-templates") {
    return Response.json({ templates: [{ id: "eqlty-desk", kind: "fleet", module: "stocks-robinhood", name: { en: "EQLTY Desk" }, description: { en: "Stocks" } }] });
  }
  if (p === "/desks/stocks-robinhood/manifest") return Response.json(fake.manifest ?? manifest);
  if (p === "/desks/stocks-robinhood/quote" && fake.quotes) {
    const ticker = u.searchParams.get("ticker") ?? "";
    return Response.json({
      quote: {
        chainId: 4663,
        ticker,
        tokenIn: { symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 },
        tokenOut: { symbol: ticker, address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
        amountIn: String(Number(u.searchParams.get("amountUsdg")) * 1e6),
        amountOut: "274100000000000000",
        priceImpactPct: 0.12,
        routing: "CLASSIC",
        protocols: ["V4"],
        requestId: "req-abcdef123456",
        quotedAt: "2026-09-26T14:30:00.000Z",
        gasFeeUsd: 0.01,
      },
    });
  }
  if (p === "/desks/stocks-robinhood/market") return fake.marketDown ? Response.json({ error: { message: "down" } }, { status: 502 }) : Response.json(market);
  if (p === "/desks/stocks-robinhood/series") return Response.json({ series: [] });
  if (p === "/project-templates/eqlty-desk/instance") return Response.json(teamBody());
  if (p === "/project-templates/eqlty-desk/instantiate") {
    if (fake.wake) return fake.wake();
    for (const r of ROLES) if (fake.states[r] === "hibernated") fake.states[r] = "ready";
    // Like PerkOS, waking also sets up every agent of the template that does not exist yet.
    for (const [r, state] of Object.entries(fake.specialists ?? {})) if (state === "hibernated" || state === "planned") fake.specialists![r] = "ready";
    fake.status = "ready";
    return Response.json(teamBody());
  }
  const task = p.match(/^\/agents\/id-(\w+)\/task$/);
  if (task) {
    const role = task[1]!;
    if (fake.task) return fake.task(role, body.prompt, init?.signal ?? undefined);
    return Response.json({ ok: true, reply: replies[role], detail: "reply len=10", agentId: `id-${role}`, agentName: `eqlty-${role}-1234abcd` });
  }
  if (/^\/agents\/id-\w+\/activity$/.test(p)) return new Response(null, { status: 204 });
  return Response.json({ error: { message: "not found", code: "NOT_FOUND" } }, { status: 404 });
}

const post = (body: unknown, host = "127.0.0.1:3100") =>
  TURN(new Request("http://127.0.0.1:3100/api/desks/turn", { method: "POST", headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) }));
const frames = (text: string): TurnEvent[] =>
  text
    .split("\n\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => JSON.parse(f.replace(/^data: /, "")) as TurnEvent);
const turn = async (body: unknown = { desk: "eqlty-desk", text: "How is NVDA doing today?", kind: "analyze" }) => {
  const res = await post(body);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  return frames(await res.text());
};
const tasks = () => calls.filter((c) => c.path.endsWith("/task"));
const kept = async (id: string) => (await (await TURNS(new Request(`http://127.0.0.1:3100/api/desks/turns?id=${id}`, { headers: { host: "127.0.0.1:3100" } }))).json()).turn;

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  process.env.PERKOS_DEVICE_SECRET = "cd".repeat(32);
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet: WALLET, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
  fake = { states: {}, status: "ready" };
  calls = [];
  vi.stubGlobal("fetch", vi.fn(perkos));
});
afterEach(async () => {
  await VAULT_OFF(new Request("http://127.0.0.1:3100/api/vault", { method: "DELETE", headers: { host: "127.0.0.1:3100" } }));
  vi.unstubAllGlobals();
  clearSessionTurns();
  delete process.env.PERKOS_HOME;
  delete process.env.PERKOS_DEVICE_SECRET;
  await rm(home, { recursive: true, force: true });
});

describe("POST /api/desks/turn: refusals before the turn starts", () => {
  it("refuses outside callers, bad input, a signed-out app and a kind the desk does not run", async () => {
    expect((await post({ desk: "eqlty-desk", text: "x", kind: "analyze" }, "evil.example")).status).toBe(403);
    expect((await post({ desk: "Bad Desk", text: "x", kind: "analyze" })).status).toBe(400);
    expect((await post({ desk: "eqlty-desk", text: "", kind: "analyze" })).status).toBe(400);
    expect((await post({ desk: "eqlty-desk", text: "x".repeat(2_001), kind: "analyze" })).status).toBe(400);
    expect(await (await post({ desk: "eqlty-desk", text: "x", kind: "launch" })).json()).toMatchObject({ error: "kind" });
    expect((await post({ desk: "eqlty-desk", text: "x", kind: "analyze", tickers: ["NVDA", "../x"] })).status).toBe(400);
    const order = await post({ desk: "eqlty-desk", text: "Buy $50 of NVDA", kind: "order" });
    expect(order.status).toBe(404);
    expect(await order.json()).toEqual({ error: "no_turn", message: "This desk does not run that kind of turn." });
    await rm(join(home, "session.json"));
    expect((await post({ desk: "eqlty-desk", text: "x", kind: "analyze" })).status).toBe(401);
    expect(tasks()).toEqual([]);
  });
});

describe("POST /api/desks/turn: a sign-in that cannot be renewed", () => {
  it("answers JSON, 502 when PerkOS does not answer and 401 when it refuses, and starts nothing", async () => {
    for (const [err, status, error] of [
      [new PerkosApiError("PerkOS did not answer", 0, "UNREACHABLE"), 502, "perkos_unreachable"],
      [new TypeError("fetch failed"), 502, "perkos_unreachable"],
      [new PerkosApiError("Refresh token expired", 401, "PERKOS_SESSION"), 401, "signed_out"],
    ] as const) {
      const real = sessions.current.bind(sessions);
      let reads = 0;
      // The first read (who is signed in) works; the renewal after it fails.
      const spy = vi.spyOn(sessions, "current").mockImplementation(async () => {
        reads += 1;
        if (reads === 1) return real();
        throw err;
      });
      const res = await post({ desk: "eqlty-desk", text: "How is NVDA doing today?", kind: "analyze" });
      spy.mockRestore();
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toMatchObject({ error });
      expect(liveTurn(WALLET, "eqlty-desk")).toBeNull();
    }
    expect(tasks()).toEqual([]);
  });
});

describe("POST /api/desks/turn: a turn", () => {
  it("streams the turn in order with the team awake, and wakes nothing", async () => {
    const events = await turn();
    const core = events.filter((e) => ["open", "start", "reply", "done"].includes(e.step)).map((e) => ("role" in e ? `${e.step}:${e.role}` : e.step));
    // Within a phase the two answers arrive in whichever order the agents finish.
    const inPhase = (list: string[]) => [...list].sort();
    expect([core[0], core.slice(1, 3), inPhase(core.slice(3, 5)), core.slice(5, 7), inPhase(core.slice(7, 9)), core[9]]).toEqual([
      "open",
      ["start:scout", "start:risk"],
      ["reply:risk", "reply:scout"],
      ["start:trader", "start:auditor"],
      ["reply:auditor", "reply:trader"],
      "done",
    ]);
    expect(events[0]).toMatchObject({
      step: "open",
      kind: "analyze",
      desk: "eqlty-desk",
      principal: "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG, +1.20% in 24h.",
      roles: ROLES,
    });
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    expect(open.facts[0]).toMatch(/^\[F1\] NVDA \(NVIDIA\): 181\.20 USDG/);
    expect(events.some((e) => e.step === "wake")).toBe(false);
    expect(calls.some((c) => c.path.endsWith("/instantiate"))).toBe(false);
    expect(calls.some((c) => /orders|prepare|execute/.test(c.path))).toBe(false);

    const taskOf = (role: string) => tasks().find((c) => c.path === `/agents/id-${role}/task`);
    const scout = taskOf("scout");
    const trader = taskOf("trader");
    expect(scout?.body).toMatchObject({ timeoutMs: 85_000 });
    const first = (scout?.body as { prompt: string }).prompt;
    expect(first).toContain('Request to the desk: "How is NVDA doing today?".');
    expect(first).toContain(`Desk rules: ${manifest.rules}`);
    expect(first).toContain("[F1] NVDA (NVIDIA)");
    expect(first).not.toContain("Scout said");
    expect((trader?.body as { prompt: string }).prompt).toContain('Scout said: "@Trader @Auditor NVDA is up 1.2% in 24h [F1]."');
    // Keeping each agent awake is fire and forget: it may land just after the stream ends.
    await vi.waitFor(() => expect(calls.filter((c) => c.path.endsWith("/activity"))).toHaveLength(4));

    const done = events.at(-1) as Extract<TurnEvent, { step: "done" }>;
    expect(done).toMatchObject({ kept: "session", flags: [], riskLevel: "medium" });
    const steps = events.filter((e) => e.step === "working").map((e) => (e as { text: string }).text);
    expect(steps.slice(0, 3)).toEqual(["Reading the market", "Read 1 fact from the market", "Checking the team"]);
    expect(steps).toContain("Checking the answers");

    const record = await kept(open.turnId);
    expect(record).toMatchObject({ id: open.turnId, kind: "analyze", riskLevel: "medium", question: "How is NVDA doing today?" });
    expect(record.replies.map((r: { role: string; ok: boolean }) => [r.role, r.ok])).toEqual(ROLES.map((r) => [r, true]));
    expect(record.trace.map((s: { text: string }) => s.text)).toEqual(steps);
    expect(liveTurn(WALLET, "eqlty-desk")).toBeNull();
  });

  it("puts the desk's candidates in front of the team for an open question", async () => {
    const events = await turn({ desk: "eqlty-desk", text: "What should I buy this month?", kind: "advise" });
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    expect(open.facts.map((f) => f.slice(0, 9))).toEqual(["[F1] NVDA", "[F2] AAPL"]);
  });

  it("wakes a sleeping team first, and says so before it asks anyone", async () => {
    fake.states = { scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" };
    fake.status = "hibernated";
    const events = await turn();
    const firstWake = events.findIndex((e) => e.step === "wake");
    const firstStart = events.findIndex((e) => e.step === "start");
    expect(firstWake).toBeGreaterThan(0);
    expect(firstWake).toBeLessThan(firstStart);
    expect(events[firstWake]).toMatchObject({ waiting: ROLES, woke: false });
    expect(calls.filter((c) => c.path.endsWith("/instantiate"))).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ step: "done", flags: [] });
  });

  it("ends the turn with NO_DESK_TIME when PerkOS refuses to wake the team, and keeps why", async () => {
    fake.states = { scout: "hibernated" };
    fake.wake = () => Response.json({ error: { message: "Payment is required", code: "INFRA_PAYMENT_REQUIRED" } }, { status: 402 });
    const events = await turn();
    expect(events.find((e) => e.step === "error")).toEqual({ step: "error", code: "NO_DESK_TIME", message: "Add desk time to run the team." });
    expect(tasks()).toEqual([]);
    const done = events.at(-1) as Extract<TurnEvent, { step: "done" }>;
    expect(done).toMatchObject({ step: "done", error: "NO_DESK_TIME" });
    expect(done.replies.every((r) => r.failure === "no_time" && r.ms === 0)).toBe(true);
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    expect((await kept(open.turnId)).error).toEqual({ code: "NO_DESK_TIME", message: "Add desk time to run the team." });
  });

  it("names admin approval apart from desk time", async () => {
    fake.states = { scout: "hibernated" };
    fake.wake = () => Response.json({ error: { message: "Requires administrator approval", code: "INFRA_APPROVAL_REQUIRED" } }, { status: 403 });
    const events = await turn();
    expect(events.find((e) => e.step === "error")).toMatchObject({ code: "INFRA_APPROVAL_REQUIRED" });
  });

  it("never sets up a team from a turn", async () => {
    fake.states = { scout: "planned", risk: "planned", trader: "planned", auditor: "planned" };
    fake.status = "none";
    const events = await turn();
    expect(events.find((e) => e.step === "error")).toMatchObject({ code: "TEAM_NOT_SET_UP" });
    expect(calls.some((c) => c.path.endsWith("/instantiate"))).toBe(false);
    expect(tasks()).toEqual([]);
  });

  it("never sets up the specialists a desk seats beside the turn's roles", async () => {
    fake.states = { scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" };
    fake.specialists = { hooks: "planned", quote: "planned", treasury: "planned" };
    fake.status = "partial";
    const events = await turn();
    expect(calls.some((c) => c.path.endsWith("/instantiate"))).toBe(false);
    expect(fake.specialists).toEqual({ hooks: "planned", quote: "planned", treasury: "planned" });
    expect(events.find((e) => e.step === "error")).toMatchObject({ code: "TEAM_NOT_SET_UP", message: expect.stringContaining("Part of the desk's team") });
    const done = events.at(-1) as Extract<TurnEvent, { step: "done" }>;
    expect(done.replies.map((r) => [r.role, r.failure])).toEqual(ROLES.map((r) => [r, "offline"]));
    expect(tasks()).toEqual([]);
  });

  it("sends a failure event for every role when the team as a whole cannot take part, and names the button to press", async () => {
    fake.states = { scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" };
    fake.specialists = { hooks: "planned", quote: "planned", treasury: "planned" };
    fake.status = "hibernated";
    const events = await turn();
    const failures = events.filter((e): e is Extract<TurnEvent, { step: "failure" }> => e.step === "failure");
    expect(failures.map((f) => [f.role, f.failure])).toEqual(ROLES.map((r) => [r, "offline"]));
    expect(failures.every((f) => f.label.length > 0)).toBe(true);
    expect(events.find((e) => e.step === "error")).toMatchObject({ message: expect.stringContaining("Press Wake team to create them") });

    fake = { states: { scout: "planned", risk: "planned", trader: "planned", auditor: "planned" }, status: "none" };
    const none = await turn();
    expect(none.filter((e) => e.step === "failure").map((e) => ("failure" in e ? e.failure : null))).toEqual(ROLES.map(() => "not_set_up"));
    expect(none.find((e) => e.step === "error")).toMatchObject({ message: expect.stringContaining("Set up the team") });
  });

  it("runs with the turn's roles awake while the specialists are not set up, and wakes nothing", async () => {
    fake.specialists = { hooks: "planned", quote: "planned", treasury: "planned" };
    fake.status = "partial";
    const events = await turn();
    expect(calls.some((c) => c.path.endsWith("/instantiate"))).toBe(false);
    expect(tasks().map((c) => c.path).sort()).toEqual(ROLES.map((r) => `/agents/id-${r}/task`).sort());
    expect((events.at(-1) as Extract<TurnEvent, { step: "done" }>).replies.every((r) => r.ok)).toBe(true);
  });

  it("wakes a whole seven-agent team that is set up and asleep, and asks only the turn's roles", async () => {
    fake.states = { scout: "hibernated", risk: "hibernated", trader: "hibernated", auditor: "hibernated" };
    fake.specialists = { hooks: "hibernated", quote: "hibernated", treasury: "hibernated" };
    fake.status = "hibernated";
    const events = await turn();
    expect(calls.filter((c) => c.path.endsWith("/instantiate"))).toHaveLength(1);
    expect(tasks()).toHaveLength(4);
    expect((events.at(-1) as Extract<TurnEvent, { step: "done" }>).replies.every((r) => r.ok)).toBe(true);
  });

  it("says the team failed to start, not that it is asleep, when every role failed", async () => {
    fake.states = { scout: "failed", risk: "failed", trader: "failed", auditor: "failed" };
    fake.status = "partial";
    const events = await turn();
    expect(calls.some((c) => c.path.endsWith("/instantiate"))).toBe(false);
    expect(events.find((e) => e.step === "error")).toMatchObject({ code: "TEAM_FAILED", message: expect.stringContaining("failed to start") });
    const done = events.at(-1) as Extract<TurnEvent, { step: "done" }>;
    expect(new Set(done.replies.map((r) => r.failure))).toEqual(new Set(["start_failed"]));
    expect(done.error).toBe("TEAM_FAILED");
  });

  it("stops before it opens when the desk's market does not answer", async () => {
    fake.marketDown = true;
    const events = await turn();
    expect(events).toEqual([{ step: "error", code: "DESK_MARKET", message: expect.stringContaining("market did not answer") }]);
    expect(liveTurn(WALLET, "eqlty-desk")).toBeNull();
  });

  it("gives the team Uniswap's price at the turn's size, and asks Quote in the first phase when the desk gives it a prompt", async () => {
    fake.quotes = true;
    fake.specialists = { quote: "ready" };
    fake.manifest = { ...manifest, turns: { analyze: { ...prompts, quote: 'As Quote: read the Uniswap facts. Open with "@Trader @Risk".' }, advise: prompts } };
    const events = await turn({ desk: "eqlty-desk", text: "How much NVDA do 50 USDG buy?", kind: "analyze" });
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    expect(open.facts.at(-1)).toMatch(/^\[F\d\] Uniswap now: 50\.00 USDG buys 0\.2741 NVDA \(182\.42 USDG each\), price impact 0\.12%, V4 route, request req-abcd\.$/);
    expect(open.roles).toEqual(["scout", "risk", "quote", "trader", "auditor"]);
    expect(calls.some((c) => c.path === "/desks/stocks-robinhood/quote")).toBe(true);
    const asked = tasks().map((c) => c.path);
    expect(asked.slice(0, 3).sort()).toEqual(["/agents/id-quote/task", "/agents/id-risk/task", "/agents/id-scout/task"]);
    const trader = (tasks().find((c) => c.path === "/agents/id-trader/task")?.body as { prompt: string }).prompt;
    expect(trader).toContain("Quote said:");
    expect(events.at(-1)).toMatchObject({ step: "done" });
  });

  it("leaves the Uniswap price out, and Quote with no prompt out of the turn, when the desk does not give them", async () => {
    fake.specialists = { quote: "ready" };
    const events = await turn();
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    expect(open.facts.some((f) => f.includes("Uniswap now"))).toBe(false);
    expect(open.roles).toEqual(["scout", "risk", "trader", "auditor"]);
    expect(tasks().some((c) => c.path === "/agents/id-quote/task")).toBe(false);
  });

  it("records a runtime failure sent as a reply as no answer, with the runtime's words", async () => {
    fake.task = (role) => {
      if (role === "auditor") return Response.json({ ok: true, reply: "API call failed after 3 retries: HTTP 502: upstream_failed", detail: "reply len=58", agentId: "id-auditor" });
      if (role === "trader") return Response.json({ error: { message: "Agent is not ready", code: "AGENT_NOT_READY" } }, { status: 409 });
      return Response.json({ ok: true, reply: replies[role], agentId: `id-${role}` });
    };
    const events = await turn();
    expect(events.find((e) => e.step === "reply" && e.role === "auditor")).toMatchObject({
      ok: false,
      failure: "model",
      detail: "API call failed after 3 retries: HTTP 502: upstream_failed",
    });
    expect(events).toContainEqual({ step: "failure", role: "trader", phase: 2, failure: "offline", label: "asleep", detail: "Agent is not ready" });
    expect((events.at(-1) as Extract<TurnEvent, { step: "done" }>).flags).toEqual(["trader:no-answer", "auditor:no-answer"]);
  });

  it("answers 409 to a second turn on the desk while one is live", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    fake.task = async (role) => {
      await held;
      return Response.json({ ok: true, reply: replies[role], agentId: `id-${role}` });
    };
    const first = await post({ desk: "eqlty-desk", text: "How is NVDA doing today?", kind: "analyze" });
    const second = await post({ desk: "eqlty-desk", text: "And Apple?", kind: "analyze" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "turn_live", message: "The team is still on the last question." });
    release();
    expect(frames(await first.text()).at(-1)).toMatchObject({ step: "done" });
    const third = await post({ desk: "eqlty-desk", text: "And Apple?", kind: "analyze" });
    expect(third.status).toBe(200);
    // Read it to the end, so its Trader and Auditor are not asked during the next test.
    expect(frames(await third.text()).at(-1)).toMatchObject({ step: "done" });
  });

  it("stops waiting when the window closes the stream, and keeps the turn as stopped", async () => {
    fake.task = (role, _prompt, signal) =>
      role === "scout"
        ? Response.json({ ok: true, reply: replies.scout, agentId: "id-scout" })
        : new Promise<Response>((_resolve, reject) => {
            if (signal?.aborted) reject(new DOMException("aborted", "AbortError"));
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
    const res = await post({ desk: "eqlty-desk", text: "How is NVDA doing today?", kind: "analyze" });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"step":"reply","role":"scout"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const open = frames(text)[0] as Extract<TurnEvent, { step: "open" }>;
    await reader.cancel();
    await vi.waitFor(() => expect(liveTurn(WALLET, "eqlty-desk")).toBeNull(), { timeout: 5_000 });
    const record = await kept(open.turnId);
    expect(record.stopped).toBe(true);
    const risk = record.replies.find((r: { role: string }) => r.role === "risk");
    expect(risk).toMatchObject({ ok: false, failure: "stopped" });
    expect(risk.detail).toContain("may still finish the task on PerkOS");
    expect(record.replies.find((r: { role: string }) => r.role === "trader")).toMatchObject({ failure: "stopped", ms: 0 });
    expect(tasks().map((c) => c.path).sort()).toEqual(["/agents/id-risk/task", "/agents/id-scout/task"]);
  });

  it("keeps the turn sealed in the vault when memory is on, and gives the team only desk memory", async () => {
    const signature = await account.signMessage({ message: vaultKeyMessage(WALLET) });
    await VAULT_ON(new Request("http://127.0.0.1:3100/api/vault", { method: "POST", headers: { host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ signature }) }));
    const events = await turn();
    expect(events.at(-1)).toMatchObject({ step: "done", kept: "vault" });
    const open = events[0] as Extract<TurnEvent, { step: "open" }>;
    clearSessionTurns();
    expect((await kept(open.turnId))?.id).toBe(open.turnId);

    const again = await turn({ desk: "eqlty-desk", text: "Is NVDA still steady?", kind: "analyze" });
    expect(again.at(-1)).toMatchObject({ kept: "vault" });
    const prompt = (tasks().filter((c) => c.path === "/agents/id-scout/task").at(-1)?.body as { prompt: string }).prompt;
    expect(prompt).toContain("Desk memory: Earlier desk turns:");
  });
});

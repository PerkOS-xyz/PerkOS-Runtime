/**
 * The team's part in a token launch: the facts a drafted launch gives it,
 * Risk's verdict, the checks on the answers, and the turn end to end against
 * a fake PerkOS. The launch facts name the person's wallets by what they are,
 * never by address.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as TURN } from "../app/api/desks/turn/route";
import type { DraftAnswer } from "../app/lib/launchDraft";
import { launchFactLines, launchFactsOf, launchQuestion, readLaunchFacts, type LaunchTurnFacts } from "../app/lib/launchTurn";
import { runTurn } from "../app/lib/turnEngine";
import { lintTurn } from "../app/lib/turnLint";
import type { TurnEvent } from "../app/lib/turnRecord";
import { clearSessionTurns } from "../app/lib/turnStore";
import { BANKR_WALLET, NVDA, POOL, TOKEN, WALLET } from "./bankrFixtures";

const ANSWER: DraftAnswer = {
  draft: {
    name: "Night Owl",
    symbol: "OWL",
    pair: { address: NVDA, symbol: "NVDA", name: "NVIDIA", kind: "stock", deployField: "pairedStockAddress", illiquid: false, ready: true },
    feesTo: "wallet",
    feeRecipient: WALLET,
    description: "",
    image: "",
    vesting: true,
    quoteOnlyFees: false,
  },
  checks: [
    { id: "pair", label: "Pair", ok: true, note: "NVDA · NVIDIA, a tokenized stock" },
    { id: "fees", label: "Fees pay to", ok: true, note: "your wallet 0x6732…25b4 · 95% of the pool fee" },
    { id: "wallet", label: "Bankr wallet", ok: true, warn: true, note: "0x47bf…2af0 deploys the token and signs for it" },
  ],
  ready: true,
  preview: { tokenAddress: TOKEN, poolId: POOL, creator: { address: WALLET, bps: 9500 }, protocolBps: 500 },
  deployer: BANKR_WALLET,
  limits: { launches24h: 0, simulations24h: 1 },
};
const FACTS: LaunchTurnFacts = launchFactsOf(ANSWER);

describe("a drafted launch as facts", () => {
  it("says what is on the table, the fee split from Bankr's simulation, the supply and the first minutes", () => {
    const lines = launchFactLines(FACTS);
    expect(lines[0]).toBe(
      'Launch on the table: "Night Owl" (OWL), a new token on Robinhood Chain whose Uniswap v4 pool is quoted in NVDA (NVIDIA, a tokenized stock). Bankr deploys it through Doppler from the person\'s Bankr wallet, which signs and pays the gas; the person signs nothing on chain and holds to launch.',
    );
    expect(lines[1]).toBe(
      "Fee split: every swap pays a 0.7% pool fee, 95% of it to the fee recipient (the person's own wallet) and 5% to the protocol; Bankr's hook on the pool adds its own fees, 1.75% of volume in all. Fees are paid in both OWL and NVDA.",
    );
    expect(lines[2]).toContain("Vesting on: 15% goes to the fee recipient over one year after a 30-day cliff");
    expect(lines).toContain("Check passes with a caution, Bankr wallet: the Bankr wallet deploys the token and signs for it.");
    expect(lines).toContain("Check passes, Fees pay to: your wallet · 95% of the pool fee.");
    expect(lines[lines.length - 1]).toBe("Bankr's simulation passed: the token would be at 0x89b4…8ba3, pool id 0x5c15…a31e. Nothing was sent.");
    expect(lines.join("\n")).not.toMatch(/0x6732|0x47bf/);
  });

  it("says when fees come in the pair only, vesting is off, or the simulation failed", () => {
    const lines = launchFactLines({ ...FACTS, feesTo: "bankr", quoteOnlyFees: true, vesting: false, preview: null, simError: "Bankr's limit: too many simulations." });
    expect(lines[1]).toContain("(the person's Bankr wallet)");
    expect(lines[1]).toContain("Fees are paid in NVDA only.");
    expect(lines[2]).toBe("Supply: 100 billion OWL. Vesting off: all of it seeds the pool.");
    expect(lines[lines.length - 1]).toBe("Bankr's simulation failed: Bankr's limit: too many simulations.");
    expect(launchQuestion(FACTS)).toBe("Launch Night Owl (OWL) paired with NVDA on Robinhood Chain. Is it ready to go out?");
  });

  it("reads back only a launch it can trust the shape of", () => {
    expect(readLaunchFacts(JSON.parse(JSON.stringify(FACTS)))).toEqual(FACTS);
    expect(readLaunchFacts({ ...FACTS, feesTo: "someone" })).toBeNull();
    expect(readLaunchFacts({ ...FACTS, name: "x".repeat(101) })).toBeNull();
    expect(readLaunchFacts({ ...FACTS, checks: [{ label: "Pair", ok: "yes", note: "n" }] })).toBeNull();
    expect(readLaunchFacts({ ...FACTS, preview: { tokenAddress: "nope", poolId: POOL } })).toBeNull();
    expect(readLaunchFacts(null)).toBeNull();
  });
});

describe("the launch turn's answers", () => {
  it("takes Risk's verdict in a launch, as in an order", async () => {
    const events: TurnEvent[] = [];
    const ask = async (agentId: string) => ({ ok: true, reply: agentId === "id-risk" ? "VERDICT: BLOCK\n@Auditor The pair is thin." : "@Auditor read [F1].", agentId, agentName: agentId });
    const seats = Object.fromEntries(["scout", "risk", "auditor"].map((r) => [r, { role: r, ready: true, agentId: `id-${r}`, agentName: `id-${r}` }]));
    const out = await runTurn({
      kind: "launch",
      phases: [["scout", "risk"], ["auditor"]],
      seats,
      head: "facts",
      rolePrompts: { scout: "s", risk: "r", auditor: "a" },
      ask: ask as never,
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(out.verdict).toBe("BLOCK");
    expect(events.find((e) => e.step === "reply" && e.role === "risk")).toMatchObject({ verdict: "BLOCK" });
  });

  it("checks a launch for Risk's verdict and Scout's citations, and never for an order size", () => {
    const reply = (role: string, text: string) => ({ role, phase: 1 as const, ok: true, reply: text, ms: 1 });
    const flags = lintTurn({
      kind: "launch",
      replies: [reply("scout", "@Auditor NVDA draws attention. Deploy $5,000 of hype."), reply("risk", "RISK: low\n@Auditor fine"), reply("hooks", "The hook takes fees.")],
      given: "facts",
      rolePrompts: {},
      maxOrder: 100,
      quote: "USDG",
    });
    expect(flags).toEqual(["scout:no-citation", "risk:no-verdict"]);
  });
});

// The route, end to end, against a fake PerkOS.
const WALLET_ID = "0x" + "c".repeat(40);
const launchPrompts = {
  scout: 'As Scout: why the pair can draw attention, and the trap. Open with "@Auditor". Under 70 words.',
  risk: 'As Risk: first line "VERDICT: GO" or "VERDICT: BLOCK", then "@Auditor" and why. Under 60 words.',
  auditor: 'As Auditor (open with "@Sparky"): the launch record. Under 90 words.',
  hooks: "As Hooks: the Doppler hook on the pool. Under 60 words.",
  treasury: "As Treasury: the fee split. Under 60 words.",
};
const manifest = {
  ok: true,
  module: "stocks-robinhood",
  tagline: "Tokenized stocks on Robinhood Chain",
  starters: [],
  screens: ["market"],
  rules: "This desk trades tokenized stocks on Robinhood Chain, priced in USDG.",
  turns: { launch: launchPrompts },
};
const market = {
  ok: true,
  module: "stocks-robinhood",
  chain: "robinhood",
  chainId: 4663,
  quoteSymbol: "USDG",
  observedAt: "2026-09-26T14:30:00.000Z",
  assets: [
    { ticker: "NVDA", name: "NVIDIA", address: NVDA.toLowerCase(), decimals: 18, priceUsd: 181.2, priceAt: "2026-09-26T14:30:00.000Z", change24hPct: 1.2, volume24hUsd: 2_000_000, tradeable: true, logoUrl: null },
    { ticker: "AAPL", name: "Apple", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eed", decimals: 18, priceUsd: 341.67, priceAt: "2026-09-26T14:30:00.000Z", change24hPct: -0.4, volume24hUsd: 1_000_000, tradeable: true, logoUrl: null },
  ],
};
const ROLES = ["scout", "risk", "trader", "auditor", "quote", "hooks", "treasury"];
let marketDown = false;
let calls: Array<{ path: string; body?: { prompt?: string } }> = [];

async function perkos(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  const body = init?.body ? (JSON.parse(String(init.body)) as { prompt?: string }) : undefined;
  calls.push({ path: u.pathname, ...(body ? { body } : {}) });
  const p = u.pathname;
  if (p === "/project-templates") {
    return Response.json({ templates: [{ id: "eqlty-desk", kind: "fleet", module: "stocks-robinhood", name: { en: "EQLTY Desk" }, description: { en: "Stocks" } }] });
  }
  if (p === "/desks/stocks-robinhood/manifest") return Response.json(manifest);
  if (p === "/desks/stocks-robinhood/market") return marketDown ? Response.json({ error: { message: "down" } }, { status: 502 }) : Response.json(market);
  if (p === "/desks/stocks-robinhood/series") return Response.json({ series: [] });
  if (p === "/project-templates/eqlty-desk/instance") {
    return Response.json({ templateId: "eqlty-desk", status: "ready", agents: ROLES.map((role) => ({ role, name: `eqlty-${role}-1234abcd`, state: "ready", agentId: `id-${role}` })) });
  }
  const task = p.match(/^\/agents\/id-(\w+)\/task$/);
  if (task) {
    const role = task[1]!;
    const reply = role === "risk" ? "VERDICT: GO\n@Auditor The simulation passed [F3]." : role === "auditor" ? "@Sparky Launch record: OWL on NVDA [F2]." : `@Auditor ${role} read [F2].`;
    return Response.json({ ok: true, reply, agentId: `id-${role}`, agentName: `eqlty-${role}-1234abcd` });
  }
  if (/^\/agents\/id-\w+\/activity$/.test(p)) return new Response(null, { status: 204 });
  return Response.json({ error: { message: "not found", code: "NOT_FOUND" } }, { status: 404 });
}

const post = (body: unknown) =>
  TURN(new Request("http://127.0.0.1:3100/api/desks/turn", { method: "POST", headers: { host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify(body) }));
const frames = (text: string): TurnEvent[] =>
  text
    .split("\n\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => JSON.parse(f.replace(/^data: /, "")) as TurnEvent);

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet: WALLET_ID, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
  marketDown = false;
  calls = [];
  vi.stubGlobal("fetch", vi.fn(perkos));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearSessionTurns();
  delete process.env.PERKOS_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("POST /api/desks/turn: a launch", () => {
  it("needs the launch the person drafted", async () => {
    const res = await post({ desk: "eqlty-desk", text: launchQuestion(FACTS), kind: "launch" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "launch" });
    expect(calls.filter((c) => c.path.endsWith("/task"))).toEqual([]);
  });

  it("gives the team the pair's market line and the launch, Hooks and Treasury in the first phase, and keeps Risk's verdict", async () => {
    const res = await post({ desk: "eqlty-desk", text: launchQuestion(FACTS), kind: "launch", tickers: ["NVDA"], launch: FACTS });
    const events = frames(await res.text());
    const open = events.find((e) => e.step === "open");
    if (open?.step !== "open") throw new Error("no open");
    expect(open.kind).toBe("launch");
    expect(open.roles).toEqual(["scout", "risk", "hooks", "treasury", "auditor"]);
    expect(open.principal).toMatch(/^@Scout @Risk @Hooks @Treasury Launch Night Owl \(OWL\) paired with NVDA on Robinhood Chain\. Is it ready to go out\? Facts attached: NVDA 181\.20 USDG/);
    expect(open.principal).toContain("OWL / NVDA pool, Bankr's simulation passed");
    expect(open.facts[0]).toMatch(/^\[F1\] NVDA/);
    expect(open.facts.some((f) => f.includes("[F2] Launch on the table"))).toBe(true);
    expect(open.facts.some((f) => /AAPL/.test(f))).toBe(false);
    const phases = events.filter((e) => e.step === "phase");
    expect(phases.map((e) => (e.step === "phase" ? e.roles : []))).toEqual([["scout", "risk", "hooks", "treasury"], ["auditor"]]);
    const prompts = calls.filter((c) => c.path.endsWith("/task")).map((c) => c.body?.prompt ?? "");
    expect(prompts).toHaveLength(5);
    expect(prompts.every((p) => p.includes("Fee split: every swap pays a 0.7% pool fee"))).toBe(true);
    expect(prompts.join("\n")).not.toMatch(/0x6732|0x47bf/);
    // A launch buys nothing: Uniswap is never asked for a price.
    expect(calls.some((c) => c.path.endsWith("/quote"))).toBe(false);
    const done = events.find((e) => e.step === "done");
    expect(done).toMatchObject({ step: "done", verdict: "GO" });
    expect(done?.step === "done" ? done.flags : ["none"]).toEqual([]);
  });

  it("goes on without the market when the pair is WETH and the market does not answer", async () => {
    marketDown = true;
    const weth = { ...FACTS, pair: { symbol: "WETH", name: "Wrapped Ether", kind: "major", illiquid: null } };
    const events = frames(await (await post({ desk: "eqlty-desk", text: launchQuestion(weth), kind: "launch", launch: weth })).text());
    expect(events.some((e) => e.step === "error")).toBe(false);
    const open = events.find((e) => e.step === "open");
    expect(open?.step === "open" ? open.facts[0] : "").toMatch(/^\[F1\] Launch on the table/);
    expect(events.find((e) => e.step === "done")).toMatchObject({ verdict: "GO" });
  });
});

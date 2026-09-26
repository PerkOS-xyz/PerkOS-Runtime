/**
 * Drafting a launch: guarded, signed in and keyed before Bankr is asked
 * anything, checked against Bankr's rules, and simulated only once every
 * check passes. Bankr and the chain are mocked at the fetch boundary.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as DRAFT } from "../app/api/launch/draft/route";
import { GET as QUOTES_ROUTE } from "../app/api/launch/quotes/route";
import { bankrKey } from "../app/lib/bankrKey";
import { resetBankrCaches } from "../app/lib/bankrLaunch";
import { forgetPreview } from "../app/lib/launchGate";
import { BANKR_WALLET, KEY, NVDA, POOL, TOKEN, WALLET } from "./bankrFixtures";
import { bankr, deployCalls, get, HOST, post, signIn, stubWorld } from "./bankrWorld";

const DRAFT_BODY = { name: "Night Owl", symbol: "owl", pair: "NVDA", description: "For night traders" };

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  resetBankrCaches();
  stubWorld();
});

afterEach(async () => {
  await bankrKey.clear();
  forgetPreview(WALLET);
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("GET /api/launch/quotes", () => {
  it("lists Robinhood Chain pairs with the stocks first, without a key", async () => {
    const res = await QUOTES_ROUTE(get("/api/launch/quotes"));
    const body = (await res.json()) as { chain: string; pairs: Array<{ symbol: string }> };
    expect(body.chain).toBe("robinhood");
    expect(body.pairs.map((p) => p.symbol)).toEqual(["NVDA", "TSLA", "GLW", "WETH", "BNKR", "musebook"]);
  });

  it("says so when Bankr does not answer, and refuses another site", async () => {
    bankr.world.quotes = { quoteTokens: [] };
    expect((await QUOTES_ROUTE(get("/api/launch/quotes"))).status).toBe(502);
    const foreign = new Request("http://127.0.0.1:3100/api/launch/quotes", { headers: { ...HOST, "sec-fetch-site": "cross-site" } });
    expect((await QUOTES_ROUTE(foreign)).status).toBe(403);
  });
});

describe("POST /api/launch/draft", () => {
  it("needs a session, then a Bankr key, before it asks Bankr anything", async () => {
    expect((await DRAFT(post("/api/launch/draft", DRAFT_BODY))).status).toBe(401);
    await signIn();
    const res = await DRAFT(post("/api/launch/draft", DRAFT_BODY));
    expect(res.status).toBe(412);
    expect(await res.json()).toMatchObject({ error: "bankr_key", message: expect.stringContaining("Token Launch API") });
    expect(bankr.calls).toHaveLength(0);
  });

  it("asks for a name, a symbol and a pair it knows", async () => {
    await signIn();
    await bankrKey.save(KEY);
    expect((await DRAFT(post("/api/launch/draft", { ...DRAFT_BODY, name: "" }))).status).toBe(400);
    const unknown = await DRAFT(post("/api/launch/draft", { ...DRAFT_BODY, pair: "AAPL" }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "unknown_pair" });
  });

  it("simulates only once every check passes, with the key, on Robinhood Chain, paying fees to the signed-in wallet", async () => {
    await signIn();
    await bankrKey.save(KEY);
    const res = await DRAFT(post("/api/launch/draft", DRAFT_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean; preview: unknown; checks: Array<{ id: string; ok: boolean; note: string }>; draft: Record<string, unknown>; deployer: string; limits: Record<string, number> };
    expect(body.ready).toBe(true);
    expect(body.preview).toMatchObject({ tokenAddress: TOKEN, poolId: POOL });
    expect(body.draft).toMatchObject({ symbol: "OWL", feesTo: "wallet", feeRecipient: WALLET, vesting: true, quoteOnlyFees: false });
    expect(body.deployer).toBe(BANKR_WALLET);
    expect(body.limits).toEqual({ launches24h: 0, simulations24h: 1 });
    expect(body.checks.every((c) => c.ok)).toBe(true);
    expect(body.checks.find((c) => c.id === "simulations")?.note).toMatch(/^1 of 20 used/);
    expect(body.checks.find((c) => c.id === "gas")?.note).toMatch(/Bankr does not sponsor gas/);
    expect(deployCalls()).toEqual([
      {
        tokenName: "Night Owl",
        tokenSymbol: "OWL",
        description: "For night traders",
        chain: "robinhood",
        provider: "doppler",
        pairedStockAddress: NVDA,
        feeRecipient: { type: "wallet", value: WALLET },
        simulateOnly: true,
      },
    ]);
  });

  it("does not simulate while a check fails, and says what to send where", async () => {
    await signIn();
    await bankrKey.save(KEY);
    bankr.world.balance = "0x0";
    const body = (await (await DRAFT(post("/api/launch/draft", DRAFT_BODY))).json()) as { ready: boolean; preview: unknown; checks: Array<{ id: string; ok: boolean; note: string }>; limits: Record<string, number> };
    expect(body.ready).toBe(false);
    expect(body.preview).toBeNull();
    const gas = body.checks.find((c) => c.id === "gas");
    expect(gas).toMatchObject({ ok: false });
    expect(gas?.note).toContain("0x47bf…2af0");
    expect(body.limits.simulations24h).toBe(0);
    expect(deployCalls()).toHaveLength(0);
  });

  it("pays fees to the Bankr wallet when the person picks it", async () => {
    await signIn();
    await bankrKey.save(KEY);
    await DRAFT(post("/api/launch/draft", { ...DRAFT_BODY, feesTo: "bankr", vesting: false, quoteOnlyFees: true }));
    expect(deployCalls()[0]).toMatchObject({ feeRecipient: { type: "wallet", value: BANKR_WALLET }, disableVesting: true, quoteOnlyFees: true });
  });

  it("passes Bankr's refusal of the simulation on, in plain words", async () => {
    await signIn();
    await bankrKey.save(KEY);
    bankr.world.simulate = () => Response.json({ error: "Too many launch simulations in the last 24 hours." }, { status: 429, headers: { "retry-after": "1800" } });
    const body = (await (await DRAFT(post("/api/launch/draft", DRAFT_BODY))).json()) as { ready: boolean; simError: string };
    expect(body.ready).toBe(false);
    expect(body.simError).toContain("Bankr's limit: Too many launch simulations in the last 24 hours.");
    expect(body.simError).toContain("Try again in about 30 minutes.");
  });

  it("counts the wallet's launches of the last 24 hours from Bankr's list", async () => {
    await signIn();
    await bankrKey.save(KEY);
    const now = Date.now();
    bankr.world.launches = [0, 1, 2].map((i) => ({ tokenAddress: `0x${String(i).repeat(40)}`, tokenSymbol: "X", chain: "robinhood", deployer: { walletAddress: BANKR_WALLET }, timestamp: now - i * 3600_000 }));
    const body = (await (await DRAFT(post("/api/launch/draft", DRAFT_BODY))).json()) as { ready: boolean; checks: Array<{ id: string; ok: boolean }> };
    expect(body.checks.find((c) => c.id === "launches")?.ok).toBe(false);
    expect(body.ready).toBe(false);
    expect(deployCalls()).toHaveLength(0);
  });
});

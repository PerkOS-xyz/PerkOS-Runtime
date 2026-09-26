/**
 * Sending a launch: only exactly what was simulated in the last ten minutes,
 * with the pair, the gas and the day's launches checked again, one at a time,
 * and an answer that is not a clear yes or no never read as nothing sent.
 * Hosting its logo goes through PerkOS. Everything is mocked at the fetch
 * boundary.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as DEPLOY } from "../app/api/launch/deploy/route";
import { POST as DRAFT } from "../app/api/launch/draft/route";
import { POST as LOGO } from "../app/api/launch/logo/route";
import { bankrKey } from "../app/lib/bankrKey";
import { resetBankrCaches } from "../app/lib/bankrLaunch";
import { claimDeploy, forgetPreview, releaseDeploy } from "../app/lib/launchGate";
import { launchLog } from "../app/lib/launchLog";
import { BANKR_WALLET, KEY, NVDA, POOL, QUOTES, TOKEN, TX, WALLET } from "./bankrFixtures";
import { bankr, deployCalls, post, signIn, stubWorld } from "./bankrWorld";

const DRAFT_BODY = { name: "Night Owl", symbol: "owl", pair: "NVDA", description: "For night traders" };
const DEPLOY_BODY = { ...DRAFT_BODY, symbol: "OWL", pair: NVDA };

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  resetBankrCaches();
  stubWorld();
});

afterEach(async () => {
  await bankrKey.clear();
  forgetPreview(WALLET);
  releaseDeploy(WALLET);
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("POST /api/launch/deploy", () => {
  async function drafted(extra: Record<string, unknown> = {}) {
    await signIn();
    await bankrKey.save(KEY);
    const res = await DRAFT(post("/api/launch/draft", { ...DRAFT_BODY, ...extra }));
    expect(((await res.json()) as { ready: boolean }).ready).toBe(true);
    bankr.calls = [];
  }

  it("refuses a launch that was not checked, without asking Bankr to deploy", async () => {
    await signIn();
    await bankrKey.save(KEY);
    const res = await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_checked", sent: false });
    expect(deployCalls()).toHaveLength(0);
  });

  it("launches exactly what was simulated, answers the token, pool and links, and keeps it", async () => {
    await drafted();
    const res = await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY));
    expect(res.status).toBe(201);
    const { receipt } = (await res.json()) as { receipt: Record<string, unknown> };
    expect(receipt).toMatchObject({
      tokenAddress: TOKEN,
      poolId: POOL,
      txHash: TX,
      chain: "robinhood",
      pairedSymbol: "NVDA",
      feeRecipient: WALLET,
      deployer: BANKR_WALLET,
      links: {
        uniswap: `https://app.uniswap.org/explore/tokens/robinhood/${TOKEN}`,
        bankr: `https://bankr.bot/launches/${TOKEN}`,
        explorer: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
      },
    });
    expect(deployCalls()).toEqual([expect.objectContaining({ simulateOnly: false, pairedStockAddress: NVDA, tokenSymbol: "OWL" })]);
    // Bankr's registry is read again, not the cached one.
    expect(bankr.calls.some((c) => c.url.includes("quote-tokens"))).toBe(true);
    expect((await launchLog.launches(WALLET))[0]).toMatchObject({ tokenAddress: TOKEN, pairedSymbol: "NVDA" });
    expect(await launchLog.attempts(BANKR_WALLET)).toBe(1);
    // A second hold needs a new check.
    expect((await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY))).status).toBe(409);
  });

  it("refuses a launch that changed after its simulation", async () => {
    await drafted();
    const res = await DEPLOY(post("/api/launch/deploy", { ...DEPLOY_BODY, name: "Day Owl" }));
    expect(await res.json()).toMatchObject({ error: "not_checked" });
    expect(deployCalls()).toHaveLength(0);
  });

  it("checks the pair again with Bankr and sends nothing when it is gone", async () => {
    await drafted();
    bankr.world.quotes = { quoteTokens: (QUOTES.quoteTokens as Array<{ symbol: string }>).filter((t) => t.symbol !== "NVDA") };
    const res = await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "pair_gone", sent: false });
    expect(deployCalls()).toHaveLength(0);
  });

  it("sends nothing when the Bankr wallet ran out of gas since the check", async () => {
    await drafted();
    bankr.world.balance = "0x1";
    expect(await (await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY))).json()).toMatchObject({ error: "no_gas", sent: false });
    expect(deployCalls()).toHaveLength(0);
  });

  it("sends one launch at a time from this app", async () => {
    await drafted();
    expect(claimDeploy(WALLET)).toBe(true);
    expect(await (await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY))).json()).toMatchObject({ error: "in_flight", sent: false });
    expect(deployCalls()).toHaveLength(0);
  });

  it("passes a refusal on as nothing sent", async () => {
    await drafted();
    bankr.world.deploy = () => Response.json({ error: "TOKEN_LAUNCH_NOT_AVAILABLE", message: "Token launches are not available for this wallet right now" }, { status: 403 });
    const res = await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "TOKEN_LAUNCH_NOT_AVAILABLE", sent: false, message: expect.stringContaining("not available in some regions") });
    expect(await launchLog.attempts(BANKR_WALLET)).toBe(0);
  });

  it("never reads a launch without a clear answer as nothing sent", async () => {
    await drafted();
    bankr.world.deploy = () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    const res = await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: "unconfirmed", sent: null, deployer: BANKR_WALLET });
    expect(await launchLog.attempts(BANKR_WALLET)).toBe(1);
    expect((await DEPLOY(post("/api/launch/deploy", DEPLOY_BODY))).status).toBe(409);
  });
});

describe("POST /api/launch/logo", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("takes images only, under 2 MB, from a signed-in wallet", async () => {
    expect((await LOGO(post("/api/launch/logo", { data: "data:text/html;base64,PGh0bWw+" }))).status).toBe(400);
    expect((await LOGO(post("/api/launch/logo", { data: `data:image/png;base64,${"A".repeat(3_000_000)}` }))).status).toBe(413);
    expect((await LOGO(post("/api/launch/logo", { data: PNG }))).status).toBe(401);
  });

  it("hosts the logo on PerkOS and answers its https address", async () => {
    await signIn();
    const res = await LOGO(post("/api/launch/logo", { data: PNG }));
    expect(await res.json()).toEqual({ url: "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fx%2Flaunch-logo-1.png?alt=media" });
    expect(JSON.parse(String(bankr.calls[0]?.init?.body))).toEqual({ data: PNG });
  });
});

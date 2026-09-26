/**
 * GET /api/launches: the signed-in wallet's launches on Robinhood Chain, in
 * the shape a desk screen reads, from Bankr's recent list, the creator fees
 * of both wallets and the launches this app sent. Bankr is mocked.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/launches/route";
import { bankrKey } from "../app/lib/bankrKey";
import { resetBankrCaches } from "../app/lib/bankrLaunch";
import { launchLog } from "../app/lib/launchLog";
import { BANKR_WALLET, FEES, KEY, LAUNCH, NVDA, POOL, TOKEN, TX, WALLET } from "./bankrFixtures";
import { bankr, get, signIn, stubWorld } from "./bankrWorld";

const OLD = "0x" + "4".repeat(40);
const LOGGED = "0x" + "5".repeat(40);
const OLD_POOL = "0x" + "b".repeat(64);

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  resetBankrCaches();
  stubWorld();
});

afterEach(async () => {
  await bankrKey.clear();
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("GET /api/launches", () => {
  it("needs a session, and answers an empty list without a key, asking Bankr nothing", async () => {
    expect((await GET(get("/api/launches"))).status).toBe(401);
    await signIn();
    expect(await (await GET(get("/api/launches"))).json()).toEqual({ launches: [] });
    expect(bankr.calls).toHaveLength(0);
  });

  it("lists the wallet's launches on Robinhood Chain, newest first, with pair, pool, date, links and fees", async () => {
    await signIn();
    await bankrKey.save(KEY);
    bankr.world.launches = [
      LAUNCH,
      { ...LAUNCH, tokenAddress: "0x" + "2".repeat(40), chain: "base" },
      { ...LAUNCH, tokenAddress: "0x" + "3".repeat(40), feeRecipient: { walletAddress: "0x" + "9".repeat(40) }, deployer: { walletAddress: "0x" + "9".repeat(40) } },
    ];
    bankr.world.fees = {
      [WALLET]: { ...FEES, tokens: [...FEES.tokens, { ...FEES.tokens[0], tokenAddress: "0x" + "6".repeat(40), chain: "base" }] },
      [BANKR_WALLET]: {
        address: BANKR_WALLET,
        tokens: [
          {
            tokenAddress: OLD,
            name: "Old Owl",
            symbol: "OLD",
            poolId: OLD_POOL,
            token0Label: "WETH",
            token1Label: "OLD",
            claimable: { token0: "0.000000", token1: "0.000000" },
            claimed: { token0: "0.1", token1: "10", count: 2 },
            chain: "robinhood",
          },
        ],
      },
    };
    bankr.world.records = {
      [OLD]: { ...LAUNCH, tokenAddress: OLD, tokenName: "Old Owl", tokenSymbol: "OLD", poolId: OLD_POOL, pairedStock: null, timestamp: 1780000000000, unclaimedFees: null, feeRecipient: { walletAddress: BANKR_WALLET } },
    };
    await launchLog.record(WALLET, {
      tokenAddress: LOGGED,
      poolId: null,
      txHash: TX,
      name: "Fresh Owl",
      symbol: "FRESH",
      pairAddress: NVDA.toLowerCase(),
      pairedSymbol: "NVDA",
      feeRecipient: WALLET,
      deployer: BANKR_WALLET,
      deployedAt: "2026-09-27T01:00:00.000Z",
    });

    const { launches } = (await (await GET(get("/api/launches"))).json()) as { launches: Array<Record<string, unknown>> };
    expect(launches.map((l) => l.symbol)).toEqual(["FRESH", "d/acc", "OLD"]);
    expect(launches[1]).toEqual({
      tokenAddress: TOKEN,
      name: "Decentralized Accelerationism",
      symbol: "d/acc",
      poolId: POOL,
      pairedSymbol: "NVDA",
      deployedAt: new Date(LAUNCH.timestamp).toISOString(),
      links: {
        uniswap: `https://app.uniswap.org/explore/tokens/robinhood/${TOKEN}`,
        bankr: `https://bankr.bot/launches/${TOKEN}`,
        explorer: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
      },
      fees: { claimableUsd: LAUNCH.unclaimedFees.usdValue, claimedUsd: 0 },
      chain: "robinhood",
      pairAddress: NVDA.toLowerCase(),
      feeRecipient: WALLET,
      deployer: BANKR_WALLET,
      txHash: TX,
    });
    // Completed from Bankr's record: quoted in WETH, fees to the Bankr wallet, claimed twice so no USD figure for claims.
    expect(launches[2]).toMatchObject({ symbol: "OLD", pairedSymbol: "WETH", poolId: OLD_POOL, feeRecipient: BANKR_WALLET, fees: { claimableUsd: 0 } });
    expect((launches[2]!.fees as Record<string, unknown>).claimedUsd).toBeUndefined();
    // Kept by this app, not yet in Bankr's lists.
    expect(launches[0]).toMatchObject({ tokenAddress: LOGGED, pairedSymbol: "NVDA", deployedAt: "2026-09-27T01:00:00.000Z", txHash: TX });
    expect(launches[0]).not.toHaveProperty("fees");
  });

  it("still lists what pays the signed-in wallet when Bankr does not answer for the key", async () => {
    await signIn();
    await bankrKey.save("bk_usr_other_" + "x".repeat(30));
    bankr.world.launches = [LAUNCH];
    const { launches } = (await (await GET(get("/api/launches"))).json()) as { launches: Array<{ tokenAddress: string }> };
    expect(launches.map((l) => l.tokenAddress)).toEqual([TOKEN]);
  });
});

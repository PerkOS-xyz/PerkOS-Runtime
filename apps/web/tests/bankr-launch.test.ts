/**
 * Bankr's Token Launch API on Robinhood Chain: the pairs, the public reads,
 * the chain's gas and the body a simulation and a launch send. Bankr and the
 * chain are mocked with the shapes they answer; nothing here reaches them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chainGas,
  creatorFees,
  deployBody,
  deployLaunch,
  FALLBACK_GAS_WEI,
  gasNeed,
  launchedWithinDay,
  launchPairs,
  parseLaunch,
  parsePairs,
  recentLaunches,
  resetBankrCaches,
  resolvePair,
  simulateLaunch,
  type LaunchParams,
} from "../app/lib/bankrLaunch";
import { BANKR_WALLET, BNKR, FEES, KEY, LAUNCH, NVDA, POOL, QUOTES, TOKEN, TX, WALLET } from "./bankrFixtures";

beforeEach(() => resetBankrCaches());

describe("pairs on Robinhood Chain", () => {
  it("puts the stocks first in Bankr's order, then WETH, then the other quote tokens, and drops what a Doppler launch cannot take", () => {
    const pairs = parsePairs(QUOTES);
    expect(pairs.map((p) => p.symbol)).toEqual(["NVDA", "TSLA", "GLW", "WETH", "BNKR", "musebook"]);
    expect(pairs.find((p) => p.symbol === "WETH")).toMatchObject({ deployField: null, kind: "major", ready: true });
    expect(pairs.find((p) => p.symbol === "GLW")?.illiquid).toBe(true);
    expect(pairs.find((p) => p.symbol === "TSLA")?.illiquid).toBeNull();
    expect(pairs.find((p) => p.symbol === "musebook")?.ready).toBe(false);
  });

  it("reads them from Bankr without a key, and keeps them ten minutes", async () => {
    const http = vi.fn(async () => Response.json(QUOTES));
    await launchPairs({ http, now: 1_000 });
    await launchPairs({ http, now: 1_000 + 9 * 60_000 });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBeUndefined();
    await launchPairs({ http, now: 1_000, fresh: true });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when Bankr does not answer, so a route can say so", async () => {
    await expect(launchPairs({ http: async () => new Response("", { status: 503 }) })).rejects.toThrow();
  });

  it("finds a pair by ticker, dollar ticker, company, ether words or address, and nothing by a stray word", () => {
    const pairs = parsePairs(QUOTES);
    expect(resolvePair("NVDA", pairs)?.address).toBe(NVDA);
    expect(resolvePair("$nvda", pairs)?.address).toBe(NVDA);
    expect(resolvePair("nvidia", pairs)?.symbol).toBe("NVDA");
    expect(resolvePair("tes", pairs)?.symbol).toBe("TSLA");
    expect(resolvePair("eth", pairs)?.symbol).toBe("WETH");
    expect(resolvePair("bnkr", pairs)?.symbol).toBe("BNKR");
    expect(resolvePair(NVDA.toLowerCase(), pairs)?.symbol).toBe("NVDA");
    expect(resolvePair("a", pairs)).toBeNull();
    expect(resolvePair("AAPL", pairs)).toBeNull();
  });
});

describe("public reads", () => {
  it("reads a launch record into lowercase addresses, a date and Bankr's fee estimate", () => {
    expect(parseLaunch(LAUNCH)).toEqual({
      tokenAddress: TOKEN,
      name: "Decentralized Accelerationism",
      symbol: "d/acc",
      chain: "robinhood",
      poolId: POOL,
      txHash: TX,
      deployedAt: new Date(1790425806761).toISOString(),
      pair: { address: NVDA.toLowerCase(), symbol: "NVDA" },
      deployer: BANKR_WALLET,
      feeRecipient: WALLET,
      unclaimedUsd: 1.4642932478288715,
    });
    expect(parseLaunch({ ...LAUNCH, pairedStock: null, pairedToken: { address: BNKR, symbol: "BNKR" } })?.pair?.symbol).toBe("BNKR");
    expect(parseLaunch({ ...LAUNCH, pairedStock: null })?.pair).toBeNull();
    expect(parseLaunch({ tokenAddress: "nope" })).toBeNull();
  });

  it("counts a wallet's launches of the last 24 hours on every chain", async () => {
    const now = 1790425806761 + 60_000;
    const http = vi.fn(async () =>
      Response.json({
        launches: [LAUNCH, { ...LAUNCH, tokenAddress: "0x" + "2".repeat(40), chain: "base" }, { ...LAUNCH, tokenAddress: "0x" + "3".repeat(40), timestamp: now - 25 * 3600_000 }],
      }),
    );
    const launches = await recentLaunches({ http, now });
    expect(launches).toHaveLength(3);
    expect(launchedWithinDay(launches, BANKR_WALLET.toUpperCase().replace("0X", "0x"), now)).toHaveLength(2);
    expect(launchedWithinDay(launches, WALLET, now)).toHaveLength(0);
  });

  it("reads the creator fees of a beneficiary, and nothing when Bankr does not answer", async () => {
    const http = vi.fn(async () => Response.json(FEES));
    const fees = await creatorFees(WALLET, { http });
    expect(fees[0]).toMatchObject({ tokenAddress: TOKEN, chain: "robinhood", token1Label: "NVDA", claimed: { count: 0 } });
    expect((http.mock.calls[0] as unknown as [string])[0]).toBe(`https://api.bankr.bot/public/doppler/creator-fees/${WALLET}?days=30`);
    resetBankrCaches();
    expect(await creatorFees(WALLET, { http: async () => new Response("", { status: 500 }) })).toEqual([]);
  });
});

describe("gas on Robinhood Chain", () => {
  it("reads the balance and the gas price from the chain, and asks for more than a launch used", async () => {
    const http = vi.fn(async (_url: string, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_getBalance" ? "0x2386f26fc10000" : "0x1a616b0" });
    });
    const gas = await chainGas(BANKR_WALLET, http);
    expect(gas).toEqual({ balanceWei: 10_000_000_000_000_000n, gasPriceWei: 27_662_000n });
    expect((http.mock.calls[0] as unknown as [string])[0]).toBe("https://rpc.mainnet.chain.robinhood.com");
    const need = gasNeed(gas.gasPriceWei);
    expect(need.aboutWei).toBe(27_662_000n * 2_500_000n);
    expect(need.needWei).toBe(27_662_000n * 6_000_000n);
    expect(gasNeed(null)).toEqual({ needWei: FALLBACK_GAS_WEI, aboutWei: null });
    expect(await chainGas(BANKR_WALLET, async () => new Response("down", { status: 502 }))).toEqual({ balanceWei: null, gasPriceWei: null });
  });
});

describe("simulate and launch", () => {
  const pairs = parsePairs(QUOTES);
  const params = (pair: string, extra: Partial<LaunchParams> = {}): LaunchParams => ({
    name: "Night Owl",
    symbol: "OWL",
    pair: resolvePair(pair, pairs)!,
    feeRecipient: WALLET,
    vesting: true,
    quoteOnlyFees: false,
    ...extra,
  });

  it("sends Robinhood Chain, Doppler, the pair in the field Bankr names, and the fee recipient as a wallet", () => {
    expect(deployBody(params("NVDA", { description: "For night traders", image: "https://example.com/owl.png" }), true)).toEqual({
      tokenName: "Night Owl",
      tokenSymbol: "OWL",
      description: "For night traders",
      image: "https://example.com/owl.png",
      chain: "robinhood",
      provider: "doppler",
      pairedStockAddress: NVDA,
      feeRecipient: { type: "wallet", value: WALLET },
      simulateOnly: true,
    });
    const weth = deployBody(params("WETH"), false);
    expect(weth).not.toHaveProperty("pairedStockAddress");
    expect(weth).not.toHaveProperty("pairedTokenAddress");
    expect(deployBody(params("BNKR"), false)).toMatchObject({ pairedTokenAddress: BNKR, simulateOnly: false });
    expect(deployBody(params("NVDA", { vesting: false, quoteOnlyFees: true }), false)).toMatchObject({ disableVesting: true, quoteOnlyFees: true });
  });

  it("simulates with the key and reads the predicted token, pool and fee split", async () => {
    const http = vi.fn(async () =>
      Response.json({
        success: true,
        simulated: true,
        tokenAddress: TOKEN,
        poolId: POOL,
        chain: "robinhood",
        feeDistribution: { creator: { address: WALLET, bps: 9500 }, protocol: { address: "0x" + "a".repeat(40), bps: 500 } },
      }),
    );
    const r = await simulateLaunch(KEY, params("NVDA"), http);
    expect(r).toEqual({ ok: true, status: 200, data: { tokenAddress: TOKEN, poolId: POOL, creator: { address: WALLET, bps: 9500 }, protocolBps: 500 } });
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bankr.bot/token-launches/deploy");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(JSON.parse(String(init.body))).toMatchObject({ simulateOnly: true, chain: "robinhood" });
  });

  it("passes Bankr's refusals on with the wait it asks for", async () => {
    const http = async () => Response.json({ error: "Too many launch simulations in the last 24 hours." }, { status: 429, headers: { "retry-after": "3600" } });
    expect(await simulateLaunch(KEY, params("NVDA"), http)).toEqual({
      ok: false,
      status: 429,
      code: "BANKR_429",
      message: "Too many launch simulations in the last 24 hours.",
      retryAfter: 3600,
    });
    expect(await simulateLaunch(KEY, params("NVDA"), async () => Response.json({ success: true }))).toMatchObject({ ok: false, code: "BANKR_ANSWER" });
  });

  it("launches for real with the same body, and reads the transaction", async () => {
    const http = vi.fn(async () => Response.json({ success: true, tokenAddress: TOKEN, poolId: POOL, txHash: TX, chain: "robinhood", feeDistribution: {} }, { status: 201 }));
    const r = await deployLaunch(KEY, params("NVDA"), http);
    expect(r).toEqual({ ok: true, status: 201, data: { tokenAddress: TOKEN, poolId: POOL, txHash: TX, creator: null, protocolBps: null } });
    const body = JSON.parse(String((http.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body).toEqual({ ...deployBody(params("NVDA"), false) });
  });

  it("says Bankr did not answer when the call times out or fails", async () => {
    const timeout = async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    expect(await deployLaunch(KEY, params("NVDA"), timeout)).toMatchObject({ ok: false, status: 0, code: "BANKR_TIMEOUT" });
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await deployLaunch(KEY, params("NVDA"), down)).toMatchObject({ ok: false, status: 0, code: "BANKR_UNREACHABLE" });
  });
});

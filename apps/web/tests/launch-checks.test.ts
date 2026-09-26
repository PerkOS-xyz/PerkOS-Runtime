/**
 * The launch checks say Bankr's rules plainly, and the log keeps what they
 * count: launches that may have gone out and simulations, over 24 hours.
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parsePairs, resolvePair } from "../app/lib/bankrLaunch";
import { ethText, launchChecks, mayHaveLaunched, refusalMessage, type CheckInput } from "../app/lib/launchChecks";
import { LaunchLog } from "../app/lib/launchLog";
import { BANKR_WALLET, QUOTES, TOKEN, WALLET } from "./bankrFixtures";

const pairs = parsePairs(QUOTES);
const base: CheckInput = {
  name: "Night Owl",
  symbol: "OWL",
  pair: resolvePair("NVDA", pairs),
  feesTo: "wallet",
  feeRecipient: WALLET,
  me: { address: BANKR_WALLET, club: false, socials: ["twitter"] },
  gas: { balanceWei: 10n ** 16n, gasPriceWei: 27_662_000n },
  launches24h: 0,
  simulations24h: 0,
};
const check = (input: Partial<CheckInput>, id: string) => launchChecks({ ...base, ...input }).find((c) => c.id === id)!;

describe("launch checks", () => {
  it("pass for a named token on a known pair, with gas and launches left, in a fixed order", () => {
    const checks = launchChecks(base);
    expect(checks.map((c) => c.id)).toEqual(["token", "pair", "fees", "wallet", "gas", "launches", "simulations"]);
    expect(checks.every((c) => c.ok && !c.warn)).toBe(true);
    expect(check({}, "pair").note).toBe("NVDA · NVIDIA, a tokenized stock");
    expect(check({}, "fees").note).toContain("your wallet 0x6732…25b4 · 95% of the pool fee");
    expect(check({}, "gas").note).toBe(
      "0.01 ETH · a launch costs about 0.000069 ETH in gas now, paid by the Bankr wallet: Bankr does not sponsor gas for launches on Robinhood Chain",
    );
  });

  it("block a bad symbol, an unknown or uncleared pair, too little gas, and a used-up day", () => {
    expect(check({ symbol: "OWL!" }, "token").ok).toBe(false);
    expect(check({ pair: null }, "pair").ok).toBe(false);
    expect(check({ pair: resolvePair("musebook", pairs) }, "pair")).toMatchObject({ ok: false, note: expect.stringContaining("not cleared") });
    const gas = check({ gas: { balanceWei: 1000n, gasPriceWei: 27_662_000n } }, "gas");
    expect(gas.ok).toBe(false);
    expect(gas.note).toContain("send at least 0.000165 ETH on Robinhood Chain to 0x47bf…2af0");
    expect(check({ launches24h: 3 }, "launches")).toMatchObject({ ok: false, note: expect.stringContaining("3 of 3 used") });
    expect(check({ simulations24h: 20 }, "simulations").ok).toBe(false);
  });

  it("pass with a word of caution where Bankr would still launch", () => {
    expect(check({ pair: resolvePair("GLW", pairs) }, "pair")).toMatchObject({ ok: true, warn: true, note: expect.stringContaining("thin") });
    expect(check({ me: { address: BANKR_WALLET, club: true, socials: [] } }, "wallet")).toMatchObject({ ok: true, warn: true, note: expect.stringContaining("waits 72 hours") });
    expect(check({ gas: { balanceWei: null, gasPriceWei: null } }, "gas")).toMatchObject({ ok: true, warn: true });
    expect(check({ simulations24h: 4, simulated: true }, "simulations").note).toMatch(/^5 of 20 used/);
  });

  it("write ETH without hiding a small balance", () => {
    expect(ethText(0n)).toBe("0");
    expect(ethText(1n)).toBe("less than 0.000001");
    expect(ethText(10n ** 18n + 5n * 10n ** 14n)).toBe("1.0005");
  });

  it("say what Bankr's refusals mean, and which answers leave a launch in doubt", () => {
    expect(refusalMessage({ status: 401, code: "BANKR_401", message: "Unauthorized" })).toContain("key in Settings");
    expect(refusalMessage({ status: 403, code: "TOKEN_LAUNCH_NOT_AVAILABLE", message: "Token launches are not available for this wallet right now" })).toContain(
      "waits 72 hours",
    );
    expect(refusalMessage({ status: 429, code: "BANKR_429", message: "Too many token deployments from this network", retryAfter: 7200 })).toContain("Try again in about 2 hours.");
    expect(mayHaveLaunched({ status: 0, code: "BANKR_TIMEOUT", message: "" })).toBe(true);
    expect(mayHaveLaunched({ status: 500, code: "BANKR_500", message: "" })).toBe(true);
    expect(mayHaveLaunched({ status: 502, code: "BANKR_ANSWER", message: "" })).toBe(true);
    expect(mayHaveLaunched({ status: 503, code: "BANKR_503", message: "" })).toBe(false);
    expect(mayHaveLaunched({ status: 400, code: "BANKR_400", message: "" })).toBe(false);
  });
});

describe("launch log", () => {
  it("counts simulations and attempts over 24 hours, per Bankr wallet, in an owner-only file", async () => {
    const home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
    let now = 1_000_000_000_000;
    const log = new LaunchLog(() => home, () => now, { queue: Promise.resolve() });
    expect(await log.countSimulation(BANKR_WALLET.toUpperCase().replace("0X", "0x"))).toBe(1);
    expect(await log.countSimulation(BANKR_WALLET)).toBe(2);
    await log.countAttempt(BANKR_WALLET);
    if (process.platform !== "win32") expect((await stat(join(home, "launches.json"))).mode & 0o777).toBe(0o600);
    now += 23 * 3600_000;
    expect(await log.simulations(BANKR_WALLET)).toBe(2);
    now += 2 * 3600_000;
    expect(await log.simulations(BANKR_WALLET)).toBe(0);
    expect(await log.attempts(BANKR_WALLET)).toBe(0);
    expect(await log.countSimulation(BANKR_WALLET)).toBe(1);
  });

  it("keeps each wallet's launches once, newest first", async () => {
    const home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
    const log = new LaunchLog(() => home, Date.now, { queue: Promise.resolve() });
    const launch = (token: string, at: string) => ({
      tokenAddress: token,
      poolId: null,
      txHash: null,
      name: "Night Owl",
      symbol: "OWL",
      pairAddress: null,
      pairedSymbol: "NVDA",
      feeRecipient: WALLET,
      deployer: BANKR_WALLET,
      deployedAt: at,
    });
    await Promise.all([log.record(WALLET, launch(TOKEN, "2026-09-26T10:00:00.000Z")), log.record(WALLET, launch("0x" + "1".repeat(40), "2026-09-26T11:00:00.000Z"))]);
    await log.record(WALLET, launch(TOKEN, "2026-09-26T12:00:00.000Z"));
    const kept = await log.launches(WALLET);
    expect(kept.map((l) => l.deployedAt)).toEqual(["2026-09-26T12:00:00.000Z", "2026-09-26T11:00:00.000Z"]);
    expect(await log.launches("0x" + "9".repeat(40))).toEqual([]);
  });
});

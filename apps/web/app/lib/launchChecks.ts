/**
 * What must hold before a token launch goes out, said plainly, and what
 * Bankr's refusals mean for the person. Pure: the routes gather the numbers,
 * this says what they mean.
 */

import { formatEther } from "viem";

import type { BankrMe, BankrRefusal } from "./bankr";
import { BANKR_LIMITS, gasNeed, type ChainGas, type LaunchPair } from "./bankrLaunch";

export type LaunchCheckId = "token" | "pair" | "fees" | "wallet" | "gas" | "launches" | "simulations";

export interface LaunchCheck {
  id: LaunchCheckId;
  label: string;
  /** False blocks the launch. */
  ok: boolean;
  /** Passes, with something the person should know. */
  warn?: true;
  note: string;
}

/** Where the creator's share of the pool fee goes: the signed-in wallet, or the Bankr wallet that launches. */
export type FeesTo = "wallet" | "bankr";

export interface CheckInput {
  name: string;
  symbol: string;
  pair: LaunchPair | null;
  feesTo: FeesTo;
  feeRecipient: string;
  me: BankrMe;
  gas: ChainGas;
  /** The Bankr wallet's launches in the last 24 hours, as far as Bankr's list and this app can see. */
  launches24h: number;
  /** Simulations this app asked for with the wallet in the last 24 hours, before this check. */
  simulations24h: number;
  /** This check ran a simulation of its own. */
  simulated?: boolean;
}

export const NAME_MAX = 100;
export const SYMBOL = /^[A-Z0-9]{1,20}$/;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** An ETH amount for reading: up to six decimals, never a small balance shown as 0. */
export function ethText(wei: bigint): string {
  if (wei <= 0n) return "0";
  const [whole, frac = ""] = formatEther(wei).split(".");
  const cut = frac.slice(0, 6).replace(/0+$/, "");
  if (whole === "0" && !cut) return "less than 0.000001";
  return cut ? `${whole}.${cut}` : whole!;
}

const LINKED = new Set(["twitter", "x", "farcaster", "telegram"]);

export function launchChecks(i: CheckInput): LaunchCheck[] {
  const checks: LaunchCheck[] = [];

  const nameOk = i.name.length >= 1 && i.name.length <= NAME_MAX;
  const symbolOk = SYMBOL.test(i.symbol);
  checks.push({
    id: "token",
    label: "Name and symbol",
    ok: nameOk && symbolOk,
    note: nameOk && symbolOk ? `${i.name} · ${i.symbol}` : "a name of up to 100 characters and a symbol of up to 20 letters or digits",
  });

  const p = i.pair;
  if (!p) checks.push({ id: "pair", label: "Pair", ok: false, note: "not among Bankr's pairs on Robinhood Chain" });
  else if (!p.ready) checks.push({ id: "pair", label: "Pair", ok: false, note: `${p.symbol} is listed, but Bankr has not cleared it for launches yet` });
  else {
    const what = p.kind === "stock" ? `${p.name}, a tokenized stock` : p.kind === "major" ? `${p.name}, the default quote` : p.name;
    checks.push({
      id: "pair",
      label: "Pair",
      ok: true,
      ...(p.illiquid ? { warn: true as const } : {}),
      note: p.illiquid
        ? `${p.symbol} · Bankr marks this stock's own pool as thin right now: the token launches, it is just hard to trade until liquidity arrives`
        : `${p.symbol} · ${what}`,
    });
  }

  checks.push({
    id: "fees",
    label: "Fees pay to",
    ok: true,
    note: `${i.feesTo === "bankr" ? "your Bankr wallet" : "your wallet"} ${short(i.feeRecipient)} · 95% of the pool fee, and the vested supply when vesting is on`,
  });

  const linked = i.me.socials.some((s) => LINKED.has(s));
  checks.push({
    id: "wallet",
    label: "Bankr wallet",
    ok: true,
    ...(linked ? {} : { warn: true as const }),
    note: `${short(i.me.address)} deploys the token and signs for it${i.me.club ? " · Bankr Club" : ""}${
      linked ? "" : " · no X, Farcaster or Telegram linked on Bankr: a wallet whose only sign-in is an email waits 72 hours before it can launch"
    }`,
  });

  const { needWei, aboutWei } = gasNeed(i.gas.gasPriceWei);
  const cost = aboutWei !== null ? `a launch costs about ${ethText(aboutWei)} ETH in gas now` : "a launch needs a little ETH for gas";
  if (i.gas.balanceWei === null) {
    checks.push({
      id: "gas",
      label: "ETH on Robinhood Chain",
      ok: true,
      warn: true,
      note: `could not read the Bankr wallet's balance · ${cost}, and Bankr does not sponsor gas for launches on Robinhood Chain`,
    });
  } else if (i.gas.balanceWei < needWei) {
    checks.push({
      id: "gas",
      label: "ETH on Robinhood Chain",
      ok: false,
      note: `${ethText(i.gas.balanceWei)} ETH · send at least ${ethText(needWei)} ETH on Robinhood Chain to ${short(i.me.address)}: Bankr does not sponsor gas for launches there, so the Bankr wallet pays it (${cost})`,
    });
  } else {
    checks.push({
      id: "gas",
      label: "ETH on Robinhood Chain",
      ok: true,
      note: `${ethText(i.gas.balanceWei)} ETH · ${cost}, paid by the Bankr wallet: Bankr does not sponsor gas for launches on Robinhood Chain`,
    });
  }

  const launches = BANKR_LIMITS.launchesPerDay;
  checks.push({
    id: "launches",
    label: "Launches today",
    ok: i.launches24h < launches,
    note:
      i.launches24h < launches
        ? `${i.launches24h} of ${launches} used in the last 24 hours · Bankr counts every attempt that may have reached the chain, and one launch a minute`
        : `${launches} of ${launches} used in the last 24 hours · the next one frees up when the oldest leaves the 24-hour window`,
  });

  const sims = BANKR_LIMITS.simulationsPerDay;
  const shown = i.simulations24h + (i.simulated ? 1 : 0);
  checks.push({
    id: "simulations",
    label: "Simulations today",
    ok: i.simulations24h < sims,
    note:
      i.simulations24h < sims
        ? `${shown} of ${sims} used from this app in the last 24 hours · Bankr allows ${sims} a day per wallet, and none once its ${launches} launches are used`
        : `${sims} of ${sims} used in the last 24 hours · Bankr allows ${sims} simulations a day per wallet`,
  });

  return checks;
}

const wait = (seconds?: number) => {
  if (seconds === undefined) return "";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 90 ? ` Try again in about ${Math.round(minutes / 60)} hours.` : ` Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
};

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** What a refusal from Bankr means for the person, for a simulation or the launch itself. */
export function refusalMessage(r: BankrRefusal): string {
  if (r.status === 401) return "Bankr did not accept the key in Settings. Add it again.";
  if (r.code === "TOKEN_LAUNCH_WALLET_TOO_NEW") return "Bankr says the Bankr wallet is too new to launch yet.";
  if (r.code === "TOKEN_LAUNCH_MIN_BALANCE_REQUIRED") return "Bankr asks the Bankr wallet to hold more ETH on Robinhood Chain before it launches.";
  if (r.status === 403) {
    return `Bankr refused: ${sentence(r.message)} The key needs Bankr's Token Launch API with read-write access; a wallet whose only sign-in is an email waits 72 hours; and launches are not available in some regions.`;
  }
  if (r.status === 429) {
    return `Bankr's limit: ${sentence(r.message)} Each Bankr wallet gets ${BANKR_LIMITS.launchesPerDay} launches and ${BANKR_LIMITS.simulationsPerDay} simulations in any 24 hours, and one launch a minute.${wait(r.retryAfter)}`;
  }
  if (r.status === 503) return `Bankr could not check the wallet right now.${wait(r.retryAfter)}`;
  if (r.status === 0) return sentence(r.message);
  return `Bankr refused: ${sentence(r.message)}`;
}

/**
 * Whether an answer to a launch leaves it in doubt: no answer, a server error
 * or an answer without a token. Bankr's 503 comes before anything is sent.
 */
export const mayHaveLaunched = (r: BankrRefusal): boolean => r.status === 0 || r.code === "BANKR_ANSWER" || (r.status >= 500 && r.status !== 503);

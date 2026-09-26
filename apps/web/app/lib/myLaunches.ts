/**
 * A wallet's token launches on Robinhood Chain, as one list: the launches
 * whose fees pay to the signed-in wallet or to the Bankr wallet behind the
 * key. Three sources, because none holds them all:
 *
 *   - Bankr's public list of recent launches (the last 50, every chain);
 *   - the creator fees Bankr reports for each of the two wallets, which name
 *     every token they earn from, however old;
 *   - the launches this app sent, which it keeps itself.
 *
 * A row missing its pair, date or pool is completed from Bankr's record of
 * the launch, which also carries Bankr's estimate of the unclaimed fees.
 */

import { launchLinks, type LaunchLinks } from "../desks/launch";
import { creatorFees, LAUNCH_CHAIN, launchRecord, recentLaunches, type FeeToken, type LaunchRecord } from "./bankrLaunch";
import type { LoggedLaunch } from "./launchLog";

export interface LaunchRow {
  tokenAddress: string;
  name: string;
  symbol: string;
  poolId: string | null;
  /** What the pool is quoted in: a stock ticker, BNKR, or WETH. */
  pairedSymbol: string;
  deployedAt: string | null;
  links: LaunchLinks;
  /** Bankr's estimate of what waits to be claimed, and what was claimed, in USD, when known. */
  fees?: { claimableUsd?: number; claimedUsd?: number };
  chain: "robinhood";
  pairAddress: string | null;
  /** Who earns the creator fee: the signed-in wallet or the Bankr wallet. */
  feeRecipient: string | null;
  deployer: string | null;
  txHash: string | null;
}

/** Records looked up per list, at most. */
const MAX_RECORDS = 20;

interface Draft {
  row: Omit<LaunchRow, "links" | "fees">;
  unclaimedUsd: number | null;
  fee: FeeToken | null;
  /** Came from Bankr's own record: nothing to complete. */
  recorded: boolean;
}

const fromRecord = (l: LaunchRecord): Draft => ({
  row: {
    tokenAddress: l.tokenAddress,
    name: l.name,
    symbol: l.symbol,
    poolId: l.poolId,
    pairedSymbol: l.pair?.symbol ?? "WETH",
    deployedAt: l.deployedAt,
    chain: "robinhood",
    pairAddress: l.pair?.address ?? null,
    feeRecipient: l.feeRecipient,
    deployer: l.deployer,
    txHash: l.txHash,
  },
  unclaimedUsd: l.unclaimedUsd,
  fee: null,
  recorded: true,
});

const fromLogged = (l: LoggedLaunch): Draft => ({
  row: {
    tokenAddress: l.tokenAddress,
    name: l.name,
    symbol: l.symbol,
    poolId: l.poolId,
    pairedSymbol: l.pairedSymbol,
    deployedAt: l.deployedAt,
    chain: "robinhood",
    pairAddress: l.pairAddress,
    feeRecipient: l.feeRecipient,
    deployer: l.deployer,
    txHash: l.txHash,
  },
  unclaimedUsd: null,
  fee: null,
  recorded: false,
});

/** The pair side of a fee token: the label that is not the launched token's own. */
const pairLabel = (t: FeeToken) => (t.token0Label.toLowerCase() === t.symbol.toLowerCase() ? t.token1Label : t.token0Label) || "WETH";

const fromFee = (t: FeeToken, recipient: string): Draft => ({
  row: {
    tokenAddress: t.tokenAddress,
    name: t.name,
    symbol: t.symbol,
    poolId: t.poolId,
    pairedSymbol: pairLabel(t),
    deployedAt: null,
    chain: "robinhood",
    pairAddress: null,
    feeRecipient: recipient,
    deployer: null,
    txHash: null,
  },
  unclaimedUsd: null,
  fee: t,
  recorded: false,
});

function complete(d: Draft, l: LaunchRecord): void {
  const r = d.row;
  r.name = l.name || r.name;
  r.symbol = l.symbol || r.symbol;
  r.poolId = l.poolId ?? r.poolId;
  // Bankr's record names a stock or token pair; one that names neither is quoted in WETH.
  r.pairedSymbol = l.pair?.symbol ?? "WETH";
  r.pairAddress = l.pair?.address ?? r.pairAddress;
  r.deployedAt = l.deployedAt ?? r.deployedAt;
  r.feeRecipient = l.feeRecipient ?? r.feeRecipient;
  r.deployer = l.deployer ?? r.deployer;
  r.txHash = l.txHash ?? r.txHash;
  d.unclaimedUsd = l.unclaimedUsd;
  d.recorded = true;
}

const zero = (units: string) => !(Number(units) > 0);

function feesOf(d: Draft): LaunchRow["fees"] | undefined {
  const fees: NonNullable<LaunchRow["fees"]> = {};
  if (d.unclaimedUsd !== null) fees.claimableUsd = d.unclaimedUsd;
  else if (d.fee && zero(d.fee.claimable.token0) && zero(d.fee.claimable.token1)) fees.claimableUsd = 0;
  // Bankr reports claims in token units only: a USD figure exists when nothing was claimed yet.
  if (d.fee && d.fee.claimed.count === 0) fees.claimedUsd = 0;
  return Object.keys(fees).length ? fees : undefined;
}

/** Newest first; a launch without a date last. */
const byDate = (a: LaunchRow, b: LaunchRow) => (b.deployedAt ?? "").localeCompare(a.deployedAt ?? "");

export async function myLaunches(wallet: string, bankrWallet: string | null, logged: LoggedLaunch[]): Promise<LaunchRow[]> {
  const signedIn = wallet.toLowerCase();
  const bankr = bankrWallet?.toLowerCase() ?? null;
  const ours = new Set([signedIn, ...(bankr ? [bankr] : [])]);
  const [recent, feesSignedIn, feesBankr] = await Promise.all([
    recentLaunches(),
    creatorFees(signedIn),
    bankr && bankr !== signedIn ? creatorFees(bankr) : Promise.resolve([] as FeeToken[]),
  ]);

  const drafts = new Map<string, Draft>();
  for (const l of recent) {
    if (l.chain !== LAUNCH_CHAIN) continue;
    if ((l.feeRecipient && ours.has(l.feeRecipient)) || (bankr && l.deployer === bankr)) drafts.set(l.tokenAddress, fromRecord(l));
  }
  for (const l of logged) if (!drafts.has(l.tokenAddress)) drafts.set(l.tokenAddress, fromLogged(l));
  const fees: Array<[FeeToken, string]> = [
    ...feesSignedIn.map((t): [FeeToken, string] => [t, signedIn]),
    ...feesBankr.map((t): [FeeToken, string] => [t, bankr!]),
  ];
  for (const [t, recipient] of fees) {
    if (t.chain !== LAUNCH_CHAIN) continue;
    const d = drafts.get(t.tokenAddress);
    if (d) d.fee = t;
    else drafts.set(t.tokenAddress, fromFee(t, recipient));
  }

  const missing = [...drafts.values()].filter((d) => !d.recorded).slice(0, MAX_RECORDS);
  await Promise.all(
    missing.map(async (d) => {
      const l = await launchRecord(d.row.tokenAddress).catch(() => null);
      if (!l) return;
      if (l.chain && l.chain !== LAUNCH_CHAIN) {
        drafts.delete(d.row.tokenAddress);
        return;
      }
      complete(d, l);
    }),
  );

  return [...drafts.values()]
    .map((d) => {
      const f = feesOf(d);
      return { ...d.row, links: launchLinks(d.row.tokenAddress), ...(f ? { fees: f } : {}) };
    })
    .sort(byDate);
}

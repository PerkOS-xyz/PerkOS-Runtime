import { LAUNCH_UNCONFIRMED, launchLinks } from "../../../desks/launch";
import { ADDRESS, BANKR_LIMITS, chainGas, deployLaunch, gasNeed, launchedWithinDay, launchPairs, recentLaunches } from "../../../lib/bankrLaunch";
import { guard } from "../../../lib/guard";
import { ethText, mayHaveLaunched, refusalMessage, SYMBOL } from "../../../lib/launchChecks";
import { launchAccess, launchParams, launchWallet, readLaunchInput, type LaunchReceipt } from "../../../lib/launchDraft";
import { claimDeploy, forgetPreview, launchFingerprint, previewFor, releaseDeploy } from "../../../lib/launchGate";
import { launchLog } from "../../../lib/launchLog";

const refuse = (status: number, error: string, message: string) => Response.json({ error, message, sent: false }, { status });

// POST { name, symbol, pair: <pair address>, feesTo?, description?, image?, vesting?, quoteOnlyFees? }
//   -> 201 { receipt }                        the token and its pool are live
//   -> 4xx { error, message, sent: false }    nothing went out
//   -> 504 { error: "unconfirmed", message, sent: null }   no clear answer: it may be on chain
//
// Runs only after the person holds to launch in the desk. Bankr deploys the
// token and its Uniswap v4 pool from the Bankr wallet, which signs and pays
// the gas; the person signs nothing on chain. Before it asks, this checks
// again what the window cannot be trusted with: the pair is still in Bankr's
// registry, the launch is exactly the one simulated in the last ten minutes,
// the wallet still has gas and launches left today, and no other launch from
// this app is in flight.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const access = await launchAccess();
  if (!access.ok) return access.response;
  const read = readLaunchInput(await req.json().catch(() => ({})));
  if (!read.ok) return refuse(400, "input", read.message);
  const { input } = read;
  if (!input.name || !SYMBOL.test(input.symbol) || !ADDRESS.test(input.pair)) {
    return refuse(400, "input", "The launch needs a name, a symbol of letters or digits, and the pair's address.");
  }

  let pairs;
  try {
    pairs = await launchPairs({ fresh: true });
  } catch {
    return refuse(502, "bankr_pairs", "Bankr's list of Robinhood Chain pairs did not answer, so nothing was sent. Try again.");
  }
  const pair = pairs.find((p) => p.address.toLowerCase() === input.pair.toLowerCase());
  if (!pair || !pair.ready) return refuse(409, "pair_gone", "Bankr no longer offers this pair for launches on Robinhood Chain. Nothing was sent.");

  const bankr = await launchWallet(access.key);
  if (!bankr.ok) return bankr.response;
  const { me } = bankr;
  const feeRecipient = input.feesTo === "bankr" ? me.address : access.wallet;
  const params = launchParams(input, pair, feeRecipient);
  if (!previewFor(access.wallet, launchFingerprint(me.address, params))) {
    return refuse(409, "not_checked", "Check the launch again first: it changed since its simulation, or the simulation is more than ten minutes old. Nothing was sent.");
  }

  const [gas, recent, attempts] = await Promise.all([chainGas(me.address), recentLaunches(), launchLog.attempts(me.address)]);
  const { needWei } = gasNeed(gas.gasPriceWei);
  if (gas.balanceWei !== null && gas.balanceWei < needWei) {
    return refuse(409, "no_gas", `The Bankr wallet holds ${ethText(gas.balanceWei)} ETH on Robinhood Chain, less than a launch needs for gas. Nothing was sent.`);
  }
  if (Math.max(launchedWithinDay(recent, me.address).length, attempts) >= BANKR_LIMITS.launchesPerDay) {
    return refuse(429, "launch_limit", "The Bankr wallet has used its 3 launches of the last 24 hours. Nothing was sent.");
  }

  if (!claimDeploy(access.wallet)) return refuse(409, "in_flight", "A launch from this app is already going out. Nothing else was sent.");
  try {
    const r = await deployLaunch(access.key, params);
    if (!r.ok && !mayHaveLaunched(r)) return refuse(r.status >= 400 && r.status < 600 ? r.status : 502, r.code, refusalMessage(r));
    // Out, or maybe out: it counts toward today's launches, and the next one needs a new check.
    await launchLog.countAttempt(me.address).catch(() => undefined);
    forgetPreview(access.wallet);
    if (!r.ok) return Response.json({ error: "unconfirmed", message: LAUNCH_UNCONFIRMED, sent: null, deployer: me.address }, { status: 504 });

    const receipt: LaunchReceipt = {
      tokenAddress: r.data.tokenAddress,
      poolId: r.data.poolId || null,
      txHash: r.data.txHash,
      chain: "robinhood",
      name: input.name,
      symbol: input.symbol,
      pairedSymbol: pair.symbol,
      pairAddress: pair.address.toLowerCase(),
      feeRecipient,
      deployer: me.address,
      deployedAt: new Date().toISOString(),
      links: launchLinks(r.data.tokenAddress),
    };
    await launchLog
      .record(access.wallet, {
        tokenAddress: receipt.tokenAddress,
        poolId: receipt.poolId,
        txHash: receipt.txHash,
        name: receipt.name,
        symbol: receipt.symbol,
        pairAddress: receipt.pairAddress,
        pairedSymbol: receipt.pairedSymbol,
        feeRecipient,
        deployer: me.address,
        deployedAt: receipt.deployedAt,
      })
      .catch(() => undefined);
    return Response.json({ receipt }, { status: 201 });
  } finally {
    releaseDeploy(access.wallet);
  }
}

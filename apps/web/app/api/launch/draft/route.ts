import { chainGas, launchedWithinDay, launchPairs, recentLaunches, resolvePair, simulateLaunch, type LaunchPreview } from "../../../lib/bankrLaunch";
import { guard } from "../../../lib/guard";
import { launchChecks, refusalMessage } from "../../../lib/launchChecks";
import { launchAccess, launchParams, launchWallet, readLaunchInput, type DraftAnswer } from "../../../lib/launchDraft";
import { launchFingerprint, rememberPreview } from "../../../lib/launchGate";
import { launchLog } from "../../../lib/launchLog";

// POST { name, symbol, pair, feesTo?, description?, image?, vesting?, quoteOnlyFees? } -> DraftAnswer
//
// Checks a launch against Bankr's rules and the Bankr wallet, and only when
// every check passes asks Bankr to simulate it (simulateOnly: it sends
// nothing, uses no launch, and counts toward the 20 simulations a day).
// `ready` is true only after the simulation passed; the deploy route then
// accepts exactly what was simulated, for ten minutes.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const access = await launchAccess();
  if (!access.ok) return access.response;
  const read = readLaunchInput(await req.json().catch(() => ({})));
  if (!read.ok) return Response.json({ error: "input", message: read.message }, { status: 400 });
  const { input } = read;
  if (!input.name || !input.symbol) return Response.json({ error: "name_symbol", message: "Give the token a name and a symbol." }, { status: 400 });
  if (!input.pair) return Response.json({ error: "pair", message: "Pick what to pair it with: a tokenized stock like NVDA, or WETH." }, { status: 400 });

  let pairs;
  try {
    pairs = await launchPairs();
  } catch {
    return Response.json({ error: "bankr_pairs", message: "Bankr's list of Robinhood Chain pairs did not answer. Try again." }, { status: 502 });
  }
  const pair = resolvePair(input.pair, pairs);
  if (!pair) {
    return Response.json({ error: "unknown_pair", message: `Nothing called "${input.pair}" is among Bankr's pairs on Robinhood Chain.` }, { status: 404 });
  }
  const bankr = await launchWallet(access.key);
  if (!bankr.ok) return bankr.response;
  const { me } = bankr;
  const feeRecipient = input.feesTo === "bankr" ? me.address : access.wallet;

  const [gas, recent, simulations24h, attempts] = await Promise.all([
    chainGas(me.address),
    recentLaunches(),
    launchLog.simulations(me.address),
    launchLog.attempts(me.address),
  ]);
  const launches24h = Math.max(launchedWithinDay(recent, me.address).length, attempts);
  const facts = { name: input.name, symbol: input.symbol, pair, feesTo: input.feesTo, feeRecipient, me, gas, launches24h, simulations24h };
  const passing = launchChecks(facts).every((c) => c.ok);

  const params = launchParams(input, pair, feeRecipient);
  let preview: LaunchPreview | null = null;
  let simError: string | undefined;
  let used = simulations24h;
  if (passing) {
    used = await launchLog.countSimulation(me.address);
    const sim = await simulateLaunch(access.key, params);
    if (sim.ok) {
      preview = sim.data;
      rememberPreview(access.wallet, launchFingerprint(me.address, params), sim.data);
    } else {
      simError = refusalMessage(sim);
    }
  }

  const answer: DraftAnswer = {
    draft: { ...input, pair, feeRecipient },
    checks: launchChecks({ ...facts, simulated: passing }),
    ready: preview !== null,
    preview,
    ...(simError ? { simError } : {}),
    deployer: me.address,
    limits: { launches24h, simulations24h: used },
  };
  return Response.json(answer);
}

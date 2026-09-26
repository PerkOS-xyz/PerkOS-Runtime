import { LAUNCH_CHAIN, launchPairs } from "../../../lib/bankrLaunch";
import { guard } from "../../../lib/guard";

// GET -> { chain: "robinhood", pairs }: what a token launched on Robinhood
// Chain can pair with, tokenized stocks first (in Bankr's order), then WETH,
// then Bankr's other quote tokens. Bankr's public list: no key needed.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ chain: LAUNCH_CHAIN, pairs: await launchPairs() });
  } catch {
    return Response.json({ error: "bankr_pairs", message: "Bankr's list of Robinhood Chain pairs did not answer. Try again." }, { status: 502 });
  }
}

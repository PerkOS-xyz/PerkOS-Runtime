import { bankrMe } from "../../lib/bankr";
import { bankrKey } from "../../lib/bankrKey";
import { guard } from "../../lib/guard";
import { launchLog } from "../../lib/launchLog";
import { myLaunches } from "../../lib/myLaunches";
import { sessionWallet } from "../../lib/vault";

// GET -> { launches: [{ tokenAddress, name, symbol, poolId, pairedSymbol,
//   deployedAt, links: { uniswap, bankr, explorer }, fees?: { claimableUsd?,
//   claimedUsd? }, ... }] }
//
// The signed-in wallet's token launches on Robinhood Chain: those whose fees
// pay to it or to the Bankr wallet behind the key in Settings, newest first.
// Read only. `{ launches: [] }` without a key.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  const key = await bankrKey.load();
  if (!key) return Response.json({ launches: [] });
  // Without an answer from Bankr about the key, the list still has what pays the signed-in wallet.
  const me = await bankrMe(key);
  const logged = await launchLog.launches(wallet).catch(() => []);
  return Response.json({ launches: await myLaunches(wallet, me.ok ? me.data.address : null, logged) });
}

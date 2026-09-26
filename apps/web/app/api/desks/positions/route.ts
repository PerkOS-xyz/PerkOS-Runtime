import { DeskTrade } from "@perkos/client";

import { ROBINHOOD_CHAIN_ID } from "../../../desks/trade";
import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;

// GET ?module=<desk module> -> { portfolio }: what the delegated wallet holds on
// the desk's chain at the desk's price, against what the Trader paid for it,
// with the USDG and gas beside it and the last swaps. Moves nothing. Like the
// Trader, a portfolio on any chain but Robinhood Chain is refused (502
// PORTFOLIO_CHAIN) rather than drawn with the wrong explorer.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const module = new URL(req.url).searchParams.get("module")?.trim() ?? "";
  if (!MODULE.test(module)) return Response.json({ error: "module", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ portfolio: await new DeskTrade(client).positions(module, ROBINHOOD_CHAIN_ID) });
  } catch (err) {
    return errorResponse(err);
  }
}

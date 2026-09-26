import { DeskTrade } from "@perkos/client";

import { ROBINHOOD_CHAIN_ID } from "../../../desks/trade";
import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;

// GET ?module=<desk module> -> { trader }: the wallet the owner delegated, what
// it holds on the desk's chain and the cap on one order. Moves nothing. The
// Trader sheet names Robinhood Chain's tokens and explorer, so a Trader on any
// other chain is refused (502 TRADER_CHAIN) rather than drawn wrong.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const module = new URL(req.url).searchParams.get("module")?.trim() ?? "";
  if (!MODULE.test(module)) return Response.json({ error: "module", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ trader: await new DeskTrade(client).trader(module, ROBINHOOD_CHAIN_ID) });
  } catch (err) {
    return errorResponse(err);
  }
}

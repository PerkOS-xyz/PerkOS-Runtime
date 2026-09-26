import { DeskTrade } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;
const TICKER = /^[A-Za-z0-9.\-]{1,16}$/;
const USDG = /^\d{1,7}(\.\d{1,6})?$/;

// GET ?module=<desk module>&ticker=NVDA&amountUsdg=1 -> { quote }: what the
// desk would pay out for that much USDG right now. Read-only: nothing is signed.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const module = params.get("module")?.trim() ?? "";
  const ticker = params.get("ticker")?.trim().toUpperCase() ?? "";
  const amount = params.get("amountUsdg")?.trim() ?? "";
  if (!MODULE.test(module) || !TICKER.test(ticker) || !USDG.test(amount) || !(Number(amount) > 0)) {
    return Response.json({ error: "input", message: "Which desk, which stock and how much USDG?" }, { status: 400 });
  }
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ quote: await new DeskTrade(client).quote(module, ticker, String(Number(amount))) });
  } catch (err) {
    return errorResponse(err);
  }
}

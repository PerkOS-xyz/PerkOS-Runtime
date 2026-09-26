import { Desks } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;
const TICKER = /^[A-Za-z0-9.\-]{1,16}$/;

// GET ?module=<desk module>&tickers=NVDA,AAPL -> { series } as the desk measured them, checked against the desk contract.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const module = params.get("module")?.trim() ?? "";
  const tickers = (params.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => TICKER.test(t))
    .slice(0, 10);
  if (!MODULE.test(module) || !tickers.length) return Response.json({ error: "input", message: "Which desk and which tickers?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ series: await new Desks(client).series(module, tickers) });
  } catch (err) {
    return errorResponse(err);
  }
}

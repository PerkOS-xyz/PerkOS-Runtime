import { Desks } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;

// GET ?module=<desk module> -> { market } priced by the desk, checked against the desk contract.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const module = new URL(req.url).searchParams.get("module")?.trim() ?? "";
  if (!MODULE.test(module)) return Response.json({ error: "module", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ market: await new Desks(client).market(module) });
  } catch (err) {
    return errorResponse(err);
  }
}

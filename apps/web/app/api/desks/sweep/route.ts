import { DeskTrade } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^\d{1,78}$/;

// POST { module, token, amount? } -> { receipt }: sends that token from the
// delegated wallet home to the owner. No destination goes from here: PerkOS
// reads it from the delegation, so this can only ever pay the owner.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const module = typeof body.module === "string" ? body.module.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const amount = body.amount;
  if (!MODULE.test(module) || !ADDRESS.test(token) || (amount !== undefined && (typeof amount !== "string" || !UINT.test(amount)))) {
    return Response.json({ error: "input", message: "Which desk and which token?" }, { status: 400 });
  }
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ receipt: await new DeskTrade(client).sweep(module, token, typeof amount === "string" ? amount : undefined) });
  } catch (err) {
    return errorResponse(err);
  }
}

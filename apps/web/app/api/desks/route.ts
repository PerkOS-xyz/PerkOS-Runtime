import { Desks } from "@perkos/client";

import { guard } from "../../lib/guard";
import { perkosClient } from "../../lib/perkos";
import { errorResponse } from "../../lib/respond";

// GET -> { desks } published by PerkOS.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    return Response.json({ desks: await new Desks(client).catalogue("en") });
  } catch (err) {
    return errorResponse(err);
  }
}

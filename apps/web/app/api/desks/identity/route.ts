import { DeskIdentities } from "@perkos/client";
import type { IdentityAction } from "@perkos/ens";
import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

async function handle(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const desk = new URL(req.url).searchParams.get("desk") ?? "";
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(desk)) return Response.json({ message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const identities = new DeskIdentities(client);
    const result = req.method === "GET" ? await identities.status(desk) : await identities.change(desk, await req.json() as IdentityAction);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) { return errorResponse(err); }
}
export const GET = handle;
export const POST = handle;

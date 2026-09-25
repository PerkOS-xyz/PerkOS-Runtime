import { guard } from "../../../lib/guard";
import { errorResponse } from "../../../lib/respond";
import { perkosAuth } from "../../../lib/session";

// POST { address } -> { nonce, message } for the wallet to sign.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { address?: unknown };
  if (typeof body.address !== "string") return Response.json({ error: "address" }, { status: 400 });
  try {
    return Response.json(await perkosAuth.challenge(body.address));
  } catch (err) {
    return errorResponse(err);
  }
}

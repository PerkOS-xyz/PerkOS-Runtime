import { guard } from "../../lib/guard";
import { errorResponse } from "../../lib/respond";
import { perkosAuth, sessions } from "../../lib/session";

// GET -> { signedIn, wallet }. Refreshes the access token when needed.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const s = await sessions.current();
    return Response.json(s ? { signedIn: true, wallet: s.wallet } : { signedIn: false });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST { address, nonce, signature } -> { signedIn: true, wallet }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { address, nonce, signature } = body;
  if (typeof address !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return Response.json({ error: "address, nonce and signature are required" }, { status: 400 });
  }
  try {
    const s = await perkosAuth.signIn({ address, nonce, signature });
    await sessions.save(s);
    return Response.json({ signedIn: true, wallet: s.wallet });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE -> { signedIn: false }
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await sessions.clear();
  return Response.json({ signedIn: false });
}

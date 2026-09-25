import { guard } from "../../lib/guard";
import { names } from "../../lib/identity";
import { sessions } from "../../lib/session";

// GET -> { address, name, source } for the signed-in wallet.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const session = await sessions.current().catch(() => null);
  if (!session) return Response.json({ error: "signed_out" }, { status: 401 });
  const { name, source } = await names.resolve(session.wallet);
  return Response.json({ address: session.wallet, name, source });
}

import { guard } from "../../lib/guard";
import { xaiAuth } from "../../lib/xai";

// GET -> { signedIn }
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ signedIn: await xaiAuth.signedIn() });
}

// DELETE -> { signedIn: false }
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await xaiAuth.signOut();
  return Response.json({ signedIn: false });
}

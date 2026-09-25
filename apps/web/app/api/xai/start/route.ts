import { guard } from "../../../lib/guard";
import { xaiAuth } from "../../../lib/xai";

// POST -> { userCode, verificationUri, verificationUriComplete?, expiresAt, intervalMs }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await xaiAuth.start());
  } catch (err) {
    return Response.json({ error: "xai_start_failed", message: (err as Error).message }, { status: 502 });
  }
}

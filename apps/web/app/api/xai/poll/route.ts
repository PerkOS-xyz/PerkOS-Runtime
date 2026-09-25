import { guard } from "../../../lib/guard";
import { xaiAuth } from "../../../lib/xai";

// POST -> { status: "pending" | "ok" | "denied" | "expired", intervalMs? }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await xaiAuth.poll());
  } catch (err) {
    return Response.json({ error: "xai_poll_failed", message: (err as Error).message }, { status: 502 });
  }
}

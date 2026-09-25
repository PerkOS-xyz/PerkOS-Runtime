import { chatgptAuth } from "../../../lib/chatgpt";
import { guard } from "../../../lib/guard";

// POST -> { status: "pending" | "ok" | "expired", intervalMs? }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await chatgptAuth.poll());
  } catch (err) {
    return Response.json({ error: "chatgpt_poll_failed", message: (err as Error).message }, { status: 502 });
  }
}

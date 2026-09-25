import { chatgptAuth } from "../../../lib/chatgpt";
import { guard } from "../../../lib/guard";

// POST -> { userCode, verificationUri, expiresAt, intervalMs }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await chatgptAuth.start());
  } catch (err) {
    return Response.json({ error: "chatgpt_start_failed", message: (err as Error).message }, { status: 502 });
  }
}

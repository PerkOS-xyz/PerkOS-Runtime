import { chatgptAuth } from "../../lib/chatgpt";
import { guard } from "../../lib/guard";

// GET -> { signedIn }
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ signedIn: await chatgptAuth.signedIn() });
}

// DELETE -> { signedIn: false }
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await chatgptAuth.signOut();
  return Response.json({ signedIn: false });
}

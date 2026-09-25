import { guard } from "../../lib/guard";
import { xaiAuth } from "../../lib/xai";

// GET -> { stt: "xai" | "none", tts: "xai" | "system" }. Never returns credentials.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const grok = await xaiAuth.signedIn();
  return Response.json({ stt: grok ? "xai" : "none", tts: grok ? "xai" : "system" });
}

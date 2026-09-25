import { guard } from "../../lib/guard";
import { defaultRegistry } from "../../lib/models";
import { settings } from "../../lib/settings";
import { cleanMessages, startReply } from "../../lib/sparky";

// POST { messages } -> Sparky's reply as a plain text stream.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    return Response.json({ error: "A user message is required" }, { status: 400 });
  }
  const { model } = await settings.load();
  if (!model) return Response.json({ error: "no_model", message: "Choose a model first." }, { status: 409 });
  try {
    const stream = await startReply(defaultRegistry(), model, messages);
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: "model_failed", message: (err as Error).message }, { status: 502 });
  }
}

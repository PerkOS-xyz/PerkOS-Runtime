import { guard } from "../../lib/guard";
import { defaultRegistry, listSources, validateChoice } from "../../lib/models";
import { settings } from "../../lib/settings";

// GET -> { sources, choice }
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const [sources, current] = await Promise.all([listSources(defaultRegistry()), settings.load()]);
  return Response.json({ sources, choice: current.model ?? null });
}

// POST { provider, model } -> { choice }
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.provider !== "string" || typeof body.model !== "string") {
    return Response.json({ error: "provider and model are required" }, { status: 400 });
  }
  const checked = await validateChoice(defaultRegistry(), { provider: body.provider, model: body.model });
  if ("error" in checked) return Response.json(checked, { status: 400 });
  await settings.update({ model: checked });
  return Response.json({ choice: checked });
}

import { World, worldRequestId } from "@perkos/client";
import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

type Context = { params: Promise<{ path: string[] }> };
const bad = (message: string, status = 400) => Response.json({ error: "WORLD_INPUT", message }, { status, headers: { "Cache-Control": "no-store" } });
async function handle(req: Request, context: Context) {
  const denied = guard(req);
  if (denied) return denied;
  const { path } = await context.params;
  const [first, id, action] = path;
  const isStatus = req.method === "GET" && path.length === 1 && first === "status";
  const isCreate = req.method === "POST" && path.length === 1 && first === "requests";
  const isRequest = first === "requests" && worldRequestId(id) && (req.method === "GET" && path.length === 2 || req.method === "POST" && path.length === 3 && ["poll", "cancel", "proof"].includes(action ?? ""));
  if (!isStatus && !isCreate && !isRequest) return bad("Unknown World operation", 404);
  const client = await perkosClient();
  if (!client) return bad("Sign in to PerkOS first.", 401);
  try {
    const world = new World(client);
    let result;
    if (isStatus) result = await world.status(req.signal);
    else if (isCreate || action === "proof") {
      const raw = await req.text();
      if (raw.length > 256_000) return bad("World proof is too large", 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return bad("Expected JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Expected a World request");
      if (isCreate) {
        if (!["idkit", "oidc"].includes(String(body.provider))) return bad("Choose a World provider");
        if (body.purpose === "enroll" && !Object.keys(body).some((k) => !["provider", "purpose"].includes(k))) {
          result = await world.enroll(body.provider as "idkit" | "oidc", req.signal);
        } else if (body.purpose === "link-provider" && worldRequestId(body.candidateId) && !Object.keys(body).some((k) => !["provider", "purpose", "candidateId"].includes(k))) {
          result = await world.linkProvider(body.provider as "idkit" | "oidc", body.candidateId, req.signal);
        } else return bad("Choose an enrollment or an existing provider to approve the candidate");
      } else {
        if (!body.result || typeof body.result !== "object" || Array.isArray(body.result) || Object.keys(body).some((k) => k !== "result")) return bad("Expected the original IDKit result");
        result = await world.proof(id!, body.result, req.signal);
      }
    } else if (req.method === "GET") result = await world.request(id!, req.signal);
    else if (action === "cancel") result = await world.cancel(id!);
    else result = await world.poll(id!, req.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export const GET = handle;
export const POST = handle;

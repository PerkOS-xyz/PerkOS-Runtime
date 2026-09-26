import { guard } from "../../lib/guard";
import { perkosClient } from "../../lib/perkos";
import { errorResponse } from "../../lib/respond";

// POST { mode?: "grant" | "edit" | "revoke" } -> { url }: a one-time link to
// the page where the person signs in with their email and gives the Trader a
// wallet of theirs, sets its limits, or takes it back. It opens in the browser.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
  const mode = body.mode === "edit" || body.mode === "revoke" ? body.mode : "grant";
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const res = await client.request<{ url?: string }>("/delegation/link-token", { method: "POST", body: { mode } });
    if (typeof res.url !== "string") return Response.json({ error: "link", message: "PerkOS did not return a link." }, { status: 502 });
    return Response.json({ url: res.url });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE -> { revoked }: takes the Trader's access back from the desk. PerkOS
// revokes the delegated share in Dynamic and forgets its copy; the wallet and
// what it holds stay the person's.
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const res = await client.request<{ revoked?: boolean }>("/delegation/revoke", { method: "POST", body: {} });
    return Response.json({ revoked: res.revoked !== false });
  } catch (err) {
    return errorResponse(err);
  }
}

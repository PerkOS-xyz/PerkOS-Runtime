import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const DATA = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/** About 2 MB of image once decoded, the most PerkOS keeps. */
const MAX_CHARS = 2_900_000;

// POST { data: "data:image/png;base64,…" } -> { url }
// Bankr takes a token's logo only as an address it can fetch, so the file
// picked on this computer is hosted on PerkOS (public, under the signed-in
// wallet, content addressed) and the https address goes into the launch.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { data?: unknown };
  const data = typeof body.data === "string" ? body.data : "";
  if (data.length > MAX_CHARS) return Response.json({ error: "too_big", message: "Keep the logo under 2 MB." }, { status: 413 });
  if (!DATA.test(data)) return Response.json({ error: "image", message: "Pick a PNG, JPG, WebP or GIF." }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const hosted = await client.request<{ url?: unknown }>("/files/launch-logo", { method: "POST", body: { data }, timeoutMs: 30_000 });
    if (typeof hosted.url !== "string" || !/^https:\/\/\S+$/.test(hosted.url)) {
      return Response.json({ error: "upload", message: "PerkOS did not return an address for the logo." }, { status: 502 });
    }
    return Response.json({ url: hosted.url });
  } catch (err) {
    return errorResponse(err);
  }
}

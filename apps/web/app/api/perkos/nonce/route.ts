import { perkosNonce, PerkosApiError, perkosConfigured } from "../../../lib/perkosApi";

// GET /api/perkos/nonce?address=0x.. -> { nonce, message, expiresAt }
export async function GET(req: Request) {
  if (!perkosConfigured()) return Response.json({ error: "perkos_not_configured" }, { status: 501 });
  const address = new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "address" }, { status: 400 });
  try {
    return Response.json(await perkosNonce(address));
  } catch (e) {
    const status = e instanceof PerkosApiError ? e.status : 502;
    return Response.json({ error: "nonce_failed", detail: (e as Error).message }, { status });
  }
}

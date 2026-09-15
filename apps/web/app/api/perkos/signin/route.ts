import { perkosSignIn, PerkosApiError, publicPerkosSession } from "../../../lib/perkosApi";

// POST /api/perkos/signin { address, nonce, signature, chainId? }
// 402 -> la wallet no tiene infra PerkOS activa: { error: "infra_payment_required", funding }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; nonce?: string; signature?: string; chainId?: number };
  if (!body.address || !body.nonce || !body.signature) return Response.json({ error: "address, nonce, signature" }, { status: 400 });
  try {
    const s = await perkosSignIn({ address: body.address, nonce: body.nonce, signature: body.signature, chainId: body.chainId });
    return Response.json(publicPerkosSession(s));
  } catch (e) {
    if (e instanceof PerkosApiError) {
      if (e.status === 402) {
        const b = (e.body ?? {}) as Record<string, unknown>;
        return Response.json({ error: "infra_payment_required", detail: e.message, funding: b.payment ?? b.funding ?? null, url: "https://perkos.xyz" }, { status: 402 });
      }
      return Response.json({ error: e.code ?? "signin_failed", detail: e.message }, { status: e.status });
    }
    return Response.json({ error: "signin_failed", detail: (e as Error).message }, { status: 502 });
  }
}

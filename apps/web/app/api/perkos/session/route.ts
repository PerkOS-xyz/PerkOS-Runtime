import { clearPerkosSession, getPerkosIdToken, loadPerkosSession, publicPerkosSession } from "../../../lib/perkosApi";

// GET /api/perkos/session?wallet=0x.. -> estado de la sesion PerkOS (refresca si hace falta)
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim() || undefined;
  const t = await getPerkosIdToken(wallet);
  const s = t ? t.session : await loadPerkosSession();
  const pub = publicPerkosSession(s, wallet);
  // Sin idToken vigente (refresh fallo) hay que volver a firmar.
  return Response.json({ ...pub, connected: pub.connected && Boolean(t) });
}

export async function DELETE() {
  await clearPerkosSession();
  return Response.json({ ok: true });
}

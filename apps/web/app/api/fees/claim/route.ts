import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { buildClaim, creatorFees } from "../../../lib/bankrFees";

// POST /api/fees/claim { tokens?: string[] } -> { recipient, txs[], errors[] }
// Txs de claim sin firmar para la wallet conectada (beneficiaria). Nada se
// firma aqui: Floor las muestra en la Fees card y la persona firma con su
// wallet (Hold to claim). Sin tokens, se reclama todo lo que tenga saldo.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { tokens?: unknown };
  let tokens = Array.isArray(body.tokens) ? body.tokens.filter((t): t is string => typeof t === "string") : [];
  try {
    if (!tokens.length) {
      const f = await creatorFees(s.wallet);
      tokens = f.tokens.filter((t) => Number(t.claimable.token0) > 0 || Number(t.claimable.token1) > 0).map((t) => t.tokenAddress);
    }
    if (!tokens.length) return Response.json({ recipient: s.wallet, txs: [], errors: [], detail: "Nothing to claim yet" });
    const r = await buildClaim(s.wallet, tokens);
    return Response.json({ recipient: s.wallet, ...r });
  } catch (e) {
    return Response.json({ error: "claim_build_failed", detail: (e as Error).message }, { status: 502 });
  }
}

import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { bankrLaunchConfigured, bankrWallet, launchChecks, myLaunches, resolvePair, simulateLaunch, type LaunchCheck, type LaunchSim, type QuoteToken } from "../../../lib/bankrLaunch";
import { marketBrief } from "../../../lib/market";

// POST /api/launch/draft { name, symbol, pair, description? } -> LaunchDraft
// Un token nuevo emparejado con una accion tokenizada (B20 en Base) via
// Bankr. Aqui solo se simula: Bankr devuelve la direccion y el pool que
// tendria. Nada se despliega sin Hold to launch (POST /api/launch/deploy).
export type LaunchDraft = {
  id: string; name: string; symbol: string; description?: string;
  pair: QuoteToken; feeRecipient: `0x${string}`; chain: "base"; provider: "doppler";
  /** La wallet Bankr que despliega (la del dueno de la key). Si no es la wallet
   *  conectada, el vesting del creador se desactiva: el deployer no retiene nada
   *  y el 100% del supply va al pool; las fees (95%) van a la wallet conectada. */
  deployer: string | null; ownKey: boolean; disableVesting: boolean;
  checks: LaunchCheck[]; ready: boolean; sim: LaunchSim | null; simError?: string;
  wallet: { evm: string; ethBase: number; club: boolean } | null; last24h: number;
  facts: string[]; draftedAt: string;
};

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!bankrLaunchConfigured()) return Response.json({ error: "bankr_key", detail: "Add a Bankr API key with Token Launch enabled in Settings" }, { status: 412 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; symbol?: unknown; pair?: unknown; description?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) : "";
  const pairQuery = typeof body.pair === "string" ? body.pair.trim().slice(0, 40) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : undefined;
  if (!name || !symbol) return Response.json({ error: "name_symbol", detail: "Give the token a name and a symbol" }, { status: 400 });
  if (!pairQuery) return Response.json({ error: "pair", detail: "Say which tokenized stock to pair with" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const feeRecipient = s.wallet as `0x${string}`;
  try {
    const [pair, wallet] = await Promise.all([resolvePair(pairQuery), bankrWallet()]);
    if (!pair) return Response.json({ error: "unknown_pair", detail: `No tokenized stock matches "${pairQuery}" in Bankr's registry on Base` }, { status: 404 });
    const mine = wallet ? await myLaunches(wallet.evm) : { all: [], last24h: 0 };
    const checks = launchChecks(wallet, mine.last24h, name, symbol, pair);
    const ready = checks.every((c) => c.ok);
    const ownKey = Boolean(wallet && wallet.evm.toLowerCase() === feeRecipient.toLowerCase());
    const disableVesting = !ownKey;
    // Simular cuesta una de 20 al dia: solo cuando los checks pasan.
    const sim = ready ? await simulateLaunch({ name, symbol, pair, feeRecipient, description, disableVesting }) : null;
    const brief = await marketBrief(pair.symbol.replace(/c$/i, "")).catch(() => null);
    const facts = [
      `Launch on the table: token "${name}" (${symbol}), Uniswap V4 pool paired with ${pair.symbol} (${pair.name}) on Base, deployed by Bankr via Doppler from the human's Bankr wallet. Trading fees: 95% to the human's wallet ${feeRecipient.slice(0, 6)}…${feeRecipient.slice(-4)}, 5% to Bankr. ${ownKey ? "The human's own Bankr wallet deploys; creator vesting 15% stays with the human." : `The Bankr wallet on this install (${wallet ? `${wallet.evm.slice(0, 6)}…${wallet.evm.slice(-4)}` : "none"}) deploys on the human's behalf with creator vesting disabled, so the deployer keeps no tokens and 100% of the supply goes to the pool.`}`,
      ...checks.map((c) => `Check ${c.ok ? "pass" : "FAIL"} · ${c.label}: ${c.note}.`),
      sim && sim.ok ? `Bankr simulation passed: token would be ${sim.data.tokenAddress}, pool ${sim.data.poolId.slice(0, 10)}….` : sim && !sim.ok ? `Bankr simulation failed: ${sim.detail}.` : "Bankr simulation skipped because a check failed.",
      ...(brief?.lines ?? []).slice(0, 6)
    ];
    const draft: LaunchDraft = {
      id: `launch-${Date.now()}`, name, symbol, description, pair, feeRecipient, chain: "base", provider: "doppler",
      deployer: wallet?.evm ?? null, ownKey, disableVesting,
      checks, ready: ready && Boolean(sim && sim.ok), sim: sim && sim.ok ? sim.data : null, simError: sim && !sim.ok ? sim.detail : undefined,
      wallet: wallet ? { evm: wallet.evm, ethBase: wallet.ethBase, club: wallet.club } : null, last24h: mine.last24h,
      facts, draftedAt: new Date().toISOString()
    };
    return Response.json(draft);
  } catch (e) {
    return Response.json({ error: "launch_draft_failed", detail: (e as Error).message }, { status: 502 });
  }
}

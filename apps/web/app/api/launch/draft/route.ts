import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { bankrLaunchConfigured, bankrWallet, launchChecks, myLaunches, parseRecipient, recipientLabel, resolvePair, simulateLaunch, type LaunchCheck, type LaunchSim, type QuoteToken, type Recipient } from "../../../lib/bankrLaunch";
import { marketBrief } from "../../../lib/market";

// POST /api/launch/draft { name, symbol, pair, recipient?, vesting?, feesIn?, degen?, description?, image?, website?, tweet? } -> LaunchDraft
// Un token nuevo cuyo pool Uniswap V4 se empareja con un quote token del
// registro de Bankr en Base (una accion B20, WETH, BNKR, cbHYPE...). Las fees
// (95 % del fee del pool) van al recipient: la wallet conectada por defecto, o
// un handle de X, Farcaster o ENS que Bankr resuelve al simular. Aqui solo se
// simula; nada se despliega sin Hold to launch (POST /api/launch/deploy).
export type LaunchOptions = { vesting: "on" | "off"; feesIn: "both" | "quote"; degen: boolean; description?: string; image?: string; websiteUrl?: string; tweetUrl?: string };
export type LaunchDraft = {
  id: string; name: string; symbol: string; description?: string;
  pair: QuoteToken; recipient: Recipient; recipientLabel: string; resolvedRecipient?: string;
  /** La wallet conectada (siempre presente, aunque el recipient sea otro). */
  feeRecipient: `0x${string}`; ownRecipient: boolean;
  chain: "base"; provider: "doppler"; options: LaunchOptions;
  deployer: string | null; ownKey: boolean; disableVesting: boolean;
  checks: LaunchCheck[]; ready: boolean; sim: LaunchSim | null; simError?: string;
  wallet: { evm: string; ethBase: number; club: boolean } | null; last24h: number;
  facts: string[]; draftedAt: string;
};

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const url = (v: unknown) => { const s = str(v, 300); return /^https:\/\/[^\s]+$/i.test(s) ? s : undefined; };

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!bankrLaunchConfigured()) return Response.json({ error: "bankr_key", detail: "Add a Bankr API key with Token Launch enabled in Settings" }, { status: 412 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = str(body.name, 100).replace(/\s+/g, " ");
  const symbol = str(body.symbol, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pairQuery = str(body.pair, 40);
  const description = str(body.description, 500) || undefined;
  if (!name || !symbol) return Response.json({ error: "name_symbol", detail: "Give the token a name and a symbol" }, { status: 400 });
  if (!pairQuery) return Response.json({ error: "pair", detail: "Say what to pair it with: a tokenized stock like NVDA, or WETH" }, { status: 400 });
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const feeRecipient = s.wallet as `0x${string}`;
  // Recipient: la wallet conectada salvo que la persona nombre a alguien.
  const recipientRaw = str(body.recipient, 80);
  const recipient: Recipient | null = recipientRaw ? parseRecipient(recipientRaw) : { type: "wallet", value: feeRecipient };
  if (!recipient) return Response.json({ error: "recipient", detail: `"${recipientRaw}" is not a wallet, an @x handle, a Farcaster name or an ENS name` }, { status: 400 });
  const ownRecipient = recipient.type === "wallet" && recipient.value.toLowerCase() === feeRecipient.toLowerCase();
  try {
    const [pair, wallet] = await Promise.all([resolvePair(pairQuery), bankrWallet()]);
    if (!pair) return Response.json({ error: "unknown_pair", detail: `No tokenized stock or quote token matches "${pairQuery}" in Bankr's registry on Base` }, { status: 404 });
    const mine = wallet ? await myLaunches(wallet.evm) : { all: [], last24h: 0 };
    const checks = launchChecks(wallet, mine.last24h, name, symbol, pair, recipient);
    const ready = checks.every((c) => c.ok);
    const ownKey = Boolean(wallet && wallet.evm.toLowerCase() === feeRecipient.toLowerCase());
    // Vesting: 15 % del supply al recipient durante un ano. Por defecto solo
    // cuando la persona lanza con su propia key para si misma; "with vesting"
    // lo enciende y "no vesting" lo apaga en cualquier caso.
    const vestingReq = body.vesting === "on" ? "on" : body.vesting === "off" ? "off" : undefined;
    const vesting: "on" | "off" = vestingReq ?? (ownKey && ownRecipient ? "on" : "off");
    const options: LaunchOptions = { vesting, feesIn: body.feesIn === "quote" ? "quote" : "both", degen: body.degen === true, description, image: url(body.image), websiteUrl: url(body.website), tweetUrl: url(body.tweet) };
    const disableVesting = vesting === "off";
    // Simular cuesta una de 20 al dia: solo cuando los checks pasan. La
    // simulacion tambien resuelve el recipient (feeDistribution.creator).
    const sim = ready ? await simulateLaunch({ name, symbol, pair, feeRecipient: recipient, description, image: options.image, websiteUrl: options.websiteUrl, tweetUrl: options.tweetUrl, disableVesting, quoteOnlyFees: options.feesIn === "quote", degenMode: options.degen }) : null;
    const resolvedRecipient = sim && sim.ok ? sim.data.creatorAddress : undefined;
    const brief = pair.kind === "stock" ? await marketBrief(pair.symbol.replace(/c$/i, "")).catch(() => null) : null;
    const who = `${recipientLabel(recipient)}${resolvedRecipient && recipient.type !== "wallet" ? ` (Bankr resolved it to ${resolvedRecipient.slice(0, 6)}…${resolvedRecipient.slice(-4)})` : ""}${ownRecipient ? " (the human's own wallet)" : " (a third party the human named)"}`;
    const facts = [
      `Launch on the table: token "${name}" (${symbol}), Uniswap V4 pool paired with ${pair.symbol} (${pair.name}${pair.kind === "stock" ? ", a tokenized stock" : pair.kind === "major" ? ", the default quote" : ""}) on Base, deployed by Bankr via Doppler${ownKey ? " from the human's own Bankr wallet" : " from the Bankr wallet on this install"}. Trading fees: 95% of the pool fee to ${who}, 5% to Bankr. Creator vesting ${vesting === "on" ? "on: 15% of supply to the fee recipient over one year with a 30 day cliff" : "off: 100% of supply goes to the pool and the deployer keeps nothing"}. Fees collected ${options.feesIn === "quote" ? "in the quote token only" : "in both the token and the quote"}.${options.degen ? " Degen mode: starts at a $2,500 market cap, early trades move the chart hard." : ""}`,
      ...checks.map((c) => `Check ${c.ok ? "pass" : "FAIL"} · ${c.label}: ${c.note}.`),
      sim && sim.ok ? `Bankr simulation passed: token would be ${sim.data.tokenAddress}, pool ${sim.data.poolId.slice(0, 10)}….` : sim && !sim.ok ? `Bankr simulation failed: ${sim.detail}.` : "Bankr simulation skipped because a check failed.",
      ...(brief?.lines ?? []).slice(0, 6)
    ];
    const draft: LaunchDraft = {
      id: `launch-${Date.now()}`, name, symbol, description, pair, recipient, recipientLabel: recipientLabel(recipient), resolvedRecipient, feeRecipient, ownRecipient, chain: "base", provider: "doppler", options,
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

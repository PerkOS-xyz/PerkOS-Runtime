import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { bankrLaunchConfigured, bankrWallet, deployLaunch, launchQuotes, parseRecipient, recipientLabel } from "../../../lib/bankrLaunch";
import { writeNote, appendJournal } from "../../../lib/kb";

// POST /api/launch/deploy { name, symbol, pairAddress, recipient, options?, description? } -> receipt
// Solo despues de Hold to launch en Floor. El recipient viene tal cual lo
// mostro la card (la wallet conectada, o el handle o wallet que la persona
// nombro); la vesting se decide aqui con la misma regla que el draft. Bankr
// paga el gas en Base.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!bankrLaunchConfigured()) return Response.json({ error: "bankr_key" }, { status: 412 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; symbol?: unknown; pairAddress?: unknown; recipient?: unknown; feeRecipient?: unknown; description?: unknown; options?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().slice(0, 20) : "";
  const pairAddress = typeof body.pairAddress === "string" ? body.pairAddress.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : undefined;
  const opt = (body.options ?? {}) as { vesting?: unknown; feesIn?: unknown; degen?: unknown; image?: unknown; websiteUrl?: unknown; tweetUrl?: unknown };
  if (!name || !/^[A-Z0-9]{1,20}$/.test(symbol) || !/^0x[0-9a-fA-F]{40}$/.test(pairAddress)) return Response.json({ error: "bad_draft" }, { status: 400 });
  const s = await loadSettings();
  const desk = s.fleetTemplateId || "floor-desk";
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  // Recipient tipado desde la card; sin uno, la wallet conectada (compat con feeRecipient).
  const r0 = body.recipient as { type?: unknown; value?: unknown } | undefined;
  const recipient = r0 && typeof r0.type === "string" && typeof r0.value === "string"
    ? parseRecipient(r0.type === "wallet" ? r0.value : `${r0.type}:${r0.value}`)
    : typeof body.feeRecipient === "string" ? parseRecipient(body.feeRecipient) : { type: "wallet" as const, value: s.wallet };
  if (!recipient) return Response.json({ error: "recipient", detail: "The fee recipient on the card is not valid" }, { status: 400 });
  const ownRecipient = recipient.type === "wallet" && recipient.value.toLowerCase() === s.wallet.toLowerCase();
  const pair = (await launchQuotes().catch(() => [])).find((t) => t.address.toLowerCase() === pairAddress.toLowerCase()) ?? null;
  if (!pair) return Response.json({ error: "unknown_pair" }, { status: 404 });
  // Misma regla que el draft, decidida aqui y no por el cliente.
  const bw = await bankrWallet().catch(() => null);
  const ownKey = Boolean(bw && bw.evm.toLowerCase() === s.wallet.toLowerCase());
  const vesting = opt.vesting === "on" ? "on" : opt.vesting === "off" ? "off" : ownKey && ownRecipient ? "on" : "off";
  const url = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v.trim()) ? v.trim().slice(0, 300) : undefined);
  const r = await deployLaunch({ name, symbol, pair, feeRecipient: recipient, description, image: url(opt.image), websiteUrl: url(opt.websiteUrl), tweetUrl: url(opt.tweetUrl), disableVesting: vesting === "off", quoteOnlyFees: opt.feesIn === "quote", degenMode: opt.degen === true });
  if (!r.ok) return Response.json({ error: r.error, detail: r.detail }, { status: 502 });
  const rc = r.data;
  const title = `${symbol} paired with ${pair.symbol}`;
  const bodyMd = [
    `- Token: **${name}** (${symbol}) at \`${rc.tokenAddress}\` on Base`,
    `- Paired with: ${pair.symbol} (${pair.name}) at \`${pair.address}\``,
    `- Pool: \`${rc.poolId}\` (Uniswap V4 via Doppler, deployed by Bankr)`,
    `- Tx: https://basescan.org/tx/${rc.txHash}`,
    `- Fees: 95% of the pool fee to ${recipientLabel(recipient)}${rc.creatorAddress ? ` (\`${rc.creatorAddress}\`)` : ""}, 5% to Bankr. Vesting ${vesting}${vesting === "on" ? " (15% to the fee recipient over one year)" : ""}. Fees in ${opt.feesIn === "quote" ? "the quote token only" : "token and quote"}.${opt.degen === true ? " Degen mode." : ""}`,
    `- Deployed by Bankr wallet ${bw?.evm ?? "?"} (${ownKey ? "your own" : "the one on this install"}) on ${new Date().toISOString()}`
  ].join("\n");
  const noteId = await writeNote({ desk, kind: "launch", title, body: bodyMd, ticker: pair.kind === "stock" ? pair.symbol.replace(/c$/i, "") : undefined }).catch(() => "");
  await appendJournal(desk, `Launched ${symbol} paired with ${pair.symbol}, fees to ${recipientLabel(recipient)}: token ${rc.tokenAddress}, tx ${rc.txHash}.`).catch(() => undefined);
  return Response.json({ ...rc, pair: { symbol: pair.symbol, address: pair.address }, recipient, noteId, explorer: `https://basescan.org/tx/${rc.txHash}`, bankrUrl: `https://bankr.bot/launches/${rc.tokenAddress}` });
}

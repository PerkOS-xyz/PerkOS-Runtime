import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { bankrLaunchConfigured, bankrWallet, deployLaunch, launchQuotes } from "../../../lib/bankrLaunch";
import { writeNote, appendJournal } from "../../../lib/kb";

// POST /api/launch/deploy { name, symbol, pairAddress, feeRecipient, description? } -> receipt
// Solo despues de Hold to launch en Floor. El fee recipient tiene que ser
// la wallet conectada en Settings (lo mismo que el draft): un draft
// manipulado no puede desviar las fees. Bankr paga el gas en Base.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!bankrLaunchConfigured()) return Response.json({ error: "bankr_key" }, { status: 412 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; symbol?: unknown; pairAddress?: unknown; feeRecipient?: unknown; description?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().slice(0, 20) : "";
  const pairAddress = typeof body.pairAddress === "string" ? body.pairAddress.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : undefined;
  if (!name || !/^[A-Z0-9]{1,20}$/.test(symbol) || !/^0x[0-9a-fA-F]{40}$/.test(pairAddress)) return Response.json({ error: "bad_draft" }, { status: 400 });
  const s = await loadSettings();
  const desk = s.fleetTemplateId || "floor-desk";
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  if (typeof body.feeRecipient !== "string" || body.feeRecipient.toLowerCase() !== s.wallet.toLowerCase()) return Response.json({ error: "recipient_mismatch", detail: "The fee recipient must be the wallet connected in Settings" }, { status: 409 });
  const pair = (await launchQuotes().catch(() => [])).find((t) => t.address.toLowerCase() === pairAddress.toLowerCase()) ?? null;
  if (!pair) return Response.json({ error: "unknown_pair" }, { status: 404 });
  // Misma regla que el draft, decidida aqui y no por el cliente: si la wallet
  // Bankr que despliega no es la conectada, sin vesting para el deployer.
  const bw = await bankrWallet().catch(() => null);
  const ownKey = Boolean(bw && bw.evm.toLowerCase() === s.wallet.toLowerCase());
  const r = await deployLaunch({ name, symbol, pair, feeRecipient: s.wallet as `0x${string}`, description, disableVesting: !ownKey });
  if (!r.ok) return Response.json({ error: r.error, detail: r.detail }, { status: 502 });
  const rc = r.data;
  const title = `${symbol} paired with ${pair.symbol}`;
  const bodyMd = [
    `- Token: **${name}** (${symbol}) at \`${rc.tokenAddress}\` on Base`,
    `- Paired with: ${pair.symbol} (${pair.name}) at \`${pair.address}\``,
    `- Pool: \`${rc.poolId}\` (Uniswap V4 via Doppler, deployed by Bankr)`,
    `- Tx: https://basescan.org/tx/${rc.txHash}`,
    `- Fees: 95% to ${s.wallet}, 5% to Bankr. ${ownKey ? "Creator vesting 15% to your Bankr wallet." : `Deployed by Bankr wallet ${bw?.evm ?? "?"} on your behalf, vesting disabled.`}`,
    `- Deployed: ${new Date().toISOString()}`
  ].join("\n");
  const noteId = await writeNote({ desk, kind: "launch", title, body: bodyMd, ticker: pair.symbol.replace(/c$/i, "") }).catch(() => "");
  await appendJournal(desk, `Launched ${symbol} paired with ${pair.symbol}: token ${rc.tokenAddress}, tx ${rc.txHash}.`).catch(() => undefined);
  return Response.json({ ...rc, pair: { symbol: pair.symbol, address: pair.address }, noteId, explorer: `https://basescan.org/tx/${rc.txHash}`, bankrUrl: `https://bankr.bot/launches/${rc.tokenAddress}` });
}


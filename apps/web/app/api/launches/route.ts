import { guard } from "../../lib/guard";
import { loadSettings } from "../../lib/settingsStore";
import { bankrLaunchConfigured, bankrWallet, launchQuotes, launchRecord, walletLaunches } from "../../lib/bankrLaunch";
import { creatorFees } from "../../lib/bankrFees";
import { launchMarket, type LaunchMarket } from "../../lib/launchMarket";

// GET /api/launches -> { wallet, deployer, tokens[] }
// Los tokens de la persona: los que pagan fees a su wallet conectada (registro
// publico de Bankr + fees del creador) y los que desplego la wallet Bankr de
// este install. Lectura publica; cada fila trae lo reclamable para la card.
export type LaunchRow = {
  tokenAddress: string; name: string; symbol: string; chain: string; timestamp?: number; status?: string;
  pair?: string; pairAddress?: string; deployer?: string; deployerX?: string; feeRecipient?: string;
  mine: boolean; deployedHere: boolean;
  claimable?: { token0: string; token1: string; token0Label: string; token1Label: string }; claimed?: { token0: string; token1: string; count: number }; share?: string;
  bankrUrl: string; explorer: string; poolId?: string; market?: LaunchMarket;
};

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = await loadSettings();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  const wallet = s.wallet;
  try {
    const bw = bankrLaunchConfigured() ? await bankrWallet().catch(() => null) : null;
    const [launches, fees] = await Promise.all([walletLaunches(wallet, bw?.evm), creatorFees(wallet).catch(() => null)]);
    const rows = new Map<string, LaunchRow>();
    for (const l of launches) {
      const a = l.tokenAddress.toLowerCase();
      rows.set(a, {
        tokenAddress: l.tokenAddress, name: l.tokenName, symbol: l.tokenSymbol, chain: l.chain, timestamp: l.timestamp, status: l.status,
        pair: l.pairedStock?.symbol ?? "WETH", pairAddress: l.pairedStock?.address, deployer: l.deployer?.walletAddress, deployerX: l.deployer?.xUsername, feeRecipient: l.feeRecipient?.walletAddress, poolId: l.poolId,
        mine: (l.feeRecipient?.walletAddress ?? "").toLowerCase() === wallet.toLowerCase(),
        deployedHere: Boolean(bw && (l.deployer?.walletAddress ?? "").toLowerCase() === bw.evm.toLowerCase()),
        bankrUrl: `https://bankr.bot/launches/${l.tokenAddress}`, explorer: `https://basescan.org/token/${l.tokenAddress}`
      });
    }
    for (const t of fees?.tokens ?? []) {
      const a = t.tokenAddress.toLowerCase();
      const row = rows.get(a) ?? { tokenAddress: t.tokenAddress, name: t.name, symbol: t.symbol, chain: "base", mine: true, deployedHere: false, bankrUrl: `https://bankr.bot/launches/${t.tokenAddress}`, explorer: `https://basescan.org/token/${t.tokenAddress}` };
      row.mine = true;
      row.claimable = { ...t.claimable, token0Label: t.token0Label, token1Label: t.token1Label };
      row.claimed = t.claimed; row.share = t.share;
      if (!row.pair && t.token0Label) row.pair = t.token0Label;
      rows.set(a, row);
    }
    // Filas que solo vienen de fees (el token ya salio de la lista publica): se completan con su registro.
    await Promise.all([...rows.values()].filter((r) => !r.poolId).map(async (r) => {
      const l = await launchRecord(r.tokenAddress).catch(() => null);
      if (!l) return;
      r.name = l.tokenName || r.name; r.symbol = l.tokenSymbol || r.symbol; r.timestamp = l.timestamp; r.status = l.status; r.poolId = l.poolId;
      r.pair = l.pairedStock?.symbol ?? "WETH"; r.pairAddress = l.pairedStock?.address;
      r.deployer = l.deployer?.walletAddress; r.deployerX = l.deployer?.xUsername; r.feeRecipient = l.feeRecipient?.walletAddress;
      r.deployedHere = Boolean(bw && (l.deployer?.walletAddress ?? "").toLowerCase() === bw.evm.toLowerCase());
    }));
    // El par se muestra con su simbolo en cadena (NVDAc), no con la etiqueta del registro (NVDA).
    const quotes = await launchQuotes().catch(() => []);
    for (const r of rows.values()) { const q = r.pairAddress ? quotes.find((x) => x.address.toLowerCase() === r.pairAddress!.toLowerCase()) : undefined; if (q) r.pair = q.symbol; }
    const tokens = [...rows.values()].sort((x, y) => (y.timestamp ?? 0) - (x.timestamp ?? 0));
    // Mercado y pool por token (DexScreener, GeckoTerminal, Bankr), en paralelo y con cache de 60 s.
    await Promise.all(tokens.slice(0, 12).map(async (t) => { t.market = await launchMarket(t.tokenAddress, t.poolId).catch(() => undefined); }));
    return Response.json({ wallet, deployer: bw?.evm ?? null, tokens });
  } catch (e) {
    return Response.json({ error: "launches_failed", detail: (e as Error).message }, { status: 502 });
  }
}

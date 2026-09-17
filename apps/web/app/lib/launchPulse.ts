// Pulso de launches: que esta pasando ahora mismo en los launches de Bankr (todas sus cadenas, con
// Base aparte porque es donde opera este desk). Sale del registro publico (los 50 mas recientes,
// acumulados 24 h) y de DexScreener (operaciones por token). Dice con que se
// empareja la gente, que palabra se repite en los nombres (la narrativa del momento), cuantos se
// operan y cuales mas. Es informacion, no consejo: una narrativa dura horas. Sin keys. Cache 10 min.
import { DiskCache } from "./diskCache";

const BANKR = "https://api.bankr.bot";
type RawLaunch = { tokenAddress: string; tokenName?: string; tokenSymbol?: string; timestamp?: number; chain?: string; pairedStock?: { symbol?: string; address?: string } | null; pairedToken?: { symbol?: string } | null; deployer?: { xUsername?: string } | null };

export type PulseLaunch = { symbol: string; name: string; pair: string; chain: string; at: number; trades: number; volumeUsd: number; by?: string; tokenAddress: string };
export type LaunchPulse = {
  at: string;
  /** Minutos que cubren los launches de la muestra. */
  windowMin: number;
  launches: number;
  /** Cuantos de esos launches son en Base (donde opera este desk) y en otras cadenas de Bankr. */
  chains: Array<{ chain: string; count: number }>;
  /** Solo Base: con que se emparejan, de mas a menos. */
  pairs: Array<{ pair: string; count: number; traded: number; medianTrades: number }>;
  /** La palabra que mas se repite en los nombres, si la hay. */
  theme?: { word: string; count: number; traded: number; topTrades: number };
  traded: number;
  noTrades: number;
  top: PulseLaunch[];
  /** Lo mas operado en Base. */
  topBase: PulseLaunch[];
  /** Launches en Base emparejados con una accion tokenizada: cuantos y cuantos sin operar. */
  stocks: { count: number; noTrades: number };
  /** Dos o tres frases listas para mostrar o para darle a la mesa. */
  lines: string[];
};

const cache = new DiskCache<LaunchPulse>("launch-pulse", 10 * 60_000);
const STOCKS = new Set(["NVDA", "META", "TSLA", "AAPL", "AMZN", "GOOGL", "MSFT", "MSTR", "COIN", "CRCL", "INTC", "SNDK", "SPCX", "HOOD", "PLTR"]);
const GENERIC = /^(coin|token|base|bank|bankr|this|that|with|from|your|test|real|official|swap|chain|stock|world|time)/;

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** La subcadena (4 a 8 letras) presente en mas nombres distintos; hace falta que aparezca en 5 o mas. */
function findTheme(names: string[]): { word: string; idx: number[] } | null {
  const seen = new Map<string, Set<number>>();
  names.forEach((n, i) => {
    const s = n.toLowerCase().replace(/[^a-z]/g, "");
    for (let len = 4; len <= 8; len++) for (let k = 0; k + len <= s.length; k++) {
      const w = s.slice(k, k + len);
      if (GENERIC.test(w)) continue;
      if (!seen.has(w)) seen.set(w, new Set());
      seen.get(w)!.add(i);
    }
  });
  let best: { word: string; idx: number[] } | null = null;
  for (const [w, set] of seen) {
    if (set.size < 5) continue;
    // Gana la que cubre mas launches; en empate, la mas larga ("musebook" antes que "museb").
    if (!best || set.size > best.idx.length || (set.size === best.idx.length && w.length > best.word.length)) best = { word: w, idx: [...set] };
  }
  return best;
}

async function tradesFor(addresses: string[]): Promise<Map<string, { trades: number; volumeUsd: number }>> {
  const out = new Map<string, { trades: number; volumeUsd: number }>();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!r || !r.ok) continue;
    const j = (await r.json().catch(() => null)) as { pairs?: Array<{ baseToken?: { address?: string }; txns?: { h24?: { buys?: number; sells?: number } }; volume?: { h24?: number } }> } | null;
    for (const p of j?.pairs ?? []) {
      const a = String(p.baseToken?.address ?? "").toLowerCase();
      if (!a) continue;
      const t = (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0);
      const prev = out.get(a);
      // Un token puede tener varios pools: se suman.
      out.set(a, { trades: (prev?.trades ?? 0) + t, volumeUsd: (prev?.volumeUsd ?? 0) + (p.volume?.h24 ?? 0) });
    }
  }
  return out;
}

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const span = (min: number) => (min >= 90 ? `${Math.round(min / 60)} hours` : `${Math.max(1, Math.round(min))} minutes`);

// Lo visto en las ultimas 24 h: la lista publica solo trae 50 (todas las cadenas mezcladas), y en un
// dia movido eso son unos 80 minutos. Guardando lo visto, la muestra de Base crece con cada lectura.
const seenStore = new DiskCache<Record<string, Omit<PulseLaunch, "trades" | "volumeUsd">>>("launch-pulse-seen", 7 * 24 * 60 * 60_000);
const CHAIN_LABEL: Record<string, string> = { base: "Base", robinhood: "Robinhood Chain", arbitrum: "Arbitrum" };
const onchain = (pair: string) => (STOCKS.has(pair.toUpperCase()) ? `${pair}c` : pair);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function launchPulse(force = false): Promise<LaunchPulse | null> {
  if (!force) { const hit = await cache.get("all"); if (hit) return hit; }
  const r = await fetch(`${BANKR}/token-launches`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json().catch(() => null)) as unknown;
  const raw = (Array.isArray(j) ? j : ((j as Record<string, unknown> | null)?.launches ?? (j as Record<string, unknown> | null)?.data ?? (j as Record<string, unknown> | null)?.tokenLaunches ?? [])) as RawLaunch[];
  const seen = (await seenStore.get("all")) ?? {};
  for (const l of raw) {
    if (!l?.tokenAddress) continue;
    seen[l.tokenAddress.toLowerCase()] = { symbol: l.tokenSymbol ?? "?", name: l.tokenName ?? l.tokenSymbol ?? "?", pair: onchain(l.pairedStock?.symbol ?? l.pairedToken?.symbol ?? "WETH"), chain: l.chain ?? "base", at: Number(l.timestamp ?? Date.now()), by: l.deployer?.xUsername ?? undefined, tokenAddress: l.tokenAddress };
  }
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  for (const k of Object.keys(seen)) if (seen[k].at < dayAgo) delete seen[k];
  await seenStore.set("all", seen);
  // Hasta 120 launches, los mas recientes: cuatro llamadas a DexScreener como mucho.
  const sample = Object.values(seen).sort((a, b) => b.at - a.at).slice(0, 120);
  if (sample.length < 5) return null;
  const trades = await tradesFor(sample.map((l) => l.tokenAddress));
  const rows: PulseLaunch[] = sample.map((l) => { const t = trades.get(l.tokenAddress.toLowerCase()); return { ...l, trades: t?.trades ?? 0, volumeUsd: Math.round(t?.volumeUsd ?? 0) }; });
  const windowMin = (Math.max(...rows.map((x) => x.at)) - Math.min(...rows.map((x) => x.at))) / 60_000;
  const baseRows = rows.filter((x) => x.chain === "base");

  const chainCount = new Map<string, number>();
  for (const x of rows) chainCount.set(x.chain, (chainCount.get(x.chain) ?? 0) + 1);
  const chains = [...chainCount.entries()].map(([chain, count]) => ({ chain, count })).sort((a, b) => b.count - a.count);

  const byPair = new Map<string, PulseLaunch[]>();
  for (const x of baseRows) byPair.set(x.pair, [...(byPair.get(x.pair) ?? []), x]);
  const pairs = [...byPair.entries()].map(([pair, xs]) => ({ pair, count: xs.length, traded: xs.filter((x) => x.trades > 0).length, medianTrades: median(xs.map((x) => x.trades)) })).sort((a, b) => b.count - a.count);

  const th = findTheme(rows.map((x) => `${x.name} ${x.symbol}`));
  const themeRows = th ? th.idx.map((i) => rows[i]) : [];
  const theme = th ? { word: th.word, count: themeRows.length, traded: themeRows.filter((x) => x.trades > 0).length, topTrades: Math.max(0, ...themeRows.map((x) => x.trades)) } : undefined;

  const traded = rows.filter((x) => x.trades > 0).length;
  const byTrades = (xs: PulseLaunch[]) => [...xs].sort((a, b) => b.trades - a.trades).filter((x) => x.trades > 0).slice(0, 5);
  const top = byTrades(rows), topBase = byTrades(baseRows);
  const stockRows = baseRows.filter((x) => STOCKS.has(x.pair.toUpperCase().replace(/C$/, "")));
  const stocks = { count: stockRows.length, noTrades: stockRows.filter((x) => x.trades === 0).length };
  const baseTraded = baseRows.filter((x) => x.trades > 0).length;

  const lines: string[] = [];
  lines.push(`Launch pulse, last ${span(windowMin)} on Bankr: ${plural(rows.length, "launch", "launches")} (${chains.map((c) => `${c.count} on ${CHAIN_LABEL[c.chain] ?? c.chain}`).join(", ")}), ${traded} trading (${pct(traded, rows.length)}%).`);
  if (theme) lines.push(`The name of the moment is "${theme.word}": ${theme.count} of ${rows.length} launches carry it, ${theme.traded} of them trade, the busiest with ${plural(theme.topTrades, "trade")}.`);
  if (baseRows.length) lines.push(`On Base, where this desk trades: ${plural(baseRows.length, "launch", "launches")}, ${baseTraded} trading. Pairs: ${pairs.slice(0, 4).map((p) => `${p.pair} ${p.count}`).join(", ")}.${topBase.length ? ` Busiest: ${topBase.slice(0, 3).map((x) => `${x.symbol} (${x.pair}, ${plural(x.trades, "trade")})`).join(", ")}.` : ""}`);
  if (stocks.count) lines.push(`Paired with a tokenized stock on Base: ${plural(stocks.count, "launch", "launches")}, ${stocks.noTrades} with no trades yet.`);
  lines.push("Attention follows a story or a creator pushing it, and it moves within hours. This is what happened, not advice.");

  const pulse: LaunchPulse = { at: new Date().toISOString(), windowMin: Math.round(windowMin), launches: rows.length, chains, pairs, theme, traded, noTrades: rows.length - traded, top, topBase, stocks, lines };
  await cache.set("all", pulse);
  return pulse;
}

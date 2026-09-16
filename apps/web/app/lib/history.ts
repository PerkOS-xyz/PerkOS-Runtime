import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { DiskCache } from "./diskCache";

// Historico de precio por activo desde las rondas del feed Chainlink en Base
// (total-return, 24/5, ~1 ronda cada pocas horas por desviacion). Tres
// multicalls por activo: sondeo exponencial hacia atras, refinado del borde
// de 30 dias y muestreo de ~40 rondas. Cache 6 h. Sin RPC de archivo.

// Feeds Chainlink por B20 en Base (docs.base.org, 2026-09-15). 8 decimales,
// heartbeat 24 h, desviacion 0.5 %, valores total-return (ajustados por
// splits/dividendos). Se congelan fuera del horario de mercado.
export const CHAINLINK_FEEDS: Record<string, `0x${string}`> = {
  AAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZN: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGL: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  META: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFT: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  MSTR: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
  NVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  SNDK: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
  SPCX: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
  TSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"
};

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
  "function getRoundData(uint80) view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
]);

export type PricePoint = { t: number; p: number };
export type PriceHistory = {
  ticker: string;
  days: number;          // dias realmente cubiertos
  since: string;         // ISO del primer punto
  low: number; high: number; first: number; last: number;
  changePct: number;     // primer punto -> ultimo
  fromLowPct: number;    // ultimo vs minimo
  fromHighPct: number;   // ultimo vs maximo (negativo o cero)
  points: PricePoint[];
  at: string;
  line: string;
};

const TTL = 6 * 60 * 60_000;
const cache = new DiskCache<PriceHistory>("history", TTL);

function client() {
  const url = process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com";
  return createPublicClient({ chain: base, transport: http(url, { retryCount: 2 }) });
}

type Round = { off: bigint; t: number; p: number };

async function rounds(c: ReturnType<typeof client>, feed: `0x${string}`, latest: bigint, offs: bigint[]): Promise<Round[]> {
  const res = await c.multicall({
    allowFailure: true,
    contracts: offs.map((off) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [latest - off] as const }))
  });
  const out: Round[] = [];
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const [, answer, , updatedAt] = r.result;
    const t = Number(updatedAt);
    const p = Number(answer) / 1e8;
    if (t > 0 && p > 0) out.push({ off: offs[i], t, p });
  });
  return out;
}

const pct = (a: number, b: number) => ((a / b) - 1) * 100;
const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

/** Historico de `days` dias (o lo que la fase del feed cubra). undefined si no hay feed o falla. */
export async function priceHistory(ticker: string, days = 30): Promise<PriceHistory | undefined> {
  const key = `${ticker.toUpperCase()}:${days}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const feed = CHAINLINK_FEEDS[ticker.toUpperCase()];
  if (!feed) return undefined;
  try {
    const c = client();
    const latest = await c.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const rid = latest[0];
    const target = Math.floor(Date.now() / 1000) - days * 86_400;
    // 1) Sondeo exponencial: hasta donde llega la fase y donde cae el borde.
    const probe = await rounds(c, feed, rid, [1n, 2n, 4n, 8n, 16n, 32n, 64n, 128n, 256n, 512n, 1024n, 2048n, 4096n]);
    const inside = probe.filter((r) => r.t >= target).sort((a, b) => Number(a.off - b.off));
    const outside = probe.filter((r) => r.t < target).sort((a, b) => Number(a.off - b.off));
    const lastIn = inside.length ? inside[inside.length - 1].off : 0n;
    const oldestValid = probe.length ? probe.reduce((m, r) => (r.off > m ? r.off : m), 0n) : 0n;
    // Borde: entre la ultima ronda dentro del rango y la primera fuera (o el fin de la fase).
    const edgeHi = outside.length ? outside[0].off : oldestValid * 2n + 1n;
    let end = lastIn;
    if (edgeHi > lastIn + 1n) {
      const span = edgeHi - lastIn;
      const step = span / 16n || 1n;
      const offs: bigint[] = [];
      for (let o = lastIn + step; o < edgeHi; o += step) offs.push(o);
      const fine = await rounds(c, feed, rid, offs);
      const fineIn = fine.filter((r) => r.t >= target);
      if (fineIn.length) end = fineIn.reduce((m, r) => (r.off > m ? r.off : m), lastIn);
    }
    if (end === 0n) end = oldestValid; // feed joven: toda la fase
    // 2) Muestreo: ~40 rondas entre el borde y ahora (mas la ultima).
    const n = 40n;
    const step = end / n || 1n;
    const offs: bigint[] = [0n];
    for (let o = step; o <= end; o += step) offs.push(o);
    if (!offs.includes(end)) offs.push(end);
    const sample = (await rounds(c, feed, rid, offs)).sort((a, b) => a.t - b.t);
    if (sample.length < 2) return undefined;
    const points = sample.map((r) => ({ t: r.t, p: r.p }));
    const ps = points.map((x) => x.p);
    const low = Math.min(...ps), high = Math.max(...ps);
    const first = points[0].p, last = points[points.length - 1].p;
    const covered = (points[points.length - 1].t - points[0].t) / 86_400;
    const since = new Date(points[0].t * 1000);
    const h: PriceHistory = {
      ticker: ticker.toUpperCase(), days: Math.round(covered), since: since.toISOString(), low, high, first, last,
      changePct: pct(last, first), fromLowPct: pct(last, low), fromHighPct: pct(last, high), points, at: new Date().toISOString(),
      line: `${Math.round(covered)}-day reference range $${low.toFixed(2)} to $${high.toFixed(2)} (since ${since.toLocaleDateString("en-US", { month: "short", day: "numeric" })}), ${fmt(pct(last, first))} over the period, now ${fmt(pct(last, low))} from the low and ${fmt(pct(last, high))} from the high.`
    };
    await cache.set(key, h);
    return h;
  } catch {
    return undefined;
  }
}

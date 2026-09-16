// Bankr en la mesa: segunda cotizacion (Wallet API `swap-quote`, key
// read-only: cotiza, nunca ejecuta) y, para Analyze, una pregunta al agente
// (Agent API, requiere Bankr Club; 30-70 s, por eso va con cache y nunca
// dentro del turno de mesa). La key vive en BANKR_API_KEY (read-only, sobre una
// wallet vacia). Sin key, todo devuelve null y la mesa sigue solo con Uniswap.

const BASE = "https://api.bankr.bot";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type BankrQuote = {
  source: "bankr";
  side: "buy" | "sell";
  amountInHuman: string;
  outHuman: string;
  outSymbol: string;
  impliedPriceUsd: number;
  feeBps: number;
  priceImpactBps?: number;
  networkCostsUsd?: number;
  buyTokenPriceUsd?: number;
  quoteId?: string;
  at: string;
};

function key(): string | null {
  const k = process.env.BANKR_API_KEY?.trim();
  return k && k.startsWith("bk_") ? k : null;
}

export function bankrConfigured(): boolean {
  return key() !== null;
}

/** Segunda cotizacion para el mismo lado y monto que el draft de Uniswap. */
export async function bankrQuote(p: { side: "buy" | "sell"; stockAddress: string; stockDecimals: number; amountInHuman: string }): Promise<BankrQuote | null> {
  const k = key();
  if (!k) return null;
  const fromToken = p.side === "buy" ? USDC : p.stockAddress;
  const toToken = p.side === "buy" ? p.stockAddress : USDC;
  try {
    const r = await fetch(`${BASE}/wallet/swap-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": k },
      body: JSON.stringify({ fromChain: "base", fromToken, toChain: "base", toToken, amount: p.amountInHuman }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { to?: { formattedAmount?: string; symbol?: string }; feeBps?: number; priceImpactBps?: number; networkCostsUsd?: number | string; buyTokenPriceUsd?: number | string; quoteId?: string };
    const out = Number(j.to?.formattedAmount ?? NaN);
    const amountIn = Number(p.amountInHuman);
    if (!Number.isFinite(out) || out <= 0 || !Number.isFinite(amountIn)) return null;
    const impliedPriceUsd = p.side === "buy" ? amountIn / out : out / amountIn;
    return {
      source: "bankr",
      side: p.side,
      amountInHuman: p.amountInHuman,
      outHuman: out.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
      outSymbol: j.to?.symbol ?? (p.side === "buy" ? "" : "USDC"),
      impliedPriceUsd,
      feeBps: Number(j.feeBps ?? 0),
      priceImpactBps: j.priceImpactBps !== undefined ? Number(j.priceImpactBps) : undefined,
      networkCostsUsd: j.networkCostsUsd !== undefined ? Number(j.networkCostsUsd) : undefined,
      buyTokenPriceUsd: j.buyTokenPriceUsd !== undefined ? Number(j.buyTokenPriceUsd) : undefined,
      quoteId: j.quoteId,
      at: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

/** Pregunta al agente de Bankr (Club). Lento: solo para Analyze, con cache. */
const askCache = new Map<string, { text: string; at: number }>();
export async function bankrAsk(prompt: string, ttlMs = 15 * 60_000): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const hit = askCache.get(prompt);
  if (hit && Date.now() - hit.at < ttlMs) return hit.text;
  try {
    const r = await fetch(`${BASE}/agent/prompt`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": k }, body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const { jobId } = (await r.json()) as { jobId?: string };
    if (!jobId) return null;
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      await new Promise((res) => setTimeout(res, 4_000));
      const jr = await fetch(`${BASE}/agent/job/${encodeURIComponent(jobId)}`, { headers: { "X-API-Key": k }, signal: AbortSignal.timeout(15_000) });
      const j = (await jr.json()) as { status?: string; response?: string };
      if (j.status === "completed" && j.response) { askCache.set(prompt, { text: j.response, at: Date.now() }); return j.response; }
      if (j.status === "failed" || j.status === "error" || j.status === "cancelled") return null;
    }
    return null;
  } catch {
    return null;
  }
}

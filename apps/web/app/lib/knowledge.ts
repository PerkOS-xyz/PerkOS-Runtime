import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Contexto de PerkOS para Floor, en dos mitades (hibrido):
//  1. Estatica: apps/web/knowledge/perkos.md viaja con el app (que es PerkOS,
//     que piezas tiene, que es Floor). Cambia con cada release.
//  2. Viva: PerkOS Knowledge (knowledge.perkos.xyz) se consulta por turno
//     cuando el mensaje toca temas de PerkOS. Crece sin actualizar el app.
//     Tier publico = sin identidad ni key; si el usuario tiene wallet con
//     creditos, se manda x-agent-wallet y paga/usa sus propios tiers.
//     (Contrato: POST /skill/query, PerkOS-Knowledge-Plugin src/client.ts.)

const KNOWLEDGE_BASE_URL = (process.env.KNOWLEDGE_BASE_URL || "https://knowledge.perkos.xyz").replace(/\/$/, "");
const LIVE_TIMEOUT_MS = Number(process.env.KNOWLEDGE_TIMEOUT_MS || 1500); // voz: no esperar mas
const CACHE_TTL_MS = 5 * 60_000;
const LIMIT = 4;

let briefCache: { text: string; at: number } | null = null;

export async function loadBrief(): Promise<string> {
  if (briefCache && Date.now() - briefCache.at < 60_000) return briefCache.text;
  const file = process.env.PERKOS_BRIEF_PATH || join(process.cwd(), "knowledge", "perkos.md");
  let text = "";
  try { text = await readFile(file, "utf8"); } catch { text = ""; }
  briefCache = { text, at: Date.now() };
  return text;
}

// Solo consultamos Knowledge cuando vale la pena: menciona PerkOS/sus piezas o
// es una pregunta real (no "ok", "gracias", "otra vez").
const PERKOS_TERMS = /\b(perk\w*|knowledge|spark|stack|x402|erc[- ]?8004|a2a|nayori|eqlty|minipay|grow|survey|openclaw|hermes|floor|scout|risk|trader|auditor|agent\w*|agente\w*|base|celo|usdc|wallet|token)\b/i;
const QUESTION = /\?|^(what|who|how|why|when|where|which|tell me|explain|que|qué|quien|quién|como|cómo|por que|por qué|cuando|cuándo|donde|dónde|cual|cuál|explica|cuentame|cuéntame|dime)\b/i;

export function shouldQueryLive(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).length < 3) return false;
  return PERKOS_TERMS.test(t) || QUESTION.test(t);
}

type Row = { title?: string | null; summary?: string | null; path?: string | null; confidencePercent?: number | null; trustTier?: string | null; validationStatus?: string | null; updatedAt?: string | null };
export type LiveResult = { context: string; count: number; ms: number; note?: string };

const liveCache = new Map<string, { at: number; r: LiveResult }>();

export async function queryLive(text: string, wallet?: string, signal?: AbortSignal): Promise<LiveResult> {
  const key = `${wallet || ""}|${text.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.r, note: "cache" };

  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LIVE_TIMEOUT_MS);
  const onOuter = () => ac.abort();
  signal?.addEventListener("abort", onOuter);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (wallet) headers["x-agent-wallet"] = wallet;
  try {
    const res = await fetch(`${KNOWLEDGE_BASE_URL}/skill/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: text, limit: LIMIT }),
      signal: ac.signal
    });
    const ms = Date.now() - t0;
    if (res.status === 402) return { context: "", count: 0, ms, note: "402 (public tier not free right now)" };
    if (!res.ok) return { context: "", count: 0, ms, note: `HTTP ${res.status}` };
    const j = (await res.json()) as { context?: Row[]; retrieval?: { mode?: string } };
    const rows = Array.isArray(j.context) ? j.context : [];
    const lines = rows
      .filter((r) => r.title || r.summary)
      .map((r) => {
        const conf = typeof r.confidencePercent === "number" ? ` (confidence ${Math.round(r.confidencePercent)}%${r.validationStatus === "validated" ? ", validated" : ""})` : "";
        const when = r.updatedAt ? ` [${String(r.updatedAt).slice(0, 10)}]` : "";
        return `- ${r.title ?? r.path ?? "item"}${when}${conf}: ${(r.summary ?? "").replace(/\s+/g, " ").slice(0, 600)}`;
      });
    const r: LiveResult = { context: lines.join("\n"), count: lines.length, ms, note: j.retrieval?.mode };
    liveCache.set(key, { at: Date.now(), r });
    return r;
  } catch (e) {
    const ms = Date.now() - t0;
    const aborted = (e as Error).name === "AbortError";
    return { context: "", count: 0, ms, note: aborted ? (ms >= LIVE_TIMEOUT_MS - 5 ? "timeout" : "aborted") : (e as Error).message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuter);
  }
}

export function buildInstructions(base: string, brief: string, live: string): string {
  const parts = [base];
  if (brief.trim()) parts.push("## About PerkOS (reference shipped with the app)\n" + brief.trim());
  if (live.trim()) {
    parts.push(
      "## Live context from PerkOS Knowledge (newer than the reference; prefer it when they differ, weigh by confidence)\n" + live.trim()
    );
  }
  return parts.join("\n\n");
}

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

// ---- Conocimiento compartido de la mesa -----------------------------------
// Las notas del desk (que son los B20, venues y sizing, metodo, perfiles de
// valuacion por activo) viven en PerkOS Knowledge bajo `floor/...` para que
// cualquier instalacion de Floor las reciba sin depender del vault local ni
// de una llave de Grok. Tier publico: sin identidad, $0.

export type DeskRow = { title: string; summary: string; path: string; updatedAt?: string; confidencePercent?: number | null; validated: boolean };
export type DeskKnowledge = { rows: DeskRow[]; context: string; ms: number; note?: string };

const DESK_TIMEOUT_MS = Number(process.env.KNOWLEDGE_DESK_TIMEOUT_MS || 3000);
const deskCache = new Map<string, { at: number; r: DeskKnowledge }>();
const DESK_CACHE_MS = 30 * 60_000;

export async function queryDeskKnowledge(text: string, opts: { pathPrefix?: string; limit?: number; maxChars?: number; perRow?: number; signal?: AbortSignal } = {}): Promise<DeskKnowledge> {
  const prefix = opts.pathPrefix ?? "floor/";
  const key = `${prefix}|${text.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const hit = deskCache.get(key);
  if (hit && Date.now() - hit.at < DESK_CACHE_MS) return { ...hit.r, note: "cache" };
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DESK_TIMEOUT_MS);
  const onOuter = () => ac.abort();
  opts.signal?.addEventListener("abort", onOuter);
  try {
    const res = await fetch(`${KNOWLEDGE_BASE_URL}/skill/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, limit: opts.limit ?? 8, createRequestOnMiss: false }),
      signal: ac.signal
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { rows: [], context: "", ms, note: `HTTP ${res.status}` };
    const j = (await res.json()) as { context?: Row[] };
    const rows: DeskRow[] = (Array.isArray(j.context) ? j.context : [])
      .filter((r) => typeof r.path === "string" && r.path.startsWith(prefix) && (r.title || r.summary))
      .map((r) => ({ title: r.title ?? r.path ?? "item", summary: (r.summary ?? "").trim(), path: r.path!, updatedAt: r.updatedAt ?? undefined, confidencePercent: r.confidencePercent ?? null, validated: r.validationStatus === "validated" }));
    const perRow = opts.perRow ?? 900;
    const max = opts.maxChars ?? 2600;
    let context = "";
    for (const r of rows) {
      const line = `- ${r.title}${r.updatedAt ? ` [${String(r.updatedAt).slice(0, 10)}]` : ""}: ${r.summary.replace(/```json[\s\S]*?```/g, "").replace(/\s+/g, " ").slice(0, perRow)}\n`;
      if (context.length + line.length > max) break;
      context += line;
    }
    const r: DeskKnowledge = { rows, context: context.trim(), ms };
    deskCache.set(key, { at: Date.now(), r });
    return r;
  } catch (e) {
    const ms = Date.now() - t0;
    return { rows: [], context: "", ms, note: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuter);
  }
}

export type DeskItem = {
  path: string; title: string; summary: string; content?: string; date?: string; track?: string; chains?: string[];
  evidence?: Array<{ type: string; url?: string; hash?: string; note?: string; verified?: boolean }>;
  confidence?: "high" | "medium" | "low"; metadata?: Record<string, unknown>;
};

/** Publica notas de la mesa en PerkOS Knowledge (publico). Solo con KNOWLEDGE_INGEST_TOKEN. */
export async function publishDeskItems(items: DeskItem[]): Promise<{ ok: boolean; accepted?: number; error?: string; status?: number }> {
  const token = process.env.KNOWLEDGE_INGEST_TOKEN?.trim();
  if (!token) return { ok: false, error: "no_ingest_token" };
  const agentId = process.env.KNOWLEDGE_AGENT_ID?.trim() || "perkos-floor-desk";
  try {
    const res = await fetch(`${KNOWLEDGE_BASE_URL}/api/ingest/research`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-agent-id": agentId },
      body: JSON.stringify({
        source: "perkos-floor",
        visibility: "public",
        contribution_type: "desk-knowledge",
        items: items.map((it) => ({
          date: it.date ?? new Date().toISOString().slice(0, 10),
          track: it.track ?? "floor-desk",
          title: it.title,
          path: it.path,
          summary: it.summary,
          content: it.content ?? it.summary,
          chains: it.chains ?? ["base"],
          status: "published",
          confidence: it.confidence ?? "high",
          validation_status: "validated",
          sanitization_status: "sanitized",
          visibility: "public",
          evidence: it.evidence ?? [],
          metadata: { app: "perkos-floor", ...(it.metadata ?? {}) }
        }))
      }),
      signal: AbortSignal.timeout(20_000)
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; upserted?: number; accepted?: unknown[]; error?: string };
    if (!res.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}`, status: res.status };
    return { ok: true, accepted: typeof j.upserted === "number" ? j.upserted : Array.isArray(j.accepted) ? j.accepted.length : items.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

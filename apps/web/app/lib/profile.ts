import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getXaiAccessToken, XAI_OAUTH_BASE_URL } from "./xaiOAuth";
import { loadSettings } from "./settingsStore";
import { publishDeskItems, queryDeskKnowledge } from "./knowledge";
import { writeNote } from "./kb";
import { homePath } from "./home";

// Perfil de valuacion por activo (P/E, beta, capitalizacion, proxima fecha de
// earnings, dividendo, consenso): lo que un desk mira antes de opinar a un mes.
// Orden: cache local 24 h -> PerkOS Knowledge (floor/profiles/<T>.md, si tiene
// menos de 24 h) -> Grok con busqueda (JSON estricto). Lo que Grok trae se
// guarda en el vault local (nota "profile") y, si esta instalacion tiene la
// llave de ingest, se publica en Knowledge para las demas instalaciones.

export type AssetProfile = {
  ticker: string; name: string;
  peTrailing: number | null; peForward: number | null; beta: number | null; marketCapUsd: number | null;
  nextEarningsDate: string | null; dividendYieldPct: number | null; consensus: string | null; note: string | null;
  sources: Array<{ url: string; title?: string }>;
  at: string; from: "grok" | "knowledge" | "cache";
  line: string;
};

const TTL = 24 * 60 * 60_000;
const FILE = homePath("cache", "profiles.json");
let mem: Record<string, AssetProfile> | null = null;
const inflight = new Map<string, Promise<AssetProfile | undefined>>();

async function load(): Promise<Record<string, AssetProfile>> {
  if (mem) return mem;
  try { mem = JSON.parse(await readFile(FILE, "utf8")) as Record<string, AssetProfile>; } catch { mem = {}; }
  return mem!;
}
async function save() {
  if (!mem) return;
  await mkdir(join(FILE, ".."), { recursive: true, mode: 0o700 });
  await writeFile(FILE, JSON.stringify(mem), { mode: 0o600 });
}
const fresh = (p?: AssetProfile) => Boolean(p && Date.now() - Date.parse(p.at) < TTL);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[,%$]/g, ""))) ? Number(v.replace(/[,%$]/g, "")) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : null);
const cap = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(0)}B` : `$${(n / 1e6).toFixed(0)}M`);

export function profileLine(p: Omit<AssetProfile, "line">): string {
  const parts: string[] = [];
  if (p.peTrailing !== null) parts.push(`P/E ${p.peTrailing.toFixed(1)}${p.peForward !== null ? ` (forward ${p.peForward.toFixed(1)})` : ""}`);
  else if (p.peForward !== null) parts.push(`forward P/E ${p.peForward.toFixed(1)}`);
  if (p.beta !== null) parts.push(`beta ${p.beta.toFixed(2)}`);
  if (p.marketCapUsd !== null) parts.push(`market cap ${cap(p.marketCapUsd)}`);
  if (p.nextEarningsDate) parts.push(`next earnings ${p.nextEarningsDate}`);
  if (p.dividendYieldPct !== null) parts.push(`dividend yield ${p.dividendYieldPct.toFixed(2)}%`);
  if (p.consensus) parts.push(`analyst consensus ${p.consensus}`);
  const head = parts.length ? `Valuation (${p.at.slice(0, 10)}): ${parts.join(", ")}.` : `Valuation (${p.at.slice(0, 10)}): no figures found.`;
  return p.note ? `${head} ${p.note}` : head;
}

function fromJson(ticker: string, name: string, j: Record<string, unknown>, sources: AssetProfile["sources"], from: AssetProfile["from"], at = new Date().toISOString()): AssetProfile {
  const base = {
    ticker, name,
    peTrailing: num(j.peTrailing ?? j.pe_trailing ?? j.pe), peForward: num(j.peForward ?? j.pe_forward), beta: num(j.beta), marketCapUsd: num(j.marketCapUsd ?? j.market_cap_usd),
    nextEarningsDate: str(j.nextEarningsDate ?? j.next_earnings_date), dividendYieldPct: num(j.dividendYieldPct ?? j.dividend_yield_pct), consensus: str(j.consensus), note: str(j.note),
    sources, at, from
  };
  return { ...base, line: profileLine(base) };
}

/** Lo que ya hay en cache (sin red). */
export async function cachedProfile(ticker: string): Promise<AssetProfile | undefined> {
  const m = await load();
  const p = m[ticker.toUpperCase()];
  return fresh(p) ? p : undefined;
}

async function fromKnowledge(ticker: string, name: string): Promise<AssetProfile | undefined> {
  const k = await queryDeskKnowledge(`${name} ${ticker} valuation profile P/E beta earnings`, { pathPrefix: "floor/profiles/", limit: 6 });
  const row = k.rows.find((r) => r.path === `floor/profiles/${ticker.toUpperCase()}.md`);
  if (!row) return undefined;
  const m = row.summary.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown> & { at?: string; sources?: AssetProfile["sources"] };
    const at = typeof j.at === "string" ? j.at : row.updatedAt ?? new Date().toISOString();
    if (Date.now() - Date.parse(at) > TTL) return undefined;
    return fromJson(ticker, name, j, Array.isArray(j.sources) ? j.sources : [], "knowledge", at);
  } catch { return undefined; }
}

async function fromGrok(ticker: string, name: string): Promise<AssetProfile | undefined> {
  const s = await loadSettings();
  if (s.provider !== "xai-oauth") return undefined;
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return undefined;
  const r = await fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.model?.startsWith("grok-") ? s.model : "grok-4.6",
      tools: [{ type: "web_search" }],
      instructions: "You are a markets desk researcher. Answer with one JSON object only, no prose, no markdown fence. Keys: peTrailing (number or null), peForward (number or null), beta (number or null), marketCapUsd (number in US dollars or null), nextEarningsDate (YYYY-MM-DD or null; the next scheduled or expected report date), dividendYieldPct (number or null), consensus (\"buy\", \"hold\" or \"sell\", or null), note (one short sentence on valuation versus its history or sector, or null). Use the latest figures you can find; null when unknown.",
      input: `Valuation snapshot for ${name} (${ticker}) common stock as of today.`,
      reasoning: { effort: "low" }
    }),
    signal: AbortSignal.timeout(45_000)
  }).catch(() => null);
  if (!r || !r.ok) return undefined;
  const j = (await r.json().catch(() => ({}))) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }> };
  const blocks = (j.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
  const text = blocks.map((c) => c.text ?? "").join(" ").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]) as Record<string, unknown>; } catch { return undefined; }
  const seen = new Set<string>();
  const sources = blocks.flatMap((c) => c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url && !seen.has(a.url) && seen.add(a.url)).map((a) => ({ url: a.url!, title: a.title })).slice(0, 5);
  return fromJson(ticker, name, parsed, sources, "grok");
}

/** Perfil del activo: cache -> Knowledge -> Grok. undefined si nada responde. */
export async function assetProfile(ticker: string, name: string, force = false): Promise<AssetProfile | undefined> {
  const T = ticker.toUpperCase();
  const m = await load();
  if (!force && fresh(m[T])) return { ...m[T], from: "cache" };
  const running = inflight.get(T);
  if (running) return running;
  const p = (async () => {
    let got = force ? undefined : await fromKnowledge(T, name).catch(() => undefined);
    if (!got) {
      got = await fromGrok(T, name).catch(() => undefined);
      if (got) {
        // Nota local (vault, compartida entre desks) y publicacion para las otras instalaciones.
        const json = JSON.stringify({ ...got, line: undefined });
        const body = `${got.line}\n\nSources:\n${got.sources.map((x, i) => `[${i + 1}] ${x.url}`).join("\n") || "(none)"}\n\n\`\`\`json\n${json}\n\`\`\``;
        await writeNote({ desk: "app", kind: "profile", ticker: T, title: `${name} (${T}) valuation profile`, body }).catch(() => undefined);
        void publishDeskItems([{
          path: `floor/profiles/${T}.md`, title: `${name} (${T}): valuation profile`, track: "floor-profiles",
          summary: `${got.line}\n\n\`\`\`json\n${json}\n\`\`\``,
          evidence: got.sources.length ? got.sources.map((x) => ({ type: "url", url: x.url, note: x.title, verified: true })) : [{ type: "llm", note: "Grok web search, no citation returned" }],
          confidence: got.sources.length ? "high" : "medium", metadata: { ticker: T, at: got.at }
        }]).then((r) => { if (!r.ok && r.error !== "no_ingest_token") console.warn("[profile] publish:", r.error); });
      }
    }
    if (got) { m[T] = got; await save().catch(() => undefined); }
    return got;
  })().finally(() => inflight.delete(T));
  inflight.set(T, p);
  return p;
}

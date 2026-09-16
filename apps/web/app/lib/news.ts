import { getXaiAccessToken, XAI_OAUTH_BASE_URL } from "./xaiOAuth";
import { loadSettings } from "./settingsStore";

// Noticias por activo: que movio la accion en 24 h y el proximo catalizador,
// con fuentes (Grok web_search + x_search, Responses API). Cache 15 min en
// memoria. La ruta /api/market/news y el precalentamiento usan esta funcion.
export type News = { text: string; sources: Array<{ url: string; title?: string }>; at: string };
const cache = new Map<string, News>();
const inflight = new Map<string, Promise<News | { error: string; detail?: string; status: number }>>();
export const NEWS_TTL = 15 * 60_000;

export function cachedNews(ticker: string): News | undefined {
  const hit = cache.get(ticker.toUpperCase());
  return hit && Date.now() - Date.parse(hit.at) < NEWS_TTL ? hit : undefined;
}

export async function newsFor(ticker: string, name: string, force = false): Promise<News | { error: string; detail?: string; status: number }> {
  const T = ticker.toUpperCase();
  if (!force) { const hit = cachedNews(T); if (hit) return hit; }
  const running = inflight.get(T);
  if (running) return running;
  const p = (async () => {
    const s = await loadSettings();
    if (s.provider !== "xai-oauth") return { error: "llm_not_connected", status: 501 };
    const token = await getXaiAccessToken().catch(() => null);
    if (!token) return { error: "llm_not_connected", status: 401 };
    const r = await fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: s.model?.startsWith("grok-") ? s.model : "grok-4.6",
        tools: [{ type: "web_search" }, { type: "x_search" }],
        instructions: "You are a markets desk researcher. Plain text, no markdown, no lists. Two or three short sentences, as speech. Only facts you found; cite sources inline as [n].",
        input: `What moved ${name} (${T}) stock in the last 24 hours, and what is the next known catalyst (earnings, events)?`,
        reasoning: { effort: "low" }
      }),
      signal: AbortSignal.timeout(40_000)
    }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
    const j = (await r.json().catch(() => ({}))) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }>; error?: unknown };
    if (!r.ok) return { error: "news_failed", detail: JSON.stringify(j.error ?? j).slice(0, 300), status: 502 };
    const blocks = (j.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
    const text = blocks.map((c) => c.text ?? "").join(" ").replace(/\[\[(\d+)\]\]\([^)]*\)/g, "[$1]").replace(/\s+/g, " ").trim();
    const seen = new Set<string>();
    const sources = blocks.flatMap((c) => c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url && !seen.has(a.url) && seen.add(a.url)).map((a) => ({ url: a.url!, title: a.title })).slice(0, 5);
    const news: News = { text, sources, at: new Date().toISOString() };
    cache.set(T, news);
    return news;
  })().finally(() => inflight.delete(T));
  inflight.set(T, p);
  return p;
}

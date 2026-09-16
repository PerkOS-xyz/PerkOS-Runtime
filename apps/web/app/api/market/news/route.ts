import { getXaiAccessToken, XAI_OAUTH_BASE_URL } from "../../../lib/xaiOAuth";
import { loadSettings } from "../../../lib/settingsStore";

// POST /api/market/news { ticker, name } -> { text, sources[], at, cached }
// Que movio la accion en 24 h, con fuentes: Grok con web_search + x_search
// (Responses API, no streaming). Una busqueda por activo cada 15 min.
type News = { text: string; sources: Array<{ url: string; title?: string }>; at: string };
const cache = new Map<string, News>();
const TTL = 15 * 60_000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: unknown; name?: unknown; force?: unknown };
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase().slice(0, 12) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : ticker;
  if (!ticker) return Response.json({ error: "ticker" }, { status: 400 });
  const hit = cache.get(ticker);
  if (hit && !body.force && Date.now() - Date.parse(hit.at) < TTL) return Response.json({ ...hit, cached: true });

  const s = await loadSettings();
  if (s.provider !== "xai-oauth") return Response.json({ error: "llm_not_connected" }, { status: 501 });
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });

  const r = await fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.model?.startsWith("grok-") ? s.model : "grok-4.6",
      tools: [{ type: "web_search" }, { type: "x_search" }],
      instructions: "You are a markets desk researcher. Plain text, no markdown, no lists. Two or three short sentences, as speech. Only facts you found; cite sources inline as [n].",
      input: `What moved ${name} (${ticker}) stock in the last 24 hours, and what is the next known catalyst (earnings, events)?`,
      reasoning: { effort: "low" }
    }),
    signal: AbortSignal.timeout(40_000)
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
  const j = (await r.json().catch(() => ({}))) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }>; error?: unknown };
  if (!r.ok) return Response.json({ error: "news_failed", detail: JSON.stringify(j.error ?? j).slice(0, 300) }, { status: 502 });
  const blocks = (j.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
  const text = blocks.map((c) => c.text ?? "").join(" ").replace(/\[\[(\d+)\]\]\([^)]*\)/g, "[$1]").replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  const sources = blocks.flatMap((c) => c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url && !seen.has(a.url) && seen.add(a.url)).map((a) => ({ url: a.url!, title: a.title })).slice(0, 5);
  const news: News = { text, sources, at: new Date().toISOString() };
  cache.set(ticker, news);
  return Response.json({ ...news, cached: false });
}

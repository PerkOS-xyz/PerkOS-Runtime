import { getXaiAccessToken, XAI_OAUTH_BASE_URL } from "../../../lib/xaiOAuth";
import { loadSettings } from "../../../lib/settingsStore";
import { appendMemory, markSummarized, readJournal, today } from "../../../lib/kb";

// POST /api/kb/summarize { date?: "YYYY-MM-DD", force?: boolean }
// Resume el diario del dia del desk (Grok, sin streaming) en hechos estables,
// decisiones, preferencias y preguntas abiertas, y lo agrega a memory.md.
// Es el "playbook" de cierre del dia; Floor lo dispara al arrancar para el
// dia anterior y por voz ("summarize today").
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { date?: unknown; force?: unknown };
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : today();
  const s = await loadSettings();
  const desk = s.fleetTemplateId;
  const j = await readJournal(desk, date);
  if (!j || j.body.trim().length < 80) return Response.json({ ok: false, reason: "nothing_to_summarize", date });
  if (j.summarized && b.force !== true) return Response.json({ ok: true, cached: true, date });
  if (s.provider !== "xai-oauth") return Response.json({ error: "llm_not_connected" }, { status: 501 });
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });

  const r = await fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.model?.startsWith("grok-") ? s.model : "grok-4.6",
      instructions: [
        "You maintain the long-term memory of a trading desk. From the day's journal, extract only what should still be true next week.",
        "Write plain Markdown with exactly these headings: ### Facts, ### Decisions, ### Preferences, ### Open questions. Bullets, terse, with the asset ticker when relevant and the date in parentheses.",
        "Skip small talk, greetings and anything already obvious. Never include addresses, hashes, keys or tokens. If a section is empty write '- none'."
      ].join(" "),
      input: `Journal of ${date} (UTC):\n\n${j.body.slice(0, 24_000)}`,
      reasoning: { effort: "low" }
    }),
    signal: AbortSignal.timeout(60_000)
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
  const out = (await r.json().catch(() => ({}))) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; error?: unknown };
  if (!r.ok) return Response.json({ error: "summarize_failed", detail: JSON.stringify(out.error ?? out).slice(0, 300) }, { status: 502 });
  const text = (out.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("\n").trim();
  if (!text) return Response.json({ error: "summarize_empty" }, { status: 502 });
  const id = await appendMemory(desk, `Summary of ${date}`, text);
  await markSummarized(desk, date);
  return Response.json({ ok: true, date, id, text });
}

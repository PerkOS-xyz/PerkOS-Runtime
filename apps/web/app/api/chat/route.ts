import { guard } from "../../lib/guard";
import {
  getXaiAccessToken,
  loadXaiTokens,
  refreshXaiTokens,
  saveXaiTokens,
  XAI_OAUTH_BASE_URL,
  XAI_ORIGINATOR,
  XAI_USER_AGENT
} from "../../lib/xaiOAuth";
import { contextFor, kbBusy } from "../../lib/kb";
import { loadSettings } from "../../lib/settingsStore";
import { buildInstructions, loadBrief, queryLive, shouldQueryLive } from "../../lib/knowledge";
import { launchQuotes } from "../../lib/bankrLaunch";

// Conversacion con Grok por suscripcion. Transporte: Responses API
// (Hermes: transport="codex_responses" para "xai-oauth").
// Historial en memoria del proceso: una sesion por app, suficiente para la demo.

type Msg = { role: "user" | "assistant"; content: string };
const history: Msg[] = [];
const MAX_TURNS = 40;

// Contexto hibrido: estas reglas + brief estatico (knowledge/perkos.md) +
// contexto vivo de PerkOS Knowledge por turno (lib/knowledge.ts).
// El desk activo (header) da el contexto: nombre y roles del template.
function deskLine(desk?: { name?: string; roles?: string[] }): string {
  const roles = desk?.roles?.length ? desk.roles.join(", ") : "Scout, Risk, Trader, Auditor";
  return `You are Sparky, the voice of PerkOS. Through this desktop app you work the "${desk?.name?.trim() || "PerkOS Floor Desk"}" desk with a small team of specialized teammates (${roles}) on Base, running on PerkOS infrastructure; other desks (EQLTY Desk, Nayori Desk and more) will come and you stay the same voice.`;
}
const BASE_INSTRUCTIONS = [
  "You are Sparky, the voice of PerkOS: through this desktop app you work the PerkOS Floor Desk with a small team of specialized teammates (Scout, Risk, Trader, Auditor) on Base, running on PerkOS infrastructure.",
  "Your name is Sparky; the teammates address you as @Sparky. When asked who you are, say you are Sparky, the voice of PerkOS; the desk is what changes (PerkOS Floor Desk today, EQLTY Desk, Nayori Desk and others later), never your name or your voice. Tone: a young, quick, confident voice; warm, plain and precise; no hype and no filler.",
  "You draft. The human approves. You never spend or move funds; you describe what you would draft.",
  "Answer briefly and conversationally, one to three sentences, as speech to be read aloud. No markdown, no lists.",
  "Never read out contract addresses, transaction hashes or long identifiers; say the name and ticker instead (the screen shows the rest).",
  "When the desk hands you verified market facts for this turn, use them: give the price, the 24h move and what matters. Do not say you lack the price if a fact line has it.",
  "Answer in the language the person uses."
].join(" ");

function sse(controller: ReadableStreamDefaultController, obj: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`));
}

async function callResponses(token: string, model: string, effort: string, instructions: string, signal: AbortSignal) {
  return fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": XAI_USER_AGENT,
      originator: XAI_ORIGINATOR
    },
    body: JSON.stringify({
      model,
      instructions,
      input: history.map((m) => ({ role: m.role, content: m.content })),
      // Sin esto grok-4.6 razona 20-70 s por turno. "low" = conversacion.
      reasoning: { effort },
      stream: true
    }),
    signal
  });
}

export async function DELETE() {
  history.length = 0;
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  kbBusy(true, 3 * 60_000);
  const body = (await req.json().catch(() => ({}))) as { text?: string; fleet?: Array<{ role: string; ok: boolean; reply: string; detail?: string }>; desk?: { name?: string; roles?: string[] }; brief?: string[] | null; news?: string | null; focus?: string | null; side?: boolean };
  const text = body.text?.trim() ?? "";
  // Respuestas de la flota (Hermes en PerkOS infra) para este turno: Grok es
  // la voz del Floor y las resume; no inventa lo que un agente no dijo.
  const fleet = Array.isArray(body.fleet) ? body.fleet : [];
  if (!text) return Response.json({ error: "text" }, { status: 400 });

  const s = await loadSettings();
  if (s.provider !== "xai-oauth") return Response.json({ error: `provider ${s.provider} is coming soon` }, { status: 501 });
  let token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });

  history.push({ role: "user", content: text });
  while (history.length > MAX_TURNS) history.shift();

  const t0 = Date.now();
  // Hibrido: el brief siempre; Knowledge solo si el mensaje lo amerita y con
  // tope de tiempo (la voz no puede esperar). Si falla, seguimos sin el.
  const brief = await loadBrief();
  const live = shouldQueryLive(text) ? await queryLive(text, s.wallet || undefined, req.signal) : null;
  const fleetCtx = fleet.length
    ? fleet.map((f) => `- ${f.role}: ${f.ok && f.reply ? f.reply.replace(/\s+/g, " ").slice(0, 900) : `(no answer: ${f.detail || "unavailable"})`}`).join("\n")
    : "";
  const base = BASE_INSTRUCTIONS.replace(/^You are Sparky,[^.]*\./, deskLine(body.desk));
  const factLines = Array.isArray(body.brief) ? body.brief.filter((l) => typeof l === "string").slice(0, 12).map((l) => l.slice(0, 300)) : [];
  const factsCtx = factLines.length
    ? "\n\n## Market facts the desk verified this turn (Uniswap, Chainlink, Base RPC). Lead with the price and the 24h move; these override anything older:\n" + factLines.map((l) => `- ${l}`).join("\n") + (typeof body.news === "string" && body.news.trim() ? `\n- News (with sources on screen): ${body.news.trim().slice(0, 700)}` : "")
    : "";
  // Lo que este desk ya sabe (vault local): diario, analisis previos, ordenes, memoria.
  const local = await contextFor(text, s.fleetTemplateId, body.focus ?? undefined).catch(() => ({ text: "", hits: [] }));
  const localCtx = local.text
    ? "\n\n## What this desk already knows (local notes on this Mac; cite the date when you use them, prefer today's verified facts if they conflict):\n" + local.text
    : "";
  // Lanzamientos: cuando la pregunta va de lanzar o emparejar un token, Sparky conoce la
  // lista real de pares que Bankr acepta en Base (cache de 1 h en launchQuotes).
  const launchCtx = /launch|pair|paired|token/i.test(text)
    ? await launchQuotes().then((q) => {
        const stocks = q.filter((x) => x.kind === "stock").map((x) => `${x.symbol} (${x.name})`);
        const others = q.filter((x) => x.kind !== "stock").map((x) => x.symbol);
        return q.length
          ? `\n\n## Launching tokens from this desk (Bankr, Base)\nA new token launches paired with one of these. Tokenized stocks: ${stocks.join(", ") || "none"}. Other quote tokens: ${others.join(", ") || "none"}. The person picks the pair, the fee recipient (wallet, X handle, Farcaster or ENS) and the options; the desk drafts and simulates, they approve. Limits: 3 launches per 24 h per wallet, 20 simulations per 24 h. Say "launch NAME (SYMBOL) paired with NVDAc" to get a draft card.`
          : "";
      }).catch(() => "")
    : "";
  const sideCtx = body.side === true
    ? "\n\n## A desk turn is running right now\nThe person asked something while Scout, Risk, Trader and Auditor are still working. You are the principal: answer only this question, in one or two sentences, from the facts you already have. Do not speak for agents that have not answered yet; say they are still working if asked.\n"
    : "";
  const instructions = buildInstructions(base, brief, live?.context ?? "") + factsCtx + localCtx + launchCtx + sideCtx + (fleetCtx
    ? "\n\n## Your teammates just answered this turn (Hermes agents on PerkOS infra). Speak for the desk: summarize what they found, name who said what when it matters, flag disagreements and what needs the human's approval. Do not invent what they did not say.\n" + fleetCtx
    : "");
  const knowledgeInfo = live
    ? `knowledge: ${live.count} items · ${live.ms} ms${live.note ? ` · ${live.note}` : ""}`
    : "knowledge: skipped (small talk)";
  const localInfo = local.hits.length ? ` · local notes: ${local.hits.length}` : "";
  let res = await callResponses(token, s.model, s.effort, instructions, req.signal);
  if (res.status === 401) {
    // Como Hermes: un refresh forzado y un solo reintento.
    const cur = await loadXaiTokens();
    if (cur) {
      const next = await refreshXaiTokens(cur);
      await saveXaiTokens(next);
      token = next.accessToken;
      res = await callResponses(token, s.model, s.effort, instructions, req.signal);
    }
  }
  if (!res.ok || !res.body) {
    history.pop();
    const detail = await res.text().catch(() => "");
    return Response.json({ error: `xai ${res.status}`, detail: detail.slice(0, 600) }, { status: 502 });
  }

  const upstream = res.body.getReader();
  const stream = new ReadableStream({
    async start(controller) {
      let buf = "";
      let full = "";
      let firstAt = 0;
      const dec = new TextDecoder();
      try {
        sse(controller, { info: `${knowledgeInfo}${localInfo} · brief ${brief ? Math.round(brief.length / 1024) : 0} KB` });
        for (;;) {
          const { value, done } = await upstream.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const raw = dataLine.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            let ev: { type?: string; delta?: string; error?: { message?: string } };
            try { ev = JSON.parse(raw); } catch { continue; }
            if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
              if (!firstAt) { firstAt = Date.now(); sse(controller, { info: `first token ${firstAt - t0} ms · ${s.model} · effort ${s.effort}` }); }
              full += ev.delta;
              sse(controller, { delta: ev.delta });
            } else if (ev.type === "response.failed" || ev.type === "error") {
              sse(controller, { error: ev.error?.message ?? "upstream error" });
            }
          }
        }
        if (full) history.push({ role: "assistant", content: full });
        else history.pop();
        sse(controller, { done: true, info: `total ${Date.now() - t0} ms` });
      } catch (e) {
        history.pop();
        sse(controller, { error: e instanceof Error ? e.message : String(e) });
      } finally {
        kbBusy(false);
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
  });
}

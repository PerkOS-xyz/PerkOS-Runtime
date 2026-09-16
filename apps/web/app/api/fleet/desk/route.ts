import { loadSettings } from "../../../lib/settingsStore";
import { askOne, type FleetReply, type FleetRole } from "../../../lib/fleet";
import { contextFor, kbBusy } from "../../../lib/kb";
import { queryDeskKnowledge } from "../../../lib/knowledge";

// POST /api/fleet/desk { text, roles, quote? } -> SSE
// Turno de mesa: (Scout || Risk) -> (Trader || Auditor), cada uno con los
// handoffs anteriores en el prompt. Risk emite un VERDICT (GO/BLOCK) que
// decide si el draft del Trader sigue vivo. Eventos:
//   {step:"start", role} · {step:"reply", role, ok, reply, detail, ms, verdict?} · {step:"done"}
type Quote = { side: string; symbol: string; name: string; amountIn: string; tokenIn: string; quoteOut: string; tokenOut: string; priceUsd: number; pool: string; fee: number; poolUsdcDepth: number; minOut: string; bankr?: { priceUsd: number; outHuman: string; outSymbol: string; feeBps: number; priceImpactBps?: number } | null; venue?: string; venues?: Array<{ label: string; priceUsd: number; usdcDepth: number }> };

function verdictOf(reply: string): "GO" | "BLOCK" | undefined {
  const m = reply.match(/VERDICT\s*[:\-]\s*(GO|BLOCK)/i);
  if (m) return m[1].toUpperCase() as "GO" | "BLOCK";
  if (/\b(block|blocked|do not proceed|don't proceed|no-go)\b/i.test(reply)) return "BLOCK";
  return undefined;
}
const clip = (s: string, n = 700) => s.replace(/\s+/g, " ").trim().slice(0, n);

// Lint de calidad por turno: senales automaticas de donde mejorar (no bloquean).
// Se registran en ~/.perkos-floor/logs/desk-quality.jsonl con prompts y respuestas.
// `facts` es todo lo que el agente tuvo delante (quote, hechos, noticias,
// memoria): un porcentaje que sale de ahi no es invento.
function lintReplies(mode: string, facts: string, replies: FleetReply[]): string[] {
  const flags: string[] = [];
  const factPcts = new Set((facts.match(/-?\d+(?:\.\d+)?\s?%/g) ?? []).map((x) => Math.abs(parseFloat(x)).toFixed(1)));
  const known = new Set(["1.5", "0.1", "0.3", "1.0", "0.5", "2.0", "5.0", "10.0"]);
  const limits: Record<string, number> = { scout: 115, risk: 85, trader: 85, auditor: 115 };
  for (const r of replies) {
    if (!r.ok || !r.reply) { flags.push(`${r.role}:no-answer`); continue; }
    const t = r.reply;
    if (/market (is |was |remains )?(closed|shut)/i.test(t) && !/24\/7/.test(t)) flags.push(`${r.role}:says-market-closed`);
    if ((r.role === "scout" || r.role === "risk") && !/@(Trader|Auditor)/.test(t)) flags.push(`${r.role}:no-mention`);
    if ((r.role === "trader" || r.role === "auditor") && !/@Floor/.test(t)) flags.push(`${r.role}:no-mention`);
    const pcts = (t.match(/-?\d+(?:\.\d+)?\s?%/g) ?? []).map((x) => Math.abs(parseFloat(x)).toFixed(1));
    const unknown = [...new Set(pcts.filter((p) => !factPcts.has(p) && !known.has(p)))];
    if (unknown.length) flags.push(`${r.role}:pct-not-in-facts(${unknown.slice(0, 3).join(",")})`);
    // Tamano recomendado por encima del limite del desk (100 USDC): solo cuando
    // la cifra viene como recomendacion, no cuando describe la capacidad del pool.
    if (mode !== "order" && /\b(buy|size|clip|position|allocate|add|enter|start with|deploy)\b[^.\n]{0,40}?(\$\s?\d{2,3}\s?k\b|\b\d{2,3}\s?k\s?(usdc|usd)\b|\$\s?\d{4,}\b|\b[2-9]\d{2,}\s?usdc\b)/i.test(t)) flags.push(`${r.role}:size-over-limit`);
    const words = t.trim().split(/\s+/).length;
    if (words > (limits[r.role] ?? 100)) flags.push(`${r.role}:over-length(${words})`);
    if (mode !== "order" && (r.role === "scout" || r.role === "auditor") && !/\[(F\d+|N)\]/.test(t)) flags.push(`${r.role}:no-citation`);
    // Venue inventado: nombra Uniswap (o Aerodrome) cuando ningun hecho lo menciona.
    for (const v of ["Uniswap", "Aerodrome"]) if (new RegExp(`\\b${v}\\b`, "i").test(t) && !new RegExp(`\\b${v}\\b`, "i").test(facts)) flags.push(`${r.role}:venue-not-in-facts(${v})`);
    if (mode === "order" && r.role === "risk" && !/VERDICT:\s*(GO|BLOCK)/i.test(t)) flags.push("risk:no-verdict");
    if (mode !== "order" && r.role === "risk" && !/RISK:\s*(low|medium|high)/i.test(t)) flags.push("risk:no-risk-level");
  }
  return flags;
}
async function logDeskTurn(entry: Record<string, unknown>) {
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const dir = join(homedir(), ".perkos-floor", "logs");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(join(dir, "desk-quality.jsonl"), JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch (e) {
    console.warn("[desk] quality log failed:", (e as Error).message);
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; roles?: string[]; quote?: Quote | null; brief?: string[] | null; news?: string | null; mode?: string };
  // Modo de la mesa: "order" (hay una orden: pros/contras + gate + draft),
  // "analyze" (un activo: lectura, riesgo, plan si quisiera exposicion, registro),
  // "advise" (pregunta abierta: ranking sobre el scan del mercado con horizonte).
  const mode: "order" | "analyze" | "advise" = body.mode === "advise" ? "advise" : body.mode === "analyze" ? "analyze" : body.quote ? "order" : "analyze";
  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "text" }, { status: 400 });
  const ready = new Set((body.roles ?? []).filter((r): r is FleetRole => ["scout", "risk", "trader", "auditor"].includes(r)));
  kbBusy(true);
  const q = body.quote ?? null;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const wallet = s.wallet;
  const quoteLine = q
    ? `${q.venue ?? "Uniswap V3"} quote on Base (best venue the desk found): ${q.side} ${q.amountIn} ${q.tokenIn} -> ${q.quoteOut} ${q.tokenOut} (${q.name}) at $${q.priceUsd.toFixed(2)} per share, pool fee ${q.fee / 10_000}%, $${q.poolUsdcDepth.toFixed(0)} USDC depth.${q.venues && q.venues.length > 1 ? ` Other venue: ${q.venues.filter((v) => v.label !== q.venue).map((v) => `${v.label} $${v.priceUsd.toFixed(2)} per share ($${v.usdcDepth.toFixed(0)} USDC depth)`).join(", ")}.` : ""}${q.bankr ? ` Second quote from Bankr (read-only, it never executes): ${q.amountIn} ${q.tokenIn} -> ${q.bankr.outHuman} ${q.bankr.outSymbol || q.tokenOut} at $${q.bankr.priceUsd.toFixed(2)} per share, fee ${q.bankr.feeBps} bps${q.bankr.priceImpactBps !== undefined ? `, price impact ${q.bankr.priceImpactBps} bps` : ""}; Uniswap vs Bankr ${(((q.priceUsd / q.bankr.priceUsd) - 1) * 100).toFixed(2)}%.` : ""}`
    : "No order is on the table this turn.";
  // Lo que Floor ya sabe del activo (market brief on-chain + noticias con
  // fuentes): el equipo razona sobre numeros, no sobre la nada.
  // Presupuesto de prompt: el gateway (qwen2.5:7b, CPU) evalua ~50 tok/s;
  // 2 200 tokens = 43 s, 60 tokens = 1.5 s. Cada turno debe caber en
  // ~500 tokens sobre el system prompt de Hermes o el agente no llega.
  // Hechos numerados [F1]..[Fn]: Scout y Auditor citan la linea que sustenta
  // cada afirmacion; el log muestra si lo hicieron. Con DeepSeek cabe el scan
  // completo (10 activos con rango de 30 dias y valuacion) y sus noticias.
  const briefLines = Array.isArray(body.brief) ? body.brief.filter((l) => typeof l === "string").slice(0, mode === "advise" ? 24 : 9).map((l) => l.slice(0, mode === "advise" ? 620 : 320)) : [];
  const factsLine = briefLines.length ? `\nMarket facts the desk already verified, tagged for citation (use them, do not contradict them): ${briefLines.map((l, i) => `[F${i + 1}] ${l}`).join(" ")}` : "";
  const newsLine = typeof body.news === "string" && body.news.trim() ? `\n[N] News the desk found: ${body.news.trim().slice(0, mode === "order" ? 320 : mode === "advise" ? 3200 : 1200)}` : "";
  // DeepSeek evalua rapido: cabe mas conocimiento local (metodo del desk, venues, B20).
  const local = await contextFor(text, s.fleetTemplateId, q?.symbol?.replace(/c$/i, "") ?? undefined, mode === "order" ? 320 : 900).catch(() => ({ text: "", hits: [] }));
  const memoryLine = local.text ? `\nDesk memory: ${local.text.replace(/\n/g, " ")}` : "";
  // Conocimiento compartido (PerkOS Knowledge, floor/...): lo que otras
  // instalaciones y la plataforma saben; sin repetir lo que el vault ya trajo.
  const shared = mode === "order" ? null : await queryDeskKnowledge(`${text} ${q?.symbol ?? ""} tokenized stocks desk method venues sizing`, { limit: 8, maxChars: 1400, perRow: 700, signal: req.signal }).catch(() => null);
  const localTitles = new Set(local.hits.map((h) => h.title.toLowerCase()));
  const sharedRows = (shared?.rows ?? []).filter((r) => !localTitles.has(r.title.toLowerCase()) && !r.path.startsWith("floor/profiles/"));
  const sharedLine = sharedRows.length ? `\nShared desk knowledge (PerkOS Knowledge): ${sharedRows.slice(0, 3).map((r) => `${r.title}: ${r.summary.replace(/\s+/g, " ").slice(0, 500)}`).join(" | ")}` : "";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const replies: FleetReply[] = [];
      const turnStart = Date.now();
      const prompts: Record<string, string> = {};
      const run = async (role: FleetRole, prompt: string) => {
        prompts[role] = prompt;
        if (!ready.has(role)) { send({ step: "reply", role, ok: false, reply: "", detail: "agent not ready", ms: 0 }); return null; }
        send({ step: "start", role });
        const r = await askOne(wallet, role, prompt, 55_000, req.signal);
        replies.push(r);
        // Solo hay veredicto cuando hay una orden; en analyze/advise "block" es lenguaje, no decision.
        const verdict = mode === "order" && role === "risk" && r.ok ? verdictOf(r.reply) : undefined;
        send({ step: "reply", ...r, ...(verdict ? { verdict } : {}) });
        return r;
      };
      try {
        // "Answer from the facts": sin esta linea Hermes abre skills
        // (skill_view b20-console/bankr) y tarda 2-3 min por reintento;
        // la mesa ya trae precio, Chainlink, pool, noticias y memoria.
        const deskRules = mode === "order"
          ? " A draft of that order is already on the table, unsigned; the human signs it or not."
          : " Desk limits: the human trades small clips (an order is at most 100 USDC); size advice must be in USDC for this human, never in the pool's scale. The horizon is the one in the request; a catalyst after the horizon does not count as the reason.";
        const always = " These tokens trade 24/7 onchain; only the Chainlink reference pauses outside US equity hours, so never say the market is closed: say the reference is frozen and compare with the last close.";
        const head = `Human request to the desk: "${text}". ${quoteLine}${deskRules}${always}${factsLine}${newsLine}${memoryLine}${sharedLine}\nAnswer directly from the facts above in one message. Do not open skills, files or tools for this reply; the desk already fetched the market data. If something is missing, say so in one line and continue.`;
        // Hermes tarda 20-60 s por turno en frio: Scout y Risk corren en
        // paralelo (Risk ya tiene la cotizacion; Scout le suma evidencia si
        // llega), y despues Trader y Auditor con ambos handoffs.
        const P = {
          order: {
            scout: `As Scout: the order is already decided, so no market read. Give one line of pros and one line of cons for doing it right now, from the facts (price vs reference, venue depth, off-hours drift, any catalyst). Open with "@Trader @Auditor". Under 45 words, plain text.`,
            risk: `As Risk: size and limits for this desk. Compare the desk's best venue quote with the other venue, with Bankr's second quote and with the Chainlink reference price in the facts; if any pair diverges beyond 1.5%, the pool is thin for the size, or the request is unclear, block. Reply with a first line exactly "VERDICT: GO" or "VERDICT: BLOCK", then a second line starting "@Trader @Auditor" with the reason in under 40 words.`
          },
          analyze: {
            scout: `As Scout: read the verified facts and the news, then give the desk your read: the underlying driver first (what moved the stock, next catalyst), then the onchain layer (pool price vs Chainlink, depth, 30-day range, off-hours drift). Percentages must be computed correctly from the numbers given. Do not repeat the numbers back; interpret them, and tag each claim with the fact it rests on, like [F3] or [N]. Open with "@Trader @Auditor". Under 70 words, plain text.`,
            risk: `As Risk: there is no order on the table, so no GO or BLOCK. Reply with a first line exactly "RISK: low", "RISK: medium" or "RISK: high", then "@Trader @Auditor" and: what size is safe (as a share of the pool depth), what would make you block an order, and what to check at the next market open if the Chainlink feed is frozen. Under 50 words.`
          },
          advise: {
            scout: `As Scout: the human asks what to buy for the horizon in the request. Using the market lines (price, 30-day range, valuation, next earnings) and the news, rank the candidates: name the top two with the reason for each (a catalyst inside the horizon, or a setup versus the 30-day range and the reference price, at a valuation you can defend), and name one to avoid and why. Tag each claim with the fact it rests on, like [F3] or [N]. Open with "@Trader @Auditor". Under 100 words, plain text.`,
            risk: `As Risk: for the two candidates the desk will likely pick, give the size each pool can absorb without impact (a share of the pool depth), an exit rule (take profit level or time), and what would flip each to avoid. Reply with a first line exactly "RISK: low", "RISK: medium" or "RISK: high", then "@Trader @Auditor" and the rules. Under 70 words.`
          }
        }[mode];
        const [scout, risk] = await Promise.all([
          run("scout", `${head}\n${P.scout}`),
          run("risk", `${head}\n${P.risk}`)
        ]);
        const scoutSaid = scout?.ok ? clip(scout.reply) : "(Scout did not answer)";
        const riskSaid = risk?.ok ? clip(risk.reply) : "(Risk did not answer)";
        const verdict = mode === "order" ? (risk?.ok ? verdictOf(risk.reply) ?? "GO" : "BLOCK") : undefined;
        const tail = `${head}\nScout said: ${scoutSaid}\nRisk said: ${riskSaid}${verdict ? ` (verdict ${verdict})` : ""}.`;
        const T = mode === "order"
          ? `As Trader (open with "@Floor"): ${q ? (verdict === "GO" ? "restate the order the desk drafted (asset, size, venue, min out) and exactly what the human must sign. You never execute." : "Risk blocked it: stand down and say what would need to change. You never execute.") : "no order is on the table: say what you would draft if asked, in one line. You never execute."} Under 60 words.`
          : mode === "analyze"
            ? `As Trader (open with "@Floor"): if the human wanted exposure to this stock, give the entry plan: venue, size in USDC as a share of the pool, take profit level, and a stop or a time exit; or say why you would wait and for what. You never execute. Under 60 words.`
            : `As Trader (open with "@Floor"): entry plan for the top pick the desk is converging on: the venue named in that stock's fact line (Aerodrome or Uniswap, never assume), size in USDC, take profit level, stop or time exit, and when you would add the second pick. You never execute. Under 70 words.`;
        const A = mode === "order"
          ? `As Auditor (open with "@Floor"): write the decision record for this turn: what was asked, what Scout found, Risk's verdict, the draft on the table (or none) and what evidence is missing. Under 80 words.`
          : mode === "analyze"
            ? `As Auditor (open with "@Floor"): write the analysis record: the thesis in one line, the evidence that supports it with its tags like [F2], the main risk, and what to check next (date or event). Under 80 words.`
            : `As Auditor (open with "@Floor"): write the dated outlook record: the picks with their reasons and fact tags like [F2], the one to avoid, the risk rules, and the review date one month out. Under 100 words.`;
        await Promise.all([
          run("trader", `${tail}\n${T}`),
          run("auditor", `${tail}\n${A}`)
        ]);
        const flags = lintReplies(mode, `${quoteLine}${factsLine}${newsLine}${memoryLine}${sharedLine}`, replies);
        void logDeskTurn({ at: new Date().toISOString(), mode, text, ms: Date.now() - turnStart, verdict: verdict ?? null, flags, quote: q ? { side: q.side, symbol: q.symbol, priceUsd: q.priceUsd, venue: q.venue ?? null, bankr: q.bankr?.priceUsd ?? null } : null, facts: briefLines, news: newsLine.slice(0, 1200), memory: memoryLine.slice(0, 1200), shared: sharedLine.slice(0, 1200), prompts, replies: replies.map((r) => ({ role: r.role, ok: r.ok, ms: r.ms, reply: r.reply, detail: r.detail })) });
        send({ step: "done", verdict, replies, flags });
      } catch (e) {
        send({ step: "error", detail: (e as Error).message });
      } finally {
        kbBusy(false);
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

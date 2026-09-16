import { loadSettings } from "../../../lib/settingsStore";
import { askOne, type FleetReply, type FleetRole } from "../../../lib/fleet";
import { contextFor } from "../../../lib/kb";

// POST /api/fleet/desk { text, roles, quote? } -> SSE
// Turno de mesa: (Scout || Risk) -> (Trader || Auditor), cada uno con los
// handoffs anteriores en el prompt. Risk emite un VERDICT (GO/BLOCK) que
// decide si el draft del Trader sigue vivo. Eventos:
//   {step:"start", role} · {step:"reply", role, ok, reply, detail, ms, verdict?} · {step:"done"}
type Quote = { side: string; symbol: string; name: string; amountIn: string; tokenIn: string; quoteOut: string; tokenOut: string; priceUsd: number; pool: string; fee: number; poolUsdcDepth: number; minOut: string };

function verdictOf(reply: string): "GO" | "BLOCK" | undefined {
  const m = reply.match(/VERDICT\s*[:\-]\s*(GO|BLOCK)/i);
  if (m) return m[1].toUpperCase() as "GO" | "BLOCK";
  if (/\b(block|blocked|do not proceed|don't proceed|no-go)\b/i.test(reply)) return "BLOCK";
  return undefined;
}
const clip = (s: string, n = 700) => s.replace(/\s+/g, " ").trim().slice(0, n);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; roles?: string[]; quote?: Quote | null; brief?: string[] | null; news?: string | null };
  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "text" }, { status: 400 });
  const ready = new Set((body.roles ?? []).filter((r): r is FleetRole => ["scout", "risk", "trader", "auditor"].includes(r)));
  const q = body.quote ?? null;
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const wallet = s.wallet;
  const quoteLine = q
    ? `The desk's Uniswap V3 quote on Base: ${q.side} ${q.amountIn} ${q.tokenIn} -> ${q.quoteOut} ${q.tokenOut} (${q.name}, ${q.symbol}) at $${q.priceUsd.toFixed(2)} per share, pool ${q.pool.slice(0, 8)} fee ${q.fee / 10_000}% with $${q.poolUsdcDepth.toFixed(0)} USDC of depth, min out ${q.minOut}.`
    : "No order is on the table this turn.";
  // Lo que Floor ya sabe del activo (market brief on-chain + noticias con
  // fuentes): el equipo razona sobre numeros, no sobre la nada.
  const briefLines = Array.isArray(body.brief) ? body.brief.filter((l) => typeof l === "string").slice(0, 12).map((l) => l.slice(0, 300)) : [];
  const factsLine = briefLines.length ? `\nMarket facts the desk already verified (use them, do not contradict them): ${briefLines.join(" ")}` : "";
  const newsLine = typeof body.news === "string" && body.news.trim() ? `\nNews the desk found (with sources): ${body.news.trim().slice(0, 900)}` : "";
  const local = await contextFor(text, s.fleetTemplateId, q?.symbol?.replace(/c$/i, "") ?? undefined, 1400).catch(() => ({ text: "", hits: [] }));
  const memoryLine = local.text ? `\nWhat this desk already knows from earlier sessions (local notes, dated): ${local.text.replace(/\n/g, " ")}` : "";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const replies: FleetReply[] = [];
      const run = async (role: FleetRole, prompt: string) => {
        if (!ready.has(role)) { send({ step: "reply", role, ok: false, reply: "", detail: "agent not ready", ms: 0 }); return null; }
        send({ step: "start", role });
        const r = await askOne(wallet, role, prompt, 55_000, req.signal);
        replies.push(r);
        const verdict = role === "risk" && r.ok ? verdictOf(r.reply) : undefined;
        send({ step: "reply", ...r, ...(verdict ? { verdict } : {}) });
        return r;
      };
      try {
        const head = `Human request to the desk: "${text}". ${quoteLine}${factsLine}${newsLine}${memoryLine}`;
        // Hermes tarda 20-60 s por turno en frio: Scout y Risk corren en
        // paralelo (Risk ya tiene la cotizacion; Scout le suma evidencia si
        // llega), y despues Trader y Auditor con ambos handoffs.
        const [scout, risk] = await Promise.all([
          run("scout", `${head}\nAs Scout: read the verified facts and the news, then give the desk your read: what stands out (price vs Chainlink, 24h move and range, pool depth, catalysts) and one thing to watch. Do not repeat the numbers back; interpret them. Under 80 words, plain text.`),
          run("risk", `${head}\nAs Risk: size and limits for this desk. Compare the desk's Uniswap quote with any second price you can get; if they diverge beyond 1.5%, the pool is thin for the size, or the request is unclear, block. Reply with a first line exactly "VERDICT: GO" or "VERDICT: BLOCK", then the reason in under 60 words.`)
        ]);
        const scoutSaid = scout?.ok ? clip(scout.reply) : "(Scout did not answer)";
        const riskSaid = risk?.ok ? clip(risk.reply) : "(Risk did not answer)";
        const verdict = risk?.ok ? verdictOf(risk.reply) ?? "GO" : "BLOCK";
        const tail = `${head}\nScout said: ${scoutSaid}\nRisk said: ${riskSaid} (verdict ${verdict}).`;
        await Promise.all([
          run("trader", `${tail}\nAs Trader: ${q ? (verdict === "GO" ? "restate the order the desk drafted (asset, size, route, min out) and exactly what the human must sign. You never execute." : "Risk blocked it: stand down and say what would need to change.") : "no order is on the table: say what you would draft if asked, in one line."} Under 60 words.`),
          run("auditor", `${tail}\nAs Auditor: write the decision record for this turn: what was asked, what Scout found, Risk's verdict, the draft on the table (or none) and what evidence is missing. Under 80 words.`)
        ]);
        send({ step: "done", verdict, replies });
      } catch (e) {
        send({ step: "error", detail: (e as Error).message });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

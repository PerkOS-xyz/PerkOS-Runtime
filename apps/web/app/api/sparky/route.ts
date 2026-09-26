import { guard } from "../../lib/guard";
import { journalEntry } from "../../lib/journal";
import { memoryFor, recallScopes, scopeFor } from "../../lib/memory";
import { defaultRegistry } from "../../lib/models";
import { askedAbout, marketFacts } from "../../lib/marketFacts";
import { cachedDesks, cachedMarket, deskSeries } from "../../lib/perkos";
import { settings } from "../../lib/settings";
import { cleanMessages, sparkyPrompt, startReply, tapReply, withMemory } from "../../lib/sparky";
import { sessionWallet } from "../../lib/vault";

// A desk that is slow to answer does not hold up the reply: Sparky answers without its facts.
const FACTS_MS = 3500;

const within = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** The open desk's market facts for this question: the assets it trades and the prices asked about. */
async function deskFacts(name: string, module: string, question: string): Promise<string> {
  const market = await cachedMarket(module);
  if (!market) return "";
  const series = await deskSeries(module, askedAbout(question, market.assets).map((a) => a.ticker));
  return marketFacts(name, market, question, series);
}

// POST { messages, desk? } -> Sparky's reply as a plain text stream. `desk` is the id of the open desk.
// In a desk with a market, Sparky gets that market's facts. With memory on, Sparky gets the relevant
// notes and the exchange is added to the journal of the open desk, or of the person when no desk is open.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; desk?: unknown };
  const messages = cleanMessages(body.messages);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return Response.json({ error: "A user message is required" }, { status: 400 });
  }
  const { model } = await settings.load();
  if (!model) return Response.json({ error: "no_model", message: "Choose a model first." }, { status: 409 });
  try {
    const desks = await cachedDesks();
    const desk = typeof body.desk === "string" ? body.desk : undefined;
    const open = desk ? desks.find((d) => d.id === desk) : undefined;
    const notes = await memoryFor(await sessionWallet());
    const [recall, facts] = await Promise.all([
      notes ? notes.contextFor(last.content, recallScopes(desk, desks.map((d) => d.id))).catch(() => "") : "",
      open?.module ? within(deskFacts(open.name, open.module, last.content), FACTS_MS, "") : "",
    ]);
    const system = [sparkyPrompt(desks, open), facts].filter(Boolean).join("\n\n");
    const stream = await startReply(defaultRegistry(), model, messages, withMemory(system, recall));
    const reply = notes
      ? tapReply(stream, (text) => {
          if (!text.trim()) return;
          notes.appendJournal(scopeFor(desk), journalEntry(last.content, text)).catch((err: Error) => {
            console.warn(`Sparky's journal was not saved: ${err.message}`);
          });
        })
      : stream;
    return new Response(reply, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: "model_failed", message: (err as Error).message }, { status: 502 });
  }
}

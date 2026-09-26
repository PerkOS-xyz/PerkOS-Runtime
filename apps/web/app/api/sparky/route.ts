import type { NoteStore } from "@perkos/vault";

import { guard } from "../../lib/guard";
import { journalEntry } from "../../lib/journal";
import { memoryFor, recallScopes, scopeFor } from "../../lib/memory";
import { defaultRegistry } from "../../lib/models";
import { askedAbout, marketFacts } from "../../lib/marketFacts";
import { cachedDesks, cachedMarket, deskSeries } from "../../lib/perkos";
import { settings } from "../../lib/settings";
import { answering, cleanMessages, sparkyPrompt, startReply, tapReply, withMemory, withTeam, withTeamNotes, withWarmUp } from "../../lib/sparky";
import { isTurnId, type TurnRecord } from "../../lib/turnRecord";
import { getTurn, setTurnSummary } from "../../lib/turnStore";
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

/** A desk turn of this wallet on the open desk, or null. A turn of another desk is not read here. */
async function deskTurn(wallet: string | null, id: unknown, desk: string | undefined, notes: NoteStore | null): Promise<TurnRecord | null> {
  if (!wallet || !desk || !isTurnId(id)) return null;
  const turn = await getTurn(wallet, id, notes).catch(() => null);
  return turn?.desk === desk ? turn : null;
}

// POST { messages, desk?, turn?, about?, ask?, warm? } -> Sparky's reply as a plain text stream. `desk` is the
// id of the open desk. In a desk with a market, Sparky gets that market's facts. With memory on, Sparky gets
// the relevant notes and the exchange is added to the journal of the open desk, or of the person when no desk is open.
//   turn: a desk turn of the open desk that just ended. Sparky sums up what the team said, and the summary is
//         kept with the turn, with memory on or off. The turn's question is the one answered, whatever the
//         person asked Sparky meanwhile. An unknown turn is ignored.
//   about: the desk's last turn, for questions about what the team said.
//   ask: the question Sparky answers when the conversation may not end with it.
//   warm: with `ask`, Sparky's first words while the team wakes. They are not added to the journal.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; desk?: unknown; turn?: unknown; about?: unknown; ask?: unknown; warm?: unknown };
  const desk = typeof body.desk === "string" ? body.desk : undefined;
  const wallet = await sessionWallet();
  const notes = await memoryFor(wallet).catch(() => null);
  const summary = await deskTurn(wallet, body.turn, desk, notes);
  const recent = summary ? null : await deskTurn(wallet, body.about, desk, notes);
  const ask = typeof body.ask === "string" ? body.ask : "";
  const warm = !summary && body.warm === true && ask.trim() !== "";
  const messages = answering(cleanMessages(body.messages), summary?.question ?? ask);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return Response.json({ error: "A user message is required" }, { status: 400 });
  }
  const { model } = await settings.load();
  if (!model) return Response.json({ error: "no_model", message: "Choose a model first." }, { status: 409 });
  try {
    const desks = await cachedDesks();
    const open = desk ? desks.find((d) => d.id === desk) : undefined;
    const [recall, facts] = await Promise.all([
      notes ? notes.contextFor(last.content, recallScopes(desk, desks.map((d) => d.id))).catch(() => "") : "",
      open?.module ? within(deskFacts(open.name, open.module, last.content), FACTS_MS, "") : "",
    ]);
    const system = [sparkyPrompt(desks, open), facts].filter(Boolean).join("\n\n");
    let prompt = withMemory(system, recall);
    if (summary) prompt = withTeam(prompt, summary);
    else if (warm) prompt = withWarmUp(prompt);
    else if (recent) prompt = withTeamNotes(prompt, recent);
    const stream = await startReply(defaultRegistry(), model, messages, prompt);
    const journal = warm ? null : notes;
    const reply =
      journal || summary
        ? tapReply(stream, (text) => {
            if (!text.trim()) return;
            if (summary && wallet) {
              setTurnSummary(wallet, summary.id, text, notes).catch((err: Error) => {
                console.warn(`Sparky's summary was not kept with the turn: ${err.message}`);
              });
            }
            journal?.appendJournal(scopeFor(desk), journalEntry(last.content, text)).catch((err: Error) => {
              console.warn(`Sparky's journal was not saved: ${err.message}`);
            });
          })
        : stream;
    return new Response(reply, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: "model_failed", message: (err as Error).message }, { status: 502 });
  }
}

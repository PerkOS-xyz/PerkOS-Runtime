import { Desks } from "@perkos/client";

import { runDeskTurn } from "../../../lib/deskTurn";
import { guard } from "../../../lib/guard";
import { memoryFor } from "../../../lib/memory";
import { cachedDesks, perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";
import { isTurnKind, newTurnId, type TurnEvent } from "../../../lib/turnRecord";
import { claimTurn, releaseTurn } from "../../../lib/turnStore";
import { TURN_ERRORS } from "../../../lib/turnTeam";
import { sessionWallet } from "../../../lib/vault";

const DESK = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TICKER = /^[A-Za-z0-9.]{1,16}$/;
const MAX_TEXT = 2_000;
const MAX_TICKERS = 5;

const bad = (error: string, message: string, status = 400) => Response.json({ error, message }, { status });

// POST { desk, text, kind: "analyze" | "advise" | "order", tickers? } -> text/event-stream of desk turn events,
// one `data: <json>\n\n` frame each (see lib/turnRecord.ts). The team is woken only when part of it sleeps.
// 400 bad input, 401 signed out, 404 when the desk does not run that kind of turn, 409 while a turn is live.
// Closing the stream stops waiting for the team; PerkOS cannot cancel a task, so an agent may still finish.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { desk?: unknown; text?: unknown; kind?: unknown; tickers?: unknown };
  const desk = typeof body.desk === "string" ? body.desk.trim() : "";
  if (!DESK.test(desk)) return bad("desk", "Which desk?");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT) return bad("text", `Ask the desk something, in up to ${MAX_TEXT} characters.`);
  if (!isTurnKind(body.kind)) return bad("kind", "Which kind of turn?");
  const kind = body.kind;
  let tickers: string[] | undefined;
  if (body.tickers !== undefined) {
    if (!Array.isArray(body.tickers) || body.tickers.length > MAX_TICKERS || !body.tickers.every((t) => typeof t === "string" && TICKER.test(t))) {
      return bad("tickers", `Up to ${MAX_TICKERS} tickers.`);
    }
    tickers = body.tickers as string[];
  }

  const wallet = await sessionWallet();
  const client = wallet ? await perkosClient() : null;
  if (!wallet || !client) return bad("signed_out", TURN_ERRORS.SIGNED_OUT, 401);

  const summary = (await cachedDesks()).find((d) => d.id === desk);
  if (!summary) return bad("desk", "This desk is not available right now.", 404);
  const module = summary.module;
  if (!module) return bad("no_turn", "This desk does not run that kind of turn.", 404);
  let manifest;
  try {
    manifest = await new Desks(client).manifest(module);
  } catch (err) {
    return errorResponse(err);
  }
  if (!manifest?.turns[kind]) return bad("no_turn", "This desk does not run that kind of turn.", 404);

  const id = newTurnId();
  if (!claimTurn(wallet, desk, id)) return bad("turn_live", "The team is still on the last question.", 409);

  const notes = await memoryFor(wallet).catch(() => null);
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  if (req.signal.aborted) stop.abort();
  else req.signal.addEventListener("abort", onAbort, { once: true });

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: TurnEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      void runDeskTurn({ id, wallet, desk: { ...summary, module }, manifest, kind, question: text, ...(tickers ? { tickers } : {}), client, notes, signal: stop.signal, emit })
        .catch((err: Error) => emit({ step: "error", code: "INTERNAL", message: `${TURN_ERRORS.INTERNAL} ${err.message}` }))
        .finally(() => {
          releaseTurn(wallet, desk, id);
          req.signal.removeEventListener("abort", onAbort);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // Already closed by the window.
            }
          }
        });
    },
    cancel() {
      open = false;
      stop.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

import { isScope, localDay } from "@perkos/vault";

import { guard } from "../../../lib/guard";
import { memoryFor } from "../../../lib/memory";
import { defaultRegistry } from "../../../lib/models";
import { settings } from "../../../lib/settings";
import { pendingDays, summarizeDay, type SummaryResult } from "../../../lib/summary";
import { sessionWallet } from "../../../lib/vault";

// POST { scope?, date?, force? } -> { results: [SummaryResult] }  one day of one scope, today by default
// POST { pending: true }          -> { results }                   earlier days without a summary, up to three
// 401 signed out, 423 memory off, 409 no model, 502 when the model does not answer.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out" }, { status: 401 });
  const notes = await memoryFor(wallet);
  if (!notes) return Response.json({ error: "locked" }, { status: 423 });
  const { model } = await settings.load();
  if (!model) return Response.json({ error: "no_model", message: "Choose a model first." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { scope?: unknown; date?: unknown; force?: unknown; pending?: unknown };
  const days =
    body.pending === true
      ? await pendingDays(notes)
      : [
          {
            scope: typeof body.scope === "string" && isScope(body.scope) ? body.scope : "user",
            date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : localDay(new Date()),
          },
        ];

  const registry = defaultRegistry();
  const results: SummaryResult[] = [];
  try {
    // One at a time: each day is one model call on the person's own account.
    for (const d of days) results.push(await summarizeDay(notes, registry, model, d.scope, d.date, body.force === true));
  } catch (err) {
    return Response.json({ error: "model_failed", message: (err as Error).message, results }, { status: 502 });
  }
  return Response.json({ results });
}

import { guard } from "../../../lib/guard";
import { memoryFor } from "../../../lib/memory";
import { isTurnId, type TurnRecord, type TurnRow } from "../../../lib/turnRecord";
import { forgetTurn, getTurn, listTurns, liveTurn } from "../../../lib/turnStore";
import { sessionWallet } from "../../../lib/vault";

const DESK = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A row for History's list. */
function row(t: TurnRecord): TurnRow {
  return {
    id: t.id,
    kind: t.kind,
    question: t.question,
    startedAt: t.startedAt,
    ms: t.ms,
    ...(t.riskLevel ? { riskLevel: t.riskLevel } : {}),
    ...(t.verdict ? { verdict: t.verdict } : {}),
    flags: t.flags.length,
    failed: t.replies.filter((r) => !r.ok).map((r) => r.role),
    signed: Boolean(t.receipt),
    ...(t.stopped ? { stopped: true } : {}),
    ...(t.error ? { error: t.error.code } : {}),
  };
}

// The desk turns History shows.
//   GET ?desk=<id>&limit=40 -> { memory: "on" | "off", live: <turn id> | null, turns: [row] }  newest first
//   GET ?id=<turn id>       -> { turn }
// With memory off, only this session's turns are there. 401 signed out, 404 unknown turn.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  const notes = await memoryFor(wallet).catch(() => null);
  const params = new URL(req.url).searchParams;

  const id = params.get("id");
  if (id !== null) {
    const turn = isTurnId(id) ? await getTurn(wallet, id, notes) : null;
    return turn ? Response.json({ turn }) : Response.json({ error: "not_found" }, { status: 404 });
  }

  const desk = params.get("desk")?.trim() ?? "";
  if (!DESK.test(desk)) return Response.json({ error: "desk", message: "Which desk?" }, { status: 400 });
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 40));
  const turns = await listTurns(wallet, desk, notes, limit);
  return Response.json({ memory: notes ? "on" : "off", live: liveTurn(wallet, desk), turns: turns.map(row) });
}

// DELETE ?id=<turn id> -> { ok: true }. Forgets a turn for good: this session's copy, and the vault's while memory is on.
// 401 signed out, 404 unknown turn. A live turn is not kept yet, so it is not found.
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  const notes = await memoryFor(wallet).catch(() => null);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const gone = isTurnId(id) && (await forgetTurn(wallet, id, notes));
  return gone ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
}

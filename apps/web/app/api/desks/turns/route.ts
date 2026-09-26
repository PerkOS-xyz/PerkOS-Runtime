import { guard } from "../../../lib/guard";
import { memoryFor } from "../../../lib/memory";
import { isTurnId, type TurnReceipt, type TurnRecord, type TurnRow } from "../../../lib/turnRecord";
import { forgetTurn, getTurn, listTurns, liveTurn, setTurnReceipt } from "../../../lib/turnStore";
import { sessionWallet } from "../../../lib/vault";

const DESK = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^0x[0-9a-fA-F]{1,64}$/;
const TICKER = /^[A-Za-z0-9.\-]{1,16}$/;
const AMOUNT = /^\d{1,7}(\.\d{1,6})?$/;
const SWAP_STATUSES: readonly TurnReceipt["status"][] = ["success", "pending", "reverted"];

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
    ...(t.receipt ? { receipt: { ticker: t.receipt.ticker, amount: t.receipt.amount, status: t.receipt.status } } : {}),
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

/** A link the turn may keep: History draws it, so only an https page. */
function pageUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** The receipt the window sends, as the turn keeps it, or null when it does not read as one. The time is this machine's. */
function receiptOf(v: unknown, at: Date): TurnReceipt | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const status = SWAP_STATUSES.find((s) => s === r.status);
  const { hash, ticker, amount } = r;
  if (!status || typeof hash !== "string" || !HASH.test(hash) || typeof ticker !== "string" || !TICKER.test(ticker) || typeof amount !== "string" || !AMOUNT.test(amount)) {
    return null;
  }
  const explorerUrl = pageUrl(r.explorerUrl);
  return { hash, ...(explorerUrl ? { explorerUrl } : {}), status, ticker, amount, at: at.toISOString() };
}

// PATCH ?id=<turn id> { receipt: { hash, status, ticker, amount, explorerUrl? } } -> { ok: true }
//   Keeps the receipt of the order the person approved from this turn's plan, so History shows the turn
//   signed and Memory reads it. A turn keeps one receipt: the same swap may come again with where it
//   stands now, another swap is a 409. 400 a receipt that does not read, 401 signed out, 404 unknown turn.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const wallet = await sessionWallet();
  if (!wallet) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { receipt?: unknown };
  const receipt = receiptOf(body.receipt, new Date());
  if (!receipt) return Response.json({ error: "receipt", message: "A receipt needs the swap's hash, where it stands, the stock and the amount." }, { status: 400 });
  const notes = await memoryFor(wallet).catch(() => null);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const turn = isTurnId(id) ? await getTurn(wallet, id, notes) : null;
  if (!turn) return Response.json({ error: "not_found" }, { status: 404 });
  if (turn.receipt && turn.receipt.hash.toLowerCase() !== receipt.hash.toLowerCase()) {
    return Response.json({ error: "signed", message: "This turn already keeps the receipt of another order." }, { status: 409 });
  }
  await setTurnReceipt(wallet, id, receipt, notes);
  return Response.json({ ok: true });
}

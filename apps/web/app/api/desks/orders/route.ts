import { DeskOrders, type PreparedOrder } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;
const UINT = /^\d{1,78}$/;

// POST { module, step: "prepare", strategyId, amountIn, signal } -> { order }
//   the desk's quote, route and risk co-signature for one order; nothing is sent.
// POST { module, step: "execute", order, reason } -> { receipt }
//   sends that order from the owner's delegated wallet. The desk calls this
//   only after the person holds to approve.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const module = typeof body.module === "string" ? body.module.trim() : "";
  if (!MODULE.test(module)) return Response.json({ error: "module", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  const orders = new DeskOrders(client);
  try {
    if (body.step === "prepare") {
      const { strategyId, amountIn, signal } = body;
      if (typeof strategyId !== "string" || !UINT.test(strategyId) || typeof amountIn !== "string" || !UINT.test(amountIn) || typeof signal !== "string" || !signal.trim()) {
        return Response.json({ error: "input", message: "strategyId, amountIn and signal are required." }, { status: 400 });
      }
      return Response.json({ order: await orders.prepare(module, { strategyId, amountIn, signal: signal.trim().slice(0, 2000) }) });
    }
    if (body.step === "execute") {
      const order = body.order as PreparedOrder | undefined;
      if (!order || typeof order !== "object" || !order.execution || typeof order.routerCalldata !== "string" || typeof order.signature !== "string") {
        return Response.json({ error: "input", message: "The prepared order is required." }, { status: 400 });
      }
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : "";
      return Response.json({ receipt: await orders.execute(module, order, reason) });
    }
    return Response.json({ error: "step", message: "step is prepare or execute." }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

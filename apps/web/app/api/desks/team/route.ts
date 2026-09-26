import { Agents, Team } from "@perkos/client";

import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const DESK = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function team(req: Request, desk: string, wake: boolean) {
  const denied = guard(req);
  if (denied) return denied;
  if (!DESK.test(desk)) return Response.json({ error: "desk", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const t = new Team(client);
    return Response.json({ team: wake ? await t.wake(desk) : await t.status(desk) });
  } catch (err) {
    return errorResponse(err);
  }
}

// GET ?desk=<desk id> -> { team }: where the desk's team stands. Launches nothing.
export async function GET(req: Request) {
  return team(req, new URL(req.url).searchParams.get("desk")?.trim() ?? "", false);
}

// PUT { desk } -> { touched }: tells PerkOS the desk's awake agents are in use, so
// they do not go to sleep while the person has the desk open. Wakes nothing.
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { desk?: unknown };
  const desk = typeof body.desk === "string" ? body.desk.trim() : "";
  if (!DESK.test(desk)) return Response.json({ error: "desk", message: "Which desk?" }, { status: 400 });
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    const status = await new Team(client).status(desk);
    const agents = new Agents(client);
    const awake = status.agents.filter((a) => a.state === "ready" && a.agentId);
    const done = await Promise.allSettled(awake.map((a) => agents.touch(a.agentId!)));
    return Response.json({ touched: done.filter((d) => d.status === "fulfilled").length });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST { desk } -> { team }: creates the missing agents and wakes the sleeping ones,
// billed to the person's desk time; PerkOS answers 402 without it.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { desk?: unknown };
  return team(req, typeof body.desk === "string" ? body.desk.trim() : "", true);
}

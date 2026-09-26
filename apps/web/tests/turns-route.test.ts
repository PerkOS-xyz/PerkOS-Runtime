/**
 * /api/desks/turns: the turns History lists and replays.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "../app/api/desks/turns/route";
import type { TurnRecord } from "../app/lib/turnRecord";
import { claimTurn, clearSessionTurns, saveTurn } from "../app/lib/turnStore";

const WALLET = "0xabc0000000000000000000000000000000000009";
const get = async (query: string, host = "127.0.0.1:3100") => {
  const res = await GET(new Request(`http://127.0.0.1:3100/api/desks/turns${query}`, { headers: { host } }));
  return { status: res.status, body: await res.json() };
};
const record = (id: string, extra: Partial<TurnRecord> = {}): TurnRecord => ({
  v: 1,
  id,
  desk: "eqlty-desk",
  module: "stocks-robinhood",
  kind: "advise",
  question: "What should I buy this month?",
  principal: "@Scout @Risk What should I buy this month?",
  startedAt: new Date(Date.parse("2026-09-26T14:00:00.000Z") + Number(id.slice(11, 13)) * 60_000).toISOString(),
  endedAt: "2026-09-26T15:00:00.000Z",
  ms: 71_400,
  facts: [],
  memory: "",
  head: "",
  prompts: {},
  replies: [
    { role: "scout", phase: 1, ok: true, reply: "@Trader NVDA [F1].", ms: 1 },
    { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries", ms: 1 },
  ],
  guests: [],
  riskLevel: "medium",
  flags: ["auditor:no-answer"],
  trace: [],
  ...extra,
});

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet: WALLET, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
});
afterEach(async () => {
  clearSessionTurns();
  delete process.env.PERKOS_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("/api/desks/turns", () => {
  it("lists a desk's turns newest first, and says memory is off", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    await saveTurn(WALLET, record("20260926-142000-cd34", { stopped: true, receipt: { hash: "0x1", status: "success", ticker: "NVDA", amount: "50", at: "x" } }), null);
    await saveTurn(WALLET, record("20260926-143000-ef56", { desk: "other-desk" }), null);
    claimTurn(WALLET, "eqlty-desk", "20260926-150000-0000");
    const { status, body } = await get("?desk=eqlty-desk");
    expect(status).toBe(200);
    expect(body.memory).toBe("off");
    expect(body.live).toBe("20260926-150000-0000");
    expect(body.turns.map((t: { id: string }) => t.id)).toEqual(["20260926-142000-cd34", "20260926-141000-ab12"]);
    expect(body.turns[0]).toMatchObject({ kind: "advise", riskLevel: "medium", flags: 1, failed: ["auditor"], signed: true, stopped: true });
    expect(body.turns[1]).toMatchObject({ signed: false });
    expect(body.turns[1]).not.toHaveProperty("stopped");
  });

  it("returns a whole turn by id, and 404 for one it does not know", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    const { body } = await get("?id=20260926-141000-ab12");
    expect(body.turn.replies[1]).toMatchObject({ failure: "model", detail: "API call failed after 3 retries" });
    expect((await get("?id=20260926-000000-0000")).status).toBe(404);
    expect((await get("?id=../../session")).status).toBe(404);
  });

  it("asks which desk, refuses outside callers and answers 401 signed out", async () => {
    expect((await get("?desk=Bad Desk")).status).toBe(400);
    expect((await get("?desk=eqlty-desk", "evil.example")).status).toBe(403);
    await rm(join(home, "session.json"));
    expect((await get("?desk=eqlty-desk")).status).toBe(401);
  });
});

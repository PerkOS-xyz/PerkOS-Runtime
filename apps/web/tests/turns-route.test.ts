/**
 * /api/desks/turns: the turns History lists and replays.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET, PATCH } from "../app/api/desks/turns/route";
import { DELETE as LOCK, POST as UNLOCK } from "../app/api/vault/route";
import { closeMemory, memoryFor } from "../app/lib/memory";
import type { TurnRecord } from "../app/lib/turnRecord";
import { claimTurn, clearSessionTurns, saveTurn } from "../app/lib/turnStore";

const WALLET = "0xabc0000000000000000000000000000000000009";
const get = async (query: string, host = "127.0.0.1:3100") => {
  const res = await GET(new Request(`http://127.0.0.1:3100/api/desks/turns${query}`, { headers: { host } }));
  return { status: res.status, body: await res.json() };
};
const forget = async (query: string, host = "127.0.0.1:3100") => {
  const res = await DELETE(new Request(`http://127.0.0.1:3100/api/desks/turns${query}`, { method: "DELETE", headers: { host } }));
  return { status: res.status, body: await res.json() };
};
const ids = (body: { turns: Array<{ id: string }> }) => body.turns.map((t) => t.id);
const sign = async (query: string, receipt: unknown, host = "127.0.0.1:3100") => {
  const res = await PATCH(
    new Request(`http://127.0.0.1:3100/api/desks/turns${query}`, { method: "PATCH", headers: { host, "content-type": "application/json" }, body: JSON.stringify({ receipt }) }),
  );
  return { status: res.status, body: await res.json() };
};
const RECEIPT = { hash: `0x${"ab".repeat(32)}`, status: "success", ticker: "NVDA", amount: "50", explorerUrl: `https://robinhoodchain.blockscout.com/tx/0x${"ab".repeat(32)}` };
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

describe("forgetting a turn", () => {
  it("forgets this session's copy, so History no longer lists or opens it", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    await saveTurn(WALLET, record("20260926-142000-cd34"), null);
    expect(await forget("?id=20260926-141000-ab12")).toEqual({ status: 200, body: { ok: true } });
    expect((await get("?id=20260926-141000-ab12")).status).toBe(404);
    expect(ids((await get("?desk=eqlty-desk")).body)).toEqual(["20260926-142000-cd34"]);
  });

  it("answers 404 for a turn it does not know, refuses outside callers and answers 401 signed out", async () => {
    expect((await forget("?id=20260926-000000-0000")).status).toBe(404);
    expect((await forget("?id=../../session")).status).toBe(404);
    expect((await forget("")).status).toBe(404);
    expect((await forget("?id=20260926-141000-ab12", "evil.example")).status).toBe(403);
    await rm(join(home, "session.json"));
    expect((await forget("?id=20260926-141000-ab12")).status).toBe(401);
  });
});

describe("keeping the receipt of a buy from a turn's plan", () => {
  it("keeps it with the turn, so History lists the turn signed with the stock and the amount", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    expect(await sign("?id=20260926-141000-ab12", RECEIPT)).toEqual({ status: 200, body: { ok: true } });
    const { body } = await get("?id=20260926-141000-ab12");
    expect(body.turn.receipt).toEqual({ ...RECEIPT, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    const list = (await get("?desk=eqlty-desk")).body;
    expect(list.turns[0]).toMatchObject({ signed: true, receipt: { ticker: "NVDA", amount: "50", status: "success" } });
  });

  it("takes the same swap again with where it stands now, and refuses another swap for the same turn", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    expect((await sign("?id=20260926-141000-ab12", { ...RECEIPT, status: "pending" })).status).toBe(200);
    expect((await sign("?id=20260926-141000-ab12", { ...RECEIPT, hash: RECEIPT.hash.toUpperCase().replace("0X", "0x") })).status).toBe(200);
    expect((await get("?id=20260926-141000-ab12")).body.turn.receipt.status).toBe("success");
    expect(await sign("?id=20260926-141000-ab12", { ...RECEIPT, hash: `0x${"cd".repeat(32)}` })).toMatchObject({ status: 409, body: { error: "signed" } });
    expect((await get("?id=20260926-141000-ab12")).body.turn.receipt.hash).toBe(RECEIPT.hash.toUpperCase().replace("0X", "0x"));
  });

  it("keeps only an https link to the swap, since History draws it", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    expect((await sign("?id=20260926-141000-ab12", { ...RECEIPT, explorerUrl: "javascript:alert(1)" })).status).toBe(200);
    expect((await get("?id=20260926-141000-ab12")).body.turn.receipt).not.toHaveProperty("explorerUrl");
  });

  it("refuses a receipt that does not read, and answers 404 for a turn it does not know", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    for (const bad of [
      null,
      { ...RECEIPT, hash: "feed" },
      { ...RECEIPT, status: "not_sent" },
      { ...RECEIPT, ticker: "<b>" },
      { ...RECEIPT, amount: "50 USDG" },
      { ...RECEIPT, amount: 50 },
    ]) {
      expect((await sign("?id=20260926-141000-ab12", bad)).status).toBe(400);
    }
    expect((await get("?id=20260926-141000-ab12")).body.turn).not.toHaveProperty("receipt");
    expect((await sign("?id=20260926-000000-0000", RECEIPT)).status).toBe(404);
    expect((await sign("?id=../../session", RECEIPT)).status).toBe(404);
  });

  it("refuses outside callers and answers 401 signed out", async () => {
    await saveTurn(WALLET, record("20260926-141000-ab12"), null);
    expect((await sign("?id=20260926-141000-ab12", RECEIPT, "evil.example")).status).toBe(403);
    await rm(join(home, "session.json"));
    expect((await sign("?id=20260926-141000-ab12", RECEIPT)).status).toBe(401);
  });
});

describe("/api/desks/turns with memory on", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = account.address.toLowerCase();
  const vault = (method: string, body?: unknown) =>
    new Request("http://127.0.0.1:3100/api/vault", {
      method,
      headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** The app closes: this process's turns and the open vault are gone, the sealed notes stay. */
  const restart = () => {
    clearSessionTurns();
    closeMemory(wallet);
  };

  beforeEach(async () => {
    process.env.PERKOS_DEVICE_SECRET = "cd".repeat(32);
    await writeFile(
      join(home, "session.json"),
      JSON.stringify({ wallet, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
    );
    const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
    expect((await UNLOCK(vault("POST", { signature }))).status).toBe(200);
  });
  afterEach(async () => {
    await LOCK(vault("DELETE"));
    delete process.env.PERKOS_DEVICE_SECRET;
  });

  it("keeps every turn across a restart, newest first, and says memory is on", async () => {
    const notes = await memoryFor(wallet);
    await saveTurn(wallet, record("20260926-141000-ab12"), notes);
    await saveTurn(wallet, record("20260926-142000-cd34", { summary: "The desk would start with NVDA." }), notes);
    restart();
    const { body } = await get("?desk=eqlty-desk");
    expect(body.memory).toBe("on");
    expect(ids(body)).toEqual(["20260926-142000-cd34", "20260926-141000-ab12"]);
    expect((await get("?id=20260926-142000-cd34")).body.turn).toMatchObject({ summary: "The desk would start with NVDA.", riskLevel: "medium" });
  });

  it("keeps a receipt in the sealed copy, so the turn stays signed after a restart", async () => {
    await saveTurn(wallet, record("20260926-141000-ab12"), await memoryFor(wallet));
    expect((await sign("?id=20260926-141000-ab12", RECEIPT)).status).toBe(200);
    restart();
    expect((await get("?id=20260926-141000-ab12")).body.turn.receipt).toMatchObject({ hash: RECEIPT.hash, ticker: "NVDA", amount: "50" });
    expect((await get("?desk=eqlty-desk")).body.turns[0]).toMatchObject({ signed: true, receipt: { ticker: "NVDA", amount: "50", status: "success" } });
  });

  it("forgets the sealed copy too, so the turn does not come back after a restart", async () => {
    await saveTurn(wallet, record("20260926-141000-ab12"), await memoryFor(wallet));
    expect((await forget("?id=20260926-141000-ab12")).status).toBe(200);
    restart();
    expect((await get("?id=20260926-141000-ab12")).status).toBe(404);
    expect((await get("?desk=eqlty-desk")).body.turns).toEqual([]);
    expect(await (await memoryFor(wallet))?.list("eqlty-desk", "turn")).toEqual([]);
  });
});

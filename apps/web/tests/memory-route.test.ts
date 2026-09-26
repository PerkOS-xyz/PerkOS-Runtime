/**
 * /api/memory: what Sparky remembers, only while memory is on.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE as FORGET, GET, PUT } from "../app/api/memory/route";
import { POST as SUMMARIZE } from "../app/api/memory/summarize/route";
import { DELETE, POST } from "../app/api/vault/route";
import { journalEntry } from "../app/lib/journal";
import { memoryFor } from "../app/lib/memory";
import { addSummary } from "../app/lib/memoryNote";
import { failureLabel } from "../app/lib/turnFailure";
import { turnBody, turnTitle, type TurnRecord } from "../app/lib/turnRecord";

const account = privateKeyToAccount(generatePrivateKey());
const wallet = account.address.toLowerCase();
const req = (method: string, query = "", body?: unknown) =>
  new Request(`http://127.0.0.1:3100/api/x${query}`, {
    method,
    headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = async (query = "") => {
  const res = await GET(req("GET", query));
  return { status: res.status, body: await res.json() };
};

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  process.env.PERKOS_DEVICE_SECRET = "cd".repeat(32);
  // No PerkOS API in tests: desk names fall back to their ids.
  process.env.PERKOS_API_URL = "http://127.0.0.1:9";
  await writeFile(join(home, "settings.json"), JSON.stringify({ model: { provider: "local", model: "m" } }));
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
});
afterEach(async () => {
  await DELETE(req("DELETE"));
  delete process.env.PERKOS_HOME;
  delete process.env.PERKOS_DEVICE_SECRET;
  delete process.env.PERKOS_API_URL;
});

async function turnOn() {
  const signature = await account.signMessage({ message: vaultKeyMessage(wallet) });
  await POST(req("POST", "", { signature }));
  const notes = await memoryFor(wallet);
  if (!notes) throw new Error("memory did not turn on");
  return notes;
}

describe("/api/memory", () => {
  it("answers 423 while memory is off", async () => {
    expect((await get()).status).toBe(423);
  });

  it("lists the scopes, the notes of one scope, and a whole note", async () => {
    const notes = await turnOn();
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    await notes.appendJournal("user", journalEntry("And I prefer low risk.", "Got it."));
    await notes.appendJournal("eqlty-desk", journalEntry("Watch NVDA.", "Watching."));

    const { body: top } = await get();
    expect(top.scopes).toEqual([
      { id: "user", name: "You", notes: 1 },
      { id: "eqlty-desk", name: "eqlty-desk", notes: 1 },
    ]);

    const { body: list } = await get("?scope=user");
    expect(list.notes).toHaveLength(1);
    expect(list.notes[0]).toMatchObject({ kind: "journal", exchanges: 2, preview: "My budget is 500 USDG a month." });
    expect(list.notes[0].body).toBeUndefined();

    const { body: one } = await get(`?id=${encodeURIComponent(list.notes[0].id)}`);
    expect(one.note.body).toContain("I prefer low risk");
    expect((await get("?id=..%2Fsession")).status).toBe(404);
  });

  it("searches across every scope", async () => {
    const notes = await turnOn();
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    await notes.appendJournal("eqlty-desk", journalEntry("Keep the budget for NVDA small.", "Understood."));
    const { body } = await get("?q=budget");
    expect(body.hits.map((h: { scope: string }) => h.scope).sort()).toEqual(["eqlty-desk", "user"]);
    expect(body.hits.find((h: { scope: string }) => h.scope === "user").name).toBe("You");
  });

  it("shows the latest facts of the Memory note in the list", async () => {
    const notes = await turnOn();
    await notes.writeNote("user", "memory", "Memory", addSummary("", "2026-09-26", "Facts\n- Budget is 500 USDG.\nDecisions\n- none\nPreferences\n- Low risk."));
    const { body } = await get("?scope=user");
    expect(body.notes[0]).toMatchObject({ title: "Memory", preview: "Budget is 500 USDG. · Low risk." });
  });
});

describe("editing and forgetting", () => {
  const send = async (res: Promise<Response>) => {
    const r = await res;
    return { status: r.status, body: await r.json() };
  };

  it("edits the Memory note but not a day's conversations", async () => {
    const notes = await turnOn();
    await notes.writeNote("user", "memory", "Memory", "## 2026-09-26\nFacts\n- Budget is 500 USDG.");
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    const edited = await send(PUT(req("PUT", "", { id: "user/notes/memory", body: "## 2026-09-26\nFacts\n- Budget is 600 USDG." })));
    expect(edited.body.note).toMatchObject({ id: "user/notes/memory", title: "Memory", body: "## 2026-09-26\nFacts\n- Budget is 600 USDG." });
    const day = (await notes.list("user")).find((n) => n.kind === "journal")!;
    expect((await send(PUT(req("PUT", "", { id: day.id, body: "rewritten" })))).status).toBe(400);
    expect((await send(PUT(req("PUT", "", { id: "user/notes/memory", body: "  " })))).status).toBe(400);
  });

  it("lists a desk turn by its question, keeps it as it happened, and forgets it on request", async () => {
    const notes = await turnOn();
    const turnBody = "Asked: How is NVDA doing today?\nAnalyze · Risk medium · 71.4 s\nScout (18.2 s): NVDA holds its range [F1].";
    await notes.writeTurn("eqlty-desk", "20260926-120000-ab12", "2026-09-26 12:00 How is NVDA doing today?", turnBody, { v: 1 });
    const { body: list } = await get("?scope=eqlty-desk");
    expect(list.notes[0]).toMatchObject({ kind: "turn", preview: "How is NVDA doing today?", exchanges: 0 });
    const id = "eqlty-desk/turns/20260926-120000-ab12";
    const refused = await send(PUT(req("PUT", "", { id, body: "rewritten" })));
    expect(refused).toEqual({ status: 400, body: { error: "turn", message: "A desk turn is kept as it happened." } });
    expect((await send(FORGET(req("DELETE", `?id=${encodeURIComponent(id)}`)))).body).toEqual({ ok: true });
    expect(await notes.read(id)).toBeNull();
  });

  it("forgets a day for good", async () => {
    const notes = await turnOn();
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    const day = (await notes.list("user"))[0]!;
    expect((await send(FORGET(req("DELETE", `?id=${encodeURIComponent(day.id)}`)))).body).toEqual({ ok: true });
    expect((await get("?scope=user")).body.notes).toEqual([]);
    expect((await get("?q=budget")).body.hits).toEqual([]);
    expect((await send(FORGET(req("DELETE", `?id=${encodeURIComponent(day.id)}`)))).status).toBe(404);
  });

  it("takes a forgotten day out of the Memory note too", async () => {
    const notes = await turnOn();
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    const day = (await notes.list("user"))[0]!;
    const date = day.id.slice(-10);
    await notes.writeNote("user", "memory", "Memory", addSummary(addSummary("", "2020-01-01", "Facts\n- Older."), date, "Facts\n- Budget is 500 USDG."));
    await send(FORGET(req("DELETE", `?id=${encodeURIComponent(day.id)}`)));
    expect((await notes.read("user/notes/memory"))?.body).toBe("## 2020-01-01\nFacts\n- Older.");

    await notes.appendJournal("user", journalEntry("Another day.", "Noted."));
    await notes.writeNote("user", "memory", "Memory", addSummary("", date, "Facts\n- Only this day."));
    await send(FORGET(req("DELETE", `?id=${encodeURIComponent(day.id)}`)));
    expect(await notes.read("user/notes/memory")).toBeNull();
  });
});

describe("/api/memory/summarize", () => {
  const summarize = async (body: unknown) => {
    const res = await SUMMARIZE(req("POST", "", body));
    return { status: res.status, body: await res.json() };
  };

  it("answers 423 while memory is off", async () => {
    expect((await summarize({})).status).toBe(423);
  });

  it("reports a day without conversations without calling the model", async () => {
    await turnOn();
    const { status, body } = await summarize({ scope: "eqlty-desk", date: "2026-09-20" });
    expect(status).toBe(200);
    expect(body.results).toEqual([{ scope: "eqlty-desk", date: "2026-09-20", ok: false, reason: "empty" }]);
    expect((await summarize({ pending: true })).body.results).toEqual([]);
  });
});

describe("a desk's decisions", () => {
  const turn = (id: string, extra: Partial<TurnRecord> = {}): TurnRecord => ({
    v: 1,
    id,
    desk: "eqlty-desk",
    module: "stocks-robinhood",
    kind: "analyze",
    question: "How is NVDA doing today?",
    principal: "@Scout @Risk How is NVDA doing today?",
    startedAt: new Date(2026, 8, 26, Number(id.slice(9, 11)), Number(id.slice(11, 13))).toISOString(),
    endedAt: new Date(2026, 8, 26, 15, 0).toISOString(),
    ms: 71_400,
    facts: ["[F1] NVDA (NVIDIA): 181.20 USDG, +1.20% in 24h"],
    memory: "",
    head: "",
    prompts: {},
    replies: [
      { role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA holds its range [F1].", ms: 18_200 },
      { role: "risk", phase: 1, ok: true, reply: "RISK: medium\n@Trader @Auditor keep it under 50 USDG.", ms: 12_900 },
      { role: "trader", phase: 2, ok: true, reply: "@Sparky Wait for a pullback to 178 USDG, then buy 50 USDG.", ms: 20_100 },
      { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries", ms: 20_000 },
    ],
    guests: [],
    riskLevel: "medium",
    flags: ["auditor:no-answer"],
    trace: [],
    summary: "The desk reads NVDA as steady and would wait for 178 USDG.",
    ...extra,
  });

  it("are counted per scope, listed with what came of each, and opened as a readable account", async () => {
    const notes = await turnOn();
    await notes.appendJournal("eqlty-desk", journalEntry("Keep the budget small.", "Noted."));
    for (const r of [turn("20260926-093000-ab12", { question: "What should I buy this month?", kind: "advise" }), turn("20260926-143000-cd34")]) {
      await notes.writeTurn(r.desk, r.id, turnTitle(r), turnBody(r, failureLabel), r);
    }

    const { body: top } = await get();
    expect(top.scopes).toEqual([
      { id: "user", name: "You", notes: 0 },
      { id: "eqlty-desk", name: "eqlty-desk", notes: 3, turns: 2 },
    ]);

    const { body: list } = await get("?scope=eqlty-desk");
    const decisions = list.notes.filter((n: { kind: string }) => n.kind === "turn");
    expect(decisions.map((n: { id: string }) => n.id).sort().reverse()).toEqual(["eqlty-desk/turns/20260926-143000-cd34", "eqlty-desk/turns/20260926-093000-ab12"]);
    expect(decisions.find((n: { id: string }) => n.id.endsWith("cd34")).decision).toEqual({
      kind: "analyze",
      question: "How is NVDA doing today?",
      startedAt: new Date(2026, 8, 26, 14, 30).toISOString(),
      riskLevel: "medium",
      outcome: "The desk reads NVDA as steady and would wait for 178 USDG.",
      answered: 3,
      missing: 1,
      voices: [
        { role: "scout", ok: true },
        { role: "risk", ok: true },
        { role: "trader", ok: true },
        { role: "auditor", ok: false },
      ],
    });
    expect(list.notes.find((n: { kind: string }) => n.kind === "journal").decision).toBeUndefined();

    const { body: one } = await get(`?id=${encodeURIComponent("eqlty-desk/turns/20260926-143000-cd34")}`);
    expect(one.note.kind).toBe("turn");
    expect(one.decision.agents.map((a: { name: string; line: string }) => `${a.name}: ${a.line}`)).toEqual([
      "Scout: NVDA holds its range.",
      "Risk: Keep it under 50 USDG.",
      "Trader: Wait for a pullback to 178 USDG, then buy 50 USDG.",
      "Auditor: model failed",
    ]);
    expect(one.decision).toMatchObject({ plan: "Wait for a pullback to 178 USDG, then buy 50 USDG.", recordMissing: "model failed", checks: ["Auditor · no answer"] });
    expect(one.decision.summary).toBe("The desk reads NVDA as steady and would wait for 178 USDG.");
  });

  it("are found by search, like the rest of what Sparky remembers", async () => {
    const notes = await turnOn();
    const r = turn("20260926-143000-cd34");
    await notes.writeTurn(r.desk, r.id, turnTitle(r), turnBody(r, failureLabel), r);
    await notes.appendJournal("user", journalEntry("My budget is 500 USDG a month.", "Noted."));
    const { body } = await get("?q=NVDA");
    expect(body.hits.map((h: { id: string }) => h.id)).toEqual(["eqlty-desk/turns/20260926-143000-cd34"]);
    expect(body.hits[0].snippet).toContain("How is NVDA doing today?");
  });
});

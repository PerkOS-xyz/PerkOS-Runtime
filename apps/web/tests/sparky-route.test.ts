/**
 * POST /api/sparky once a desk turn is over: Sparky sums up what the team
 * said, after a side question too, with memory on or off; his first words
 * while the team wakes; and questions about the last turn afterwards.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatRequest } from "@perkos/ai";
import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ seen: [] as ChatRequest[], reply: ["The desk reads NVDA ", "as steady."] }));

vi.mock("../app/lib/models", async () => {
  const { AiRegistry } = await import("@perkos/ai");
  return {
    defaultRegistry: () =>
      new AiRegistry([
        {
          id: "local",
          label: "Local",
          health: async () => ({ ok: true, detail: "" }),
          models: async () => [],
          chat: async function* (r: ChatRequest) {
            model.seen.push(r);
            for (const piece of model.reply) yield piece;
          },
        },
      ]),
  };
});

import { POST as SPARKY } from "../app/api/sparky/route";
import { DELETE as VAULT_OFF, POST as VAULT_ON } from "../app/api/vault/route";
import { memoryFor } from "../app/lib/memory";
import { answering, teamLines } from "../app/lib/sparky";
import type { TurnRecord } from "../app/lib/turnRecord";
import { clearSessionTurns, getTurn, saveTurn } from "../app/lib/turnStore";

const account = privateKeyToAccount(generatePrivateKey());
const WALLET = account.address.toLowerCase();
const ID = "20260926-143200-ab12";

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  v: 1,
  id: ID,
  desk: "eqlty-desk",
  module: "stocks-robinhood",
  kind: "analyze",
  question: "How is NVDA doing today?",
  principal: "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG.",
  startedAt: "2026-09-26T14:32:00.000Z",
  endedAt: "2026-09-26T14:33:11.400Z",
  ms: 71_400,
  facts: ["[F1] NVDA (NVIDIA): 181.20 USDG"],
  memory: "",
  head: "Request to the desk: ...",
  prompts: {},
  replies: [
    { role: "scout", phase: 1, ok: true, reply: "@Trader @Auditor NVDA trades at 181.20 USDG [F1], up 1.2%.", ms: 18_200 },
    { role: "risk", phase: 1, ok: true, reply: "RISK: medium\nKeep it small.", ms: 12_900 },
    { role: "trader", phase: 2, ok: true, reply: "@Sparky Entry: 50 USDG.", ms: 15_100 },
    { role: "auditor", phase: 2, ok: false, reply: "", failure: "model", detail: "API call failed after 3 retries: HTTP 502: upstream_failed", ms: 20_000 },
  ],
  guests: [],
  riskLevel: "medium",
  flags: ["auditor:no-answer"],
  trace: [],
  ...over,
});

const post = (body: unknown) =>
  SPARKY(new Request("http://127.0.0.1:3100/api/sparky", { method: "POST", headers: { host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify(body) }));
const lastRequest = () => model.seen[model.seen.length - 1]!;
const system = () => lastRequest().messages[0]!.content;

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  process.env.PERKOS_DEVICE_SECRET = "cd".repeat(32);
  process.env.PERKOS_API_URL = "http://127.0.0.1:9";
  await writeFile(join(home, "settings.json"), JSON.stringify({ model: { provider: "local", model: "m" } }));
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet: WALLET, accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
  // PerkOS does not answer in tests: no desk catalogue and no market facts.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "not here" } }, { status: 404 })));
  model.seen = [];
});
afterEach(async () => {
  await VAULT_OFF(new Request("http://127.0.0.1:3100/api/vault", { method: "DELETE", headers: { host: "127.0.0.1:3100" } }));
  vi.unstubAllGlobals();
  clearSessionTurns();
  for (const key of ["PERKOS_HOME", "PERKOS_DEVICE_SECRET", "PERKOS_API_URL"]) delete process.env[key];
  await rm(home, { recursive: true, force: true });
});

async function memoryOn() {
  const signature = await account.signMessage({ message: vaultKeyMessage(WALLET) });
  await VAULT_ON(new Request("http://127.0.0.1:3100/api/vault", { method: "POST", headers: { host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ signature }) }));
  const notes = await memoryFor(WALLET);
  if (!notes) throw new Error("memory did not turn on");
  return notes;
}

describe("Sparky's summary of a desk turn", () => {
  it("answers the turn's question after a side question, with memory off, and keeps the summary with the turn", async () => {
    await saveTurn(WALLET, record(), null);
    const res = await post({
      desk: "eqlty-desk",
      turn: ID,
      messages: [
        { role: "user", content: "How is NVDA doing today?" },
        { role: "user", content: "By the way, what time does the market close?" },
        { role: "assistant", content: "Tokenized stocks trade around the clock." },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("The desk reads NVDA as steady.");
    const sent = lastRequest().messages;
    expect(sent[sent.length - 1]).toEqual({ role: "user", content: "How is NVDA doing today?" });
    expect(system()).toContain("Scout: @Trader @Auditor NVDA trades at 181.20 USDG, up 1.2%.");
    expect(system()).toContain("Risk: RISK: medium Keep it small.");
    expect(system()).toContain("Auditor: (no answer: model failed)");
    expect(system()).toContain("Nothing is bought until the person holds to approve in the Trader.");
    expect(system()).not.toContain("USDG [F1]");
    await vi.waitFor(async () => expect((await getTurn(WALLET, ID, null))?.summary).toBe("The desk reads NVDA as steady."));
  });

  it("tells Sparky why the team could not take part", async () => {
    await saveTurn(WALLET, record({ error: { code: "NO_DESK_TIME", message: "Add desk time to run the team." }, replies: [] }), null);
    await (await post({ desk: "eqlty-desk", turn: ID, messages: [] })).text();
    expect(system()).toContain('could not take part in the person\'s request "How is NVDA doing today?": Add desk time to run the team.');
    expect(system()).not.toContain("What the team said:");
  });

  it("with memory on, keeps the summary in the sealed turn and journals the question with it", async () => {
    const notes = await memoryOn();
    await saveTurn(WALLET, record(), notes);
    await (await post({ desk: "eqlty-desk", turn: ID, messages: [{ role: "user", content: "How is NVDA doing today?" }] })).text();
    await vi.waitFor(async () => {
      const turn = await getTurn(WALLET, ID, notes);
      expect(turn?.summary).toBe("The desk reads NVDA as steady.");
      const kept = await notes.read(`eqlty-desk/turns/${ID}`);
      expect(kept?.body).toContain("Sparky: The desk reads NVDA as steady.");
      const day = (await notes.list("eqlty-desk")).find((n) => n.kind === "journal");
      expect(day?.body).toMatch(/^\[\d{2}:\d{2}\] Person: How is NVDA doing today\?\nSparky: The desk reads NVDA as steady\.$/);
    });
  });

  it("ignores a turn it does not know, or one of another desk", async () => {
    await saveTurn(WALLET, record(), null);
    const after = [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }];
    expect((await post({ desk: "eqlty-desk", turn: "20260926-143200-ffff", messages: after })).status).toBe(400);
    expect((await post({ desk: "other-desk", turn: ID, messages: after })).status).toBe(400);
    await (await post({ desk: "other-desk", turn: ID, messages: [{ role: "user", content: "Hi" }] })).text();
    expect(system()).not.toContain("What the team said:");
    expect((await getTurn(WALLET, ID, null))?.summary).toBeUndefined();
  });
});

describe("Sparky while the team wakes", () => {
  it("answers the question it is given, says the team is on it, and journals nothing", async () => {
    const notes = await memoryOn();
    const res = await post({
      desk: "eqlty-desk",
      ask: "What should I buy this month?",
      warm: true,
      messages: [{ role: "user", content: "What should I buy this month?" }, { role: "assistant", content: "Earlier answer." }],
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(lastRequest().messages.at(-1)).toEqual({ role: "user", content: "What should I buy this month?" });
    expect(system()).toContain("The desk's team is waking up on PerkOS");
    expect(system()).toContain("Do not pick a stock or give a plan");
    await new Promise((r) => setTimeout(r, 50));
    expect((await notes.list("eqlty-desk")).filter((n) => n.kind === "journal")).toEqual([]);
  });

  it("answers a question the team could not take, and journals it as usual", async () => {
    const notes = await memoryOn();
    await (await post({ desk: "eqlty-desk", ask: "How is NVDA doing today?", messages: [] })).text();
    expect(system()).not.toContain("waking up");
    await vi.waitFor(async () => expect((await notes.list("eqlty-desk")).some((n) => n.kind === "journal")).toBe(true));
  });
});

describe("questions after a turn", () => {
  it("gives Sparky what the team said in the desk's last turn, and changes nothing in it", async () => {
    await saveTurn(WALLET, record(), null);
    await (await post({ desk: "eqlty-desk", about: ID, messages: [{ role: "user", content: "What did Scout say?" }] })).text();
    expect(system()).toContain("What the desk's team said in its last turn, on \"How is NVDA doing today?\"");
    expect(system()).toContain("Trader: @Sparky Entry: 50 USDG.");
    expect(lastRequest().messages.at(-1)).toEqual({ role: "user", content: "What did Scout say?" });
    expect((await getTurn(WALLET, ID, null))?.summary).toBeUndefined();
  });
});

describe("the team's lines and the question Sparky answers", () => {
  it("gives each role one line, a missing one its label, and a guest after the house", () => {
    const lines = teamLines(record({ guests: [{ role: "grok", phase: 2, ok: false, reply: "", failure: "timeout", ms: 40_000 }] }));
    expect(lines).toEqual([
      "Scout: @Trader @Auditor NVDA trades at 181.20 USDG, up 1.2%.",
      "Risk: RISK: medium Keep it small.",
      "Trader: @Sparky Entry: 50 USDG.",
      "Auditor: (no answer: model failed)",
      "Grok: (no answer: timed out)",
    ]);
    const long = teamLines(record({ replies: [{ role: "scout", phase: 1, ok: true, reply: "x".repeat(5_000), ms: 1 }] }))[0]!;
    expect(long.length).toBeLessThan(1_300);
  });

  it("puts the question last unless the conversation already ends with it", () => {
    const q = "How is NVDA doing today?";
    expect(answering([{ role: "user", content: q }], q)).toEqual([{ role: "user", content: q }]);
    expect(answering([{ role: "user", content: q }, { role: "assistant", content: "Hi" }], q)).toEqual([
      { role: "user", content: q },
      { role: "assistant", content: "Hi" },
      { role: "user", content: q },
    ]);
    expect(answering([{ role: "assistant", content: "Hi" }], "")).toEqual([{ role: "assistant", content: "Hi" }]);
  });
});

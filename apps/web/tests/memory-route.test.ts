/**
 * /api/memory: what Sparky remembers, only while memory is on.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "../app/api/memory/route";
import { DELETE, POST } from "../app/api/vault/route";
import { journalEntry } from "../app/lib/journal";
import { memoryFor } from "../app/lib/memory";

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
});

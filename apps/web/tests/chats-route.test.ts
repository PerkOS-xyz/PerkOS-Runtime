/**
 * /api/chats: saved conversations, sealed with the vault key, only while memory is on.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vaultKeyMessage } from "@perkos/vault";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET, PATCH, PUT } from "../app/api/chats/route";
import { POST as UNLOCK } from "../app/api/vault/route";
import { closeMemory } from "../app/lib/memory";
import { vaultKeys } from "../app/lib/vault";

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const wallet = account.address.toLowerCase();
let home = "";

const req = (method: string, query = "", body?: unknown) =>
  new Request(`http://127.0.0.1:3100/api/chats${query}`, {
    method,
    headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const call = async (res: Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: await r.json() };
};
const talk = (...lines: string[]) => lines.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));

async function signIn(who: PrivateKeyAccount) {
  await writeFile(
    join(home, "session.json"),
    JSON.stringify({ wallet: who.address.toLowerCase(), accessToken: "t", refreshToken: "r", expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
}

async function turnOn(who: PrivateKeyAccount = account) {
  await signIn(who);
  const signature = await who.signMessage({ message: vaultKeyMessage(who.address.toLowerCase()) });
  const res = await UNLOCK(new Request("http://127.0.0.1:3100/api/vault", { method: "POST", headers: { host: "127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ signature }) }));
  if (!res.ok) throw new Error("memory did not turn on");
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
  process.env.PERKOS_DEVICE_SECRET = "cd".repeat(32);
  await signIn(account);
});
afterEach(async () => {
  for (const who of [account, other]) {
    closeMemory(who.address);
    await vaultKeys.forget(who.address);
  }
  delete process.env.PERKOS_HOME;
  delete process.env.PERKOS_DEVICE_SECRET;
});

describe("/api/chats", () => {
  it("says plainly how to keep chats while memory is off", async () => {
    const { status, body } = await call(GET(req("GET", "?scope=home")));
    expect(status).toBe(423);
    expect(body).toMatchObject({ error: "locked" });
    expect(body.message).toMatch(/Turn on memory/);
    expect((await call(PUT(req("PUT", "?scope=home&id=c-thread-one", { messages: talk("hi") })))).status).toBe(423);
  });

  it("answers 401 when no one is signed in", async () => {
    await rm(join(home, "session.json"));
    expect((await call(GET(req("GET", "?scope=home")))).status).toBe(401);
  });

  it("saves, lists, opens, organizes and deletes a desk's threads", async () => {
    await turnOn();
    const saved = await call(PUT(req("PUT", "?scope=eqlty-desk&id=c-thread-one", { messages: talk("Watch NVDA for me.", "Watching it.") })));
    expect(saved.status).toBe(200);
    expect(saved.body.chat).toMatchObject({ id: "c-thread-one", scope: "eqlty-desk", title: "Watch NVDA for me.", count: 2 });

    const listed = await call(GET(req("GET", "?scope=eqlty-desk")));
    expect(listed.body.chats.map((c: { id: string }) => c.id)).toEqual(["c-thread-one"]);
    expect(listed.body.chats[0].messages).toBeUndefined();
    expect((await call(GET(req("GET", "?scope=home")))).body.chats).toEqual([]);

    const opened = await call(GET(req("GET", "?scope=eqlty-desk&id=c-thread-one")));
    expect(opened.body.chat.messages).toEqual(talk("Watch NVDA for me.", "Watching it."));

    const renamed = await call(PATCH(req("PATCH", "?scope=eqlty-desk&id=c-thread-one", { title: "NVDA watch", group: "Stocks", pinned: true })));
    expect(renamed.body.chat).toMatchObject({ title: "NVDA watch", group: "Stocks", pinned: true });
    const ungrouped = await call(PATCH(req("PATCH", "?scope=eqlty-desk&id=c-thread-one", { group: null })));
    expect(ungrouped.body.chat).toMatchObject({ title: "NVDA watch", group: "", pinned: true });

    expect((await call(DELETE(req("DELETE", "?scope=eqlty-desk&id=c-thread-one")))).body).toEqual({ ok: true });
    expect((await call(DELETE(req("DELETE", "?scope=eqlty-desk&id=c-thread-one")))).status).toBe(404);
    expect((await call(GET(req("GET", "?scope=eqlty-desk&id=c-thread-one")))).status).toBe(404);
  });

  it("keeps nothing in the clear on disk", async () => {
    await turnOn();
    await call(PUT(req("PUT", "?scope=home&id=c-thread-one", { messages: talk("My budget is 500 USDG a month.") })));
    const dir = join(home, "vault", wallet, "home", "chats");
    expect(await readdir(dir)).toEqual(["c-thread-one.json"]);
    const raw = await readFile(join(dir, "c-thread-one.json"), "utf8");
    expect(raw).not.toContain("budget");
    expect(raw).not.toContain("500 USDG");
  });

  it("refuses ids and scopes that could leave the vault, and bad bodies", async () => {
    await turnOn();
    for (const q of ["?scope=home&id=..%2Fsession", "?scope=..%2F..&id=c-thread-one", "?scope=home&id=a", "?id=c-thread-one"]) {
      expect((await call(PUT(req("PUT", q, { messages: talk("x") })))).status).toBe(400);
      expect((await call(DELETE(req("DELETE", q)))).status).toBe(400);
    }
    expect((await call(GET(req("GET", "?scope=home&id=..%2Fsession")))).status).toBe(400);
    expect((await call(PUT(req("PUT", "?scope=home&id=c-thread-one", { messages: [] })))).status).toBe(400);
    expect((await call(PUT(req("PUT", "?scope=home&id=c-thread-one", "not json")))).status).toBe(400);
    expect((await call(PUT(req("PUT", "?scope=home&id=c-thread-one", "null")))).status).toBe(400);
    const huge = JSON.stringify({ messages: talk("x".repeat(2_000_001)) });
    expect((await call(PUT(req("PUT", "?scope=home&id=c-thread-one", huge)))).status).toBe(413);
    expect((await call(PATCH(req("PATCH", "?scope=home&id=c-missing-one", { title: "x" })))).status).toBe(404);
  });

  it("keeps each wallet's chats to itself", async () => {
    await turnOn(account);
    await call(PUT(req("PUT", "?scope=home&id=c-thread-one", { messages: talk("only mine") })));
    await turnOn(other);
    expect((await call(GET(req("GET", "?scope=home")))).body.chats).toEqual([]);
    expect((await call(GET(req("GET", "?scope=home&id=c-thread-one")))).status).toBe(404);
    await signIn(account);
    expect((await call(GET(req("GET", "?scope=home")))).body.chats.map((c: { title: string }) => c.title)).toEqual(["only mine"]);
  });

  it("stops serving chats once memory is turned off", async () => {
    await turnOn();
    await call(PUT(req("PUT", "?scope=home&id=c-thread-one", { messages: talk("hello") })));
    closeMemory(wallet);
    await vaultKeys.forget(wallet);
    expect((await call(GET(req("GET", "?scope=home")))).status).toBe(423);
  });
});

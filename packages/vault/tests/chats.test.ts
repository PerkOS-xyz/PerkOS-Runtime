/**
 * Saved chats: one sealed file per thread, by scope, with nothing in the clear.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ChatStore, cleanChatMessages, deriveVaultKey, isChatId, MAX_CHAT_MESSAGES, VaultKeyMismatch, type ChatMessage } from "../src/index.ts";

const WALLET = "0xabc0000000000000000000000000000000000001";
const OTHER_WALLET = "0xabc0000000000000000000000000000000000002";
const KEY = deriveVaultKey(WALLET, "0x01");

/** A clock that moves one minute per call, so every save has its own time. */
function clock(start = Date.UTC(2026, 8, 26, 12, 0)) {
  let t = start;
  return () => new Date((t += 60_000));
}

const store = (root = mkdtempSync(join(tmpdir(), "perkos-chats-")), key = KEY) => ({ root, chats: new ChatStore(root, key, clock()) });

const talk = (...lines: string[]): ChatMessage[] => lines.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content }));

describe("ChatStore", () => {
  it("seals a thread on disk and opens it again with the same key", async () => {
    const { root, chats } = store();
    const meta = await chats.save("eqlty-desk", "c-thread-one", talk("Should I buy NVDA this week?", "Risk would size it small."));
    expect(meta).toMatchObject({ id: "c-thread-one", scope: "eqlty-desk", title: "Should I buy NVDA this week?", count: 2, pinned: false, group: "" });
    expect(meta.preview).toBe("Risk would size it small.");

    const file = join(root, "eqlty-desk", "chats", "c-thread-one.json");
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain("NVDA");
    expect(onDisk).not.toContain("Should I buy");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const thread = await new ChatStore(root, KEY).read("eqlty-desk", "c-thread-one");
    expect(thread?.messages).toEqual(talk("Should I buy NVDA this week?", "Risk would size it small."));
    expect(thread?.title).toBe("Should I buy NVDA this week?");
  });

  it("cannot be read or listed with another key, and is never written over by it", async () => {
    const { root, chats } = store();
    await chats.save("home", "c-thread-one", talk("secret plan"));
    const other = new ChatStore(root, deriveVaultKey(WALLET, "0x02"));
    expect(await other.read("home", "c-thread-one")).toBeNull();
    expect(await other.list("home")).toEqual([]);
    expect(await other.update("home", "c-thread-one", { title: "mine now" })).toBeNull();
    expect(await other.remove("home", "c-thread-one")).toBe(false);
    await expect(other.save("home", "c-thread-one", talk("overwrite"))).rejects.toBeInstanceOf(VaultKeyMismatch);
    expect((await new ChatStore(root, KEY).read("home", "c-thread-one"))?.messages[0]?.content).toBe("secret plan");
  });

  it("keeps each wallet's chats apart", async () => {
    const base = mkdtempSync(join(tmpdir(), "perkos-chats-"));
    const mine = new ChatStore(join(base, WALLET), KEY);
    const theirs = new ChatStore(join(base, OTHER_WALLET), deriveVaultKey(OTHER_WALLET, "0x01"));
    await mine.save("home", "c-thread-one", talk("only mine"));
    expect(await theirs.list("home")).toEqual([]);
    expect(await theirs.read("home", "c-thread-one")).toBeNull();

    // A thread copied into the other wallet's folder still does not open there.
    mkdirSync(join(base, OTHER_WALLET, "home", "chats"), { recursive: true });
    cpSync(join(base, WALLET, "home", "chats", "c-thread-one.json"), join(base, OTHER_WALLET, "home", "chats", "c-thread-one.json"));
    expect(await theirs.read("home", "c-thread-one")).toBeNull();
    expect(await theirs.list("home")).toEqual([]);
  });

  it("keeps each desk's chats apart and refuses a thread moved to another desk or id", async () => {
    const { root, chats } = store();
    await chats.save("eqlty-desk", "c-thread-one", talk("about stocks"));
    await chats.save("home", "c-thread-two", talk("about desks"));
    expect((await chats.list("eqlty-desk")).map((c) => c.id)).toEqual(["c-thread-one"]);
    expect((await chats.list("home")).map((c) => c.id)).toEqual(["c-thread-two"]);
    expect(await chats.read("home", "c-thread-one")).toBeNull();

    mkdirSync(join(root, "base-desk", "chats"), { recursive: true });
    renameSync(join(root, "eqlty-desk", "chats", "c-thread-one.json"), join(root, "base-desk", "chats", "c-thread-one.json"));
    const reopened = new ChatStore(root, KEY);
    expect(await reopened.read("base-desk", "c-thread-one")).toBeNull();
    expect(await reopened.list("base-desk")).toEqual([]);

    renameSync(join(root, "home", "chats", "c-thread-two.json"), join(root, "home", "chats", "c-thread-six.json"));
    expect(await reopened.read("home", "c-thread-six")).toBeNull();
  });

  it("accepts only ids and scopes that stay inside the vault", async () => {
    const { root, chats } = store();
    for (const id of ["../session", "..", "a/b-cdefg", "short", "Upper-case-id", "-leading-dash", "c-thread-one/..", `c-${"x".repeat(60)}`]) {
      expect(isChatId(id)).toBe(false);
      await expect(chats.save("home", id, talk("x"))).rejects.toThrow("Not a chat id");
      expect(await chats.read("home", id)).toBeNull();
      expect(await chats.remove("home", id)).toBe(false);
    }
    await expect(chats.save("../evil", "c-thread-one", talk("x"))).rejects.toThrow("Not a scope");
    await expect(chats.list("../evil")).rejects.toThrow("Not a scope");
    expect(await chats.read("../evil", "c-thread-one")).toBeNull();
    expect(readdirSync(root)).toEqual([]);
    expect(isChatId("c-mfk2x9-a1b2c3")).toBe(true);
  });

  it("lists pinned threads first, then the most recent", async () => {
    const { chats } = store();
    await chats.save("home", "c-thread-old", talk("oldest"));
    await chats.save("home", "c-thread-mid", talk("middle"));
    await chats.save("home", "c-thread-new", talk("newest"));
    expect((await chats.list("home")).map((c) => c.id)).toEqual(["c-thread-new", "c-thread-mid", "c-thread-old"]);

    await chats.update("home", "c-thread-old", { pinned: true });
    await chats.update("home", "c-thread-mid", { group: "  Research   notes " });
    const listed = await chats.list("home");
    expect(listed.map((c) => c.id)).toEqual(["c-thread-old", "c-thread-new", "c-thread-mid"]);
    expect(listed.find((c) => c.id === "c-thread-mid")?.group).toBe("Research notes");

    // A new message moves a thread up; organizing it does not.
    await chats.save("home", "c-thread-mid", talk("middle", "and a reply"));
    expect((await chats.list("home")).map((c) => c.id)).toEqual(["c-thread-old", "c-thread-mid", "c-thread-new"]);
    await chats.update("home", "c-thread-mid", { group: null });
    expect((await chats.list("home")).find((c) => c.id === "c-thread-mid")?.group).toBe("");
  });

  it("keeps a title the person chose, and follows the first message otherwise", async () => {
    const { root, chats } = store();
    await chats.save("home", "c-thread-one", talk("First question"));
    expect((await chats.update("home", "c-thread-one", { title: "  My   plan " }))?.title).toBe("My plan");
    await chats.save("home", "c-thread-one", talk("First question", "An answer", "Second question"));
    expect((await new ChatStore(root, KEY).list("home"))[0]?.title).toBe("My plan");
    expect((await chats.update("home", "c-thread-one", { title: " " }))?.title).toBe("First question");
    expect((await chats.save("home", "c-thread-one", talk("Changed first question")))?.title).toBe("Changed first question");
  });

  it("keeps only turns that say something, and the latest ones", () => {
    const many = Array.from({ length: MAX_CHAT_MESSAGES + 10 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const cleaned = cleanChatMessages([{ role: "system", content: "x" }, { role: "user", content: "  " }, { role: "assistant" }, null, ...many]);
    expect(cleaned).toHaveLength(MAX_CHAT_MESSAGES);
    expect(cleaned[0]?.content).toBe("m10");
    expect(cleanChatMessages("nope")).toEqual([]);
  });

  it("refuses an empty thread and forgets one for good", async () => {
    const { root, chats } = store();
    await expect(chats.save("home", "c-thread-one", [])).rejects.toThrow("at least one message");
    await chats.save("home", "c-thread-one", talk("hello"));
    expect(await chats.remove("home", "c-thread-one")).toBe(true);
    expect(await chats.remove("home", "c-thread-one")).toBe(false);
    expect(await chats.list("home")).toEqual([]);
    expect(readdirSync(join(root, "home", "chats"))).toEqual([]);
  });

  it("does not lose a rename that lands while an autosave runs", async () => {
    const { chats } = store();
    await chats.save("home", "c-thread-one", talk("hello"));
    await Promise.all([chats.save("home", "c-thread-one", talk("hello", "hi")), chats.update("home", "c-thread-one", { title: "Greetings", pinned: true })]);
    const [meta] = await chats.list("home");
    expect(meta).toMatchObject({ title: "Greetings", pinned: true, count: 2 });
  });
});

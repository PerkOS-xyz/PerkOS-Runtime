/**
 * The Bankr key: sealed with the device secret when the desktop app gives
 * one, kept for the session only when it does not, and never on disk in the
 * clear. Bankr is mocked at the fetch boundary.
 */

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "../app/api/bankr/route";
import { bankrMe, refusalOf } from "../app/lib/bankr";
import { bankrKey, BankrKeyStore } from "../app/lib/bankrKey";

const KEY = "bk_usr_k1a2b3c4_" + "s".repeat(32);
const SECRET = "ab".repeat(32);
const BANKR_WALLET = "0x47bf9cca6875610364cf6e84e48b2e178fd32af0";

const req = (method: string, body?: unknown) =>
  new Request("http://127.0.0.1:3100/api/bankr", {
    method,
    headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const me = () =>
  Response.json({
    success: true,
    wallets: [
      { chain: "evm", address: "0x47BF9CCA6875610364CF6E84E48B2E178FD32AF0" },
      { chain: "solana", address: "5DcK" },
    ],
    socialAccounts: [{ platform: "twitter", username: "someone" }],
    bankrClub: { active: false },
  });

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
});
afterEach(async () => {
  await bankrKey.clear();
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
  delete process.env.PERKOS_DEVICE_SECRET;
});

describe("BankrKeyStore", () => {
  it("seals the key with the device secret, so another process on this device opens it and nothing else does", async () => {
    const store = new BankrKeyStore(() => home, () => SECRET, { key: null });
    await store.save(KEY);
    const raw = await readFile(join(home, "bankr.json"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain("bk_usr");
    if (process.platform !== "win32") expect((await stat(join(home, "bankr.json"))).mode & 0o777).toBe(0o600);
    expect(store.persistent()).toBe(true);
    expect(await new BankrKeyStore(() => home, () => SECRET, { key: null }).load()).toBe(KEY);
    expect(await new BankrKeyStore(() => home, () => "cd".repeat(32), { key: null }).load()).toBeNull();
    await store.clear();
    expect(await new BankrKeyStore(() => home, () => SECRET, { key: null }).load()).toBeNull();
  });

  it("keeps the key for the session only without a device secret, and writes nothing", async () => {
    const store = new BankrKeyStore(() => home, () => undefined, { key: null });
    await store.save(KEY);
    expect(store.persistent()).toBe(false);
    expect(await store.load()).toBe(KEY);
    await expect(stat(join(home, "bankr.json"))).rejects.toThrow();
    expect(await new BankrKeyStore(() => home, () => undefined, { key: null }).load()).toBeNull();
  });
});

describe("Bankr answers", () => {
  it("reads the wallet a key launches from", async () => {
    const http = vi.fn(async () => me());
    const r = await bankrMe(KEY, http);
    expect(r).toEqual({ ok: true, status: 200, data: { address: BANKR_WALLET, club: false, socials: ["twitter"] } });
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bankr.bot/wallet/me");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
  });

  it("reads a refusal in each shape Bankr uses, with its code, its words and how long to wait", () => {
    const limited = refusalOf(new Response("", { status: 429, headers: { "retry-after": "120" } }), { error: "Too many launch simulations in the last 24 hours." });
    expect(limited).toEqual({ status: 429, code: "BANKR_429", message: "Too many launch simulations in the last 24 hours.", retryAfter: 120 });
    const gated = refusalOf(new Response("", { status: 403 }), { error: "TOKEN_LAUNCH_NOT_AVAILABLE", message: "Token launches are not available for this wallet right now" });
    expect(gated).toMatchObject({ code: "TOKEN_LAUNCH_NOT_AVAILABLE", message: "Token launches are not available for this wallet right now" });
    expect(refusalOf(new Response("", { status: 400 }), { error: { code: "BAD_SYMBOL", message: "Symbol too long" } })).toMatchObject({ code: "BAD_SYMBOL", message: "Symbol too long" });
    expect(refusalOf(new Response("", { status: 401 }), {}, KEY).message).toBe("Bankr did not accept the key.");
    expect(refusalOf(new Response("", { status: 400 }), { message: `bad key ${KEY}` }, KEY).message).toBe("bad key [key]");
  });
});

describe("/api/bankr", () => {
  it("refuses what is not a Bankr user key without calling Bankr", async () => {
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    expect((await POST(req("POST", { apiKey: "sk-ant-nope" }))).status).toBe(400);
    const partner = await POST(req("POST", { apiKey: "bk_ptr_abc_" + "x".repeat(30) }));
    expect(await partner.json()).toMatchObject({ error: "partner_key" });
    expect(http).not.toHaveBeenCalled();
  });

  it("does not save a key Bankr rejects, nor one it could not check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 })));
    expect(await (await POST(req("POST", { apiKey: KEY }))).json()).toMatchObject({ error: "rejected" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const res = await POST(req("POST", { apiKey: KEY }));
    expect(res.status).toBe(502);
    expect(await (await GET(req("GET"))).json()).toEqual({ saved: false, persistent: false });
  });

  it("saves a working key sealed on this device and never returns it", async () => {
    process.env.PERKOS_DEVICE_SECRET = SECRET;
    vi.stubGlobal("fetch", vi.fn(async () => me()));
    const saved = await POST(req("POST", { apiKey: `  ${KEY}  ` }));
    const text = await saved.text();
    expect(JSON.parse(text)).toEqual({ saved: true, persistent: true, wallet: BANKR_WALLET });
    expect(text).not.toContain("bk_usr");
    const status = await (await GET(req("GET"))).text();
    expect(status).toBe(JSON.stringify({ saved: true, persistent: true }));
    expect(await readFile(join(home, "bankr.json"), "utf8")).not.toContain(KEY);
    expect(await bankrKey.load()).toBe(KEY);
    await DELETE(req("DELETE"));
    expect(await (await GET(req("GET"))).json()).toEqual({ saved: false, persistent: true });
  });

  it("refuses another site", async () => {
    const foreign = new Request("http://127.0.0.1:3100/api/bankr", { headers: { host: "127.0.0.1:3100", "sec-fetch-site": "cross-site" } });
    expect((await GET(foreign)).status).toBe(403);
  });
});

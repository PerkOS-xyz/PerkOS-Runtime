/**
 * /api/anthropic: the key is checked before it is saved, and never returned.
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "../app/api/anthropic/route";

const KEY = "sk-ant-api03-" + "x".repeat(40);
const req = (method: string, body?: unknown) =>
  new Request("http://127.0.0.1:3100/api/anthropic", {
    method,
    headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  process.env.PERKOS_HOME = home;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("/api/anthropic", () => {
  it("rejects something that is not an Anthropic key without calling Anthropic", async () => {
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    const res = await POST(req("POST", { apiKey: "hello" }));
    expect(res.status).toBe(400);
    expect(http).not.toHaveBeenCalled();
  });

  it("does not save a key Anthropic rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const res = await POST(req("POST", { apiKey: KEY }));
    expect(await res.json()).toMatchObject({ error: "rejected" });
    expect(await (await GET(req("GET"))).json()).toEqual({ saved: false });
  });

  it("saves a working key with owner-only permissions and never returns it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "claude-sonnet-5" }] })));
    const res = await POST(req("POST", { apiKey: KEY }));
    expect(await res.json()).toEqual({ saved: true });
    expect((await stat(join(home, "anthropic.json"))).mode & 0o777).toBe(0o600);
    const status = await (await GET(req("GET"))).text();
    expect(status).toBe(JSON.stringify({ saved: true }));
    expect(status).not.toContain("sk-ant");
    await DELETE(req("DELETE"));
    expect(await (await GET(req("GET"))).json()).toEqual({ saved: false });
  });
});

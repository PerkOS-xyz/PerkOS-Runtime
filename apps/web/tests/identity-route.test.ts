import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/desks/identity/route";

const request = (method = "GET", body?: unknown, host = "127.0.0.1:3100", desk = "eqlty-desk") => new Request(`http://127.0.0.1:3100/api/desks/identity?desk=${desk}`, {
  method, headers: { host, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-ens-test-"));
  await writeFile(join(process.env.PERKOS_HOME, "session.json"), JSON.stringify({ wallet: "0xabc", accessToken: "test-access", expiresAt: Date.now() + 600_000 }));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.PERKOS_HOME; });
describe("Runtime identity bridge", () => {
  it("reads the authenticated instance without creating it and prevents cached status", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.perkos.xyz/project-templates/eqlty-desk/identity");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-access");
      return Response.json({ state: "absent", identity: null });
    });
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request());
    expect(await response.json()).toEqual({ state: "absent", identity: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("passes an explicit publication to the owner-authenticated API", async () => {
    const body = { action: "record", role: "hooks", value: "public evidence", requestId: "123e4567-e89b-42d3-a456-426614174000" };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return Response.json({ state: "pending" });
    }));
    expect((await POST(request("POST", body))).status).toBe(200);
  });
  it("rejects foreign origins and invalid desk paths before contacting PerkOS", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request("POST", { action: "advance" }, "attacker.example"))).status).toBe(403);
    expect((await GET(request("GET", undefined, "127.0.0.1:3100", "../other"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps API ownership and revocation failures as failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "ENS_WRITE_REVOKED", message: "write revoked" } }, { status: 409 })));
    const response = await POST(request("POST", { action: "advance" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ENS_WRITE_REVOKED" });
  });
});

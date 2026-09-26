import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/world/[...path]/route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (path: string[], body?: unknown, host = "127.0.0.1:3100") => new Request(`http://127.0.0.1:3100/api/world/${path.join("/")}`, {
  method: body === undefined ? "GET" : "POST", headers: { host, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const status = { enabled: true, environment: "sandbox", providers: { idkit: true, oidc: true }, enrolled: { idkit: false, oidc: true } };
const request = { id: "request-1", status: "pending", provider: "idkit", purpose: "enroll", expiresAt: 2_000_000_000 };
beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-world-route-"));
  await writeFile(join(process.env.PERKOS_HOME, "session.json"), JSON.stringify({ wallet: "0xabc", accessToken: "owner-session", expiresAt: Date.now() + 600_000 }));
});
afterEach(async () => { await rm(process.env.PERKOS_HOME!, { recursive: true, force: true }); vi.unstubAllGlobals(); delete process.env.PERKOS_HOME; });
describe("World authenticated local proxy", () => {
  it("forwards a status read with owner auth, no-store, and no leaked credentials", async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.perkos.xyz/world/status");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer owner-session");
      return Response.json({ ...status, clientSecret: "never-forward" });
    }); vi.stubGlobal("fetch", http);
    const response = await GET(req(["status"]), context(["status"]));
    expect(await response.json()).toEqual(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("refuses a grant disguised as enrollment before contacting the API", async () => {
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    for (const body of [{ provider: "idkit", purpose: "delegate" }, { provider: "oidc", purpose: "enroll", owner: "someone-else" }, { provider: "idkit", purpose: "enroll", verified: true }]) {
      expect((await POST(req(["requests"], body), context(["requests"]))).status).toBe(400);
    }
    expect(http).not.toHaveBeenCalled();
  });
  it("forwards the exact proof and strips unrelated fields in the response", async () => {
    const result = { protocol_version: "4.0", responses: [{ opaque: "signed" }] };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.perkos.xyz/world/requests/request-1/proof");
      expect(JSON.parse(init?.body as string)).toEqual({ result });
      return Response.json({ ...request, status: "enrolled", secret: "hidden" });
    }));
    const path = ["requests", "request-1", "proof"];
    expect(await (await POST(req(path, { result }), context(path))).json()).toEqual({ ...request, status: "enrolled" });
  });
  it("fails closed for signed out, foreign origins, unknown paths and backend refusal", async () => {
    const http = vi.fn(async () => Response.json({ error: { message: "Request changed", code: "WORLD_STALE" } }, { status: 409 })); vi.stubGlobal("fetch", http);
    expect((await GET(req(["status"], undefined, "attacker.test"), context(["status"]))).status).toBe(403);
    expect((await POST(req(["requests", "x", "admin"], {}), context(["requests", "x", "admin"]))).status).toBe(404);
    expect(http).not.toHaveBeenCalled();
    const path = ["requests", "request-1", "poll"];
    const refused = await POST(req(path, {}), context(path));
    expect(refused.status).toBe(409); expect(await refused.json()).toMatchObject({ error: "WORLD_STALE" });
    await rm(join(process.env.PERKOS_HOME!, "session.json"));
    expect((await GET(req(["status"]), context(["status"]))).status).toBe(401);
  });
});

/**
 * GET /api/desks: needs a session, sends its token, returns only desks.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/desks/route";

const request = () => new Request("http://127.0.0.1:3100/api/desks", { headers: { host: "127.0.0.1:3100" } });

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("GET /api/desks", () => {
  it("returns 401 when signed out", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("sends the session token and lists the desks", async () => {
    await writeFile(
      join(process.env.PERKOS_HOME!, "session.json"),
      JSON.stringify({
        wallet: "0xabc",
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 600_000,
        refreshExpiresAt: Date.now() + 86_400_000,
      }),
    );
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.perkos.xyz/project-templates");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
      return Response.json({
        templates: [
          { id: "artizen-creator-update", kind: "artizen", name: { en: "Artizen" }, description: { en: "x" } },
          { id: "eqlty-desk", kind: "fleet", module: "stocks-robinhood", name: { en: "EQLTY Desk" }, description: { en: "Stocks" } },
        ],
      });
    });
    vi.stubGlobal("fetch", http);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      desks: [{ id: "eqlty-desk", name: "EQLTY Desk", description: "Stocks", module: "stocks-robinhood" }],
    });
  });
});

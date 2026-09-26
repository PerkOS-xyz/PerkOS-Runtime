/**
 * GET /api/desks/manifest: how a desk presents itself, only when it keeps the contract.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/desks/manifest/route";

const request = (module: string) =>
  new Request(`http://127.0.0.1:3100/api/desks/manifest?module=${module}`, { headers: { host: "127.0.0.1:3100" } });

const MANIFEST = {
  tagline: "Tokenized stocks on Robinhood Chain",
  starters: [{ text: "How is NVDA doing today?", tag: "Price and recent range" }],
  screens: ["market"],
  rules: "Priced in USDG. Nobody on the desk spends or signs.",
  turns: {},
};

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
  await writeFile(
    join(process.env.PERKOS_HOME, "session.json"),
    JSON.stringify({ wallet: "0xabc", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

describe("GET /api/desks/manifest", () => {
  it("returns the desk's manifest with the session token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://api.perkos.xyz/desks/stocks-robinhood/manifest");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
        return Response.json({ ok: true, module: "stocks-robinhood", ...MANIFEST });
      }),
    );
    const res = await GET(request("stocks-robinhood"));
    expect(await res.json()).toEqual({ manifest: MANIFEST });
  });

  it("is null for a desk that publishes none, and refuses one that breaks the contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "none" }, { status: 404 })));
    expect(await (await GET(request("stocks-base"))).json()).toEqual({ manifest: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, ...MANIFEST, screens: ["casino"] })));
    expect((await GET(request("stocks-robinhood"))).status).toBe(502);
  });

  it("asks which desk", async () => {
    expect((await GET(request("Bad Module"))).status).toBe(400);
  });
});

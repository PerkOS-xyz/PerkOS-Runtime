/**
 * GET /api/desks/market: a desk's market, only when it keeps the contract.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/desks/market/route";

const request = (module: string) =>
  new Request(`http://127.0.0.1:3100/api/desks/market?module=${module}`, { headers: { host: "127.0.0.1:3100" } });

const MARKET = {
  chain: "robinhood",
  chainId: 4663,
  quoteSymbol: "USDG",
  observedAt: "2026-09-26T20:40:00.000Z",
  assets: [
    {
      ticker: "NVDA",
      name: "NVIDIA",
      address: "0x1111111111111111111111111111111111111111",
      decimals: 18,
      priceUsd: 224.27,
      priceAt: "2026-09-26T20:39:00.000Z",
      change24hPct: 1.2,
      volume24hUsd: 1200000,
      tradeable: true,
      logoUrl: null,
    },
  ],
};

beforeEach(async () => {
  process.env.PERKOS_HOME = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PERKOS_HOME;
});

async function signIn() {
  await writeFile(
    join(process.env.PERKOS_HOME!, "session.json"),
    JSON.stringify({ wallet: "0xabc", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
}

describe("GET /api/desks/market", () => {
  it("asks which desk, and needs a session", async () => {
    expect((await GET(request("Bad Module"))).status).toBe(400);
    expect((await GET(request("stocks-robinhood"))).status).toBe(401);
  });

  it("returns the desk's market with the session token", async () => {
    await signIn();
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.perkos.xyz/desks/stocks-robinhood/market");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
      return Response.json({ ok: true, module: "stocks-robinhood", ...MARKET });
    });
    vi.stubGlobal("fetch", http);
    const res = await GET(request("stocks-robinhood"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ market: MARKET });
  });

  it("refuses a market that breaks the contract instead of showing it", async () => {
    await signIn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, ...MARKET, assets: [{ ...MARKET.assets[0], priceUsd: -1 }] })));
    const res = await GET(request("stocks-robinhood"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "DESK_CONTRACT" });
  });
});

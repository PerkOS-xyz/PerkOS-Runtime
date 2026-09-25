/**
 * The client, where it meets a desk that lives in another repo. The case worth
 * testing is the one that will happen: a desk ships a change, answers
 * something the contract does not allow, and Runtime has to refuse it instead
 * of drawing it.
 */

import { describe, expect, it, vi } from "vitest";

import { Desks, PerkosApiError, PerkosClient } from "../src/index.js";

const market = {
  ok: true,
  module: "stocks-robinhood",
  chain: "robinhood",
  chainId: 4663,
  quoteSymbol: "USDG",
  assets: [
    {
      ticker: "NVDA",
      name: "NVIDIA",
      address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
      decimals: 18,
      priceUsd: 225.27,
      priceAt: "2026-09-24T01:42:52.448Z",
      change24hPct: -1.48,
      volume24hUsd: 24991268,
      tradeable: true,
      logoUrl: null,
    },
  ],
  observedAt: "2026-09-24T01:42:56.283Z",
};

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** `null` is signed out; leaving it out is a normal session. */
const clientWith = (http: typeof fetch, token: string | null = "session-token") =>
  new PerkosClient({ fetchImpl: http, token: () => token ?? undefined });

describe("asking PerkOS for a desk's market", () => {
  it("sends the session and drops the envelope", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/market");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-token");
      return reply(200, market);
    });
    const desks = new Desks(clientWith(http as unknown as typeof fetch));
    const out = await desks.market("stocks-robinhood");
    expect(out.quoteSymbol).toBe("USDG");
    expect(out.assets[0]?.ticker).toBe("NVDA");
  });

  it("refuses a market the contract does not allow", async () => {
    const broken = { ...market, assets: [{ ...market.assets[0], address: "0xnope" }] };
    const desks = new Desks(clientWith(vi.fn(async () => reply(200, broken)) as unknown as typeof fetch));
    await expect(desks.market("stocks-robinhood")).rejects.toMatchObject({ code: "DESK_CONTRACT" });
  });

  it("asks for each ticker once and never with an empty list", async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("tickers=NVDA%2CAAPL");
      return reply(200, { series: [] });
    });
    const desks = new Desks(clientWith(http as unknown as typeof fetch));
    expect(await desks.series("stocks-base", [])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
    await desks.series("stocks-base", ["nvda", "NVDA", "aapl"]);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe("what the client says when it cannot ask", () => {
  it("does not send an anonymous request for something that needs a session", async () => {
    const http = vi.fn(async () => reply(200, market));
    const desks = new Desks(clientWith(http as unknown as typeof fetch, null));
    await expect(desks.market("stocks-base")).rejects.toMatchObject({ code: "PERKOS_SESSION" });
    expect(http).not.toHaveBeenCalled();
  });

  it("keeps the code PerkOS sent, so the screen can act on it", async () => {
    const http = vi.fn(async () => reply(403, { message: "Not allowed here", code: "VPS_NOT_ALLOWLISTED" }));
    const client = clientWith(http as unknown as typeof fetch);
    await expect(client.request("/desks/stocks-base/market")).rejects.toMatchObject({
      status: 403,
      code: "VPS_NOT_ALLOWLISTED",
    });
  });

  it("tells a silent service apart from a refusal", async () => {
    const http = vi.fn(async () => Promise.reject(new Error("timed out")));
    const client = clientWith(http as unknown as typeof fetch);
    const err = await client.request("/desks/stocks-base/market").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PerkosApiError);
    expect((err as PerkosApiError).code).toBe("PERKOS_UNREACHABLE");
  });
});

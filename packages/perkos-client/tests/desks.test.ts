/**
 * The client, where it meets a desk that lives in another repo. The case worth
 * testing is the one that will happen: a desk ships a change, answers
 * something the contract does not allow, and Runtime has to refuse it instead
 * of drawing it.
 */

import { describe, expect, it, vi } from "vitest";

import { Desks, PerkosApiError, PerkosClient } from "../src/index.ts";

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

describe("desk catalogue", () => {
  // Shape returned by GET /project-templates.
  const listed = {
    templates: [
      { id: "artizen-creator-update", kind: "artizen", module: null, name: { en: "Artizen Creator Update" }, description: { en: "One project" } },
      {
        id: "eqlty-desk",
        kind: "fleet",
        module: "stocks-robinhood",
        name: { en: "EQLTY Desk", es: "Mesa EQLTY" },
        description: { en: "Scout, Risk, Trader and Auditor on Robinhood Chain.", es: "Scout, Risk, Trader y Auditor en Robinhood Chain." },
      },
      { id: "old-desk", kind: "fleet", name: { en: "Old Desk" }, description: { en: "Published without a module." } },
    ],
  };

  it("lists fleet templates with localized text", async () => {
    const out = await new Desks(clientWith(vi.fn(async () => reply(200, listed)) as unknown as typeof fetch)).catalogue();
    expect(out.map((d) => d.id)).toEqual(["eqlty-desk", "old-desk"]);
    expect(out[0]).toEqual({
      id: "eqlty-desk",
      name: "EQLTY Desk",
      description: "Scout, Risk, Trader and Auditor on Robinhood Chain.",
      module: "stocks-robinhood",
    });
    expect(out[1]?.module).toBeUndefined();
  });

  it("uses the requested locale and falls back to English", async () => {
    const out = await new Desks(clientWith(vi.fn(async () => reply(200, listed)) as unknown as typeof fetch)).catalogue("es");
    expect(out[0]?.name).toBe("Mesa EQLTY");
    expect(out[1]?.name).toBe("Old Desk");
  });
});

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

describe("asking PerkOS for a desk's manifest", () => {
  const manifest = {
    ok: true,
    module: "stocks-robinhood",
    tagline: "Tokenized stocks on Robinhood Chain",
    starters: [{ text: "How is NVDA doing today?", tag: "Price and recent range" }],
    screens: ["market"],
    rules: "Priced in USDG. Nobody on the desk spends or signs.",
    turns: {},
  };

  it("drops the envelope and checks it against the contract", async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/manifest");
      return reply(200, manifest);
    });
    const out = await new Desks(clientWith(http as unknown as typeof fetch)).manifest("stocks-robinhood");
    expect(out).toEqual({ tagline: manifest.tagline, starters: manifest.starters, screens: ["market"], rules: manifest.rules, turns: {} });
  });

  it("is null for a desk that publishes none, and refuses one the contract does not allow", async () => {
    const none = new Desks(clientWith(vi.fn(async () => reply(404, { error: "none" })) as unknown as typeof fetch));
    expect(await none.manifest("stocks-base")).toBeNull();
    const broken = new Desks(clientWith(vi.fn(async () => reply(200, { ...manifest, screens: ["casino"] })) as unknown as typeof fetch));
    await expect(broken.manifest("stocks-robinhood")).rejects.toMatchObject({ code: "DESK_CONTRACT" });
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

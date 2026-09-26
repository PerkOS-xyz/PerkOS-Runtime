/**
 * The Trader's local routes: guarded, signed in, checked on the way in, and
 * passing PerkOS's refusals through with their code so the sheet can act on
 * them. PerkOS is mocked at the fetch boundary with the contract it serves.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as REVOKE, POST as DELEGATE } from "../app/api/delegation/route";
import { delegationLink, delegationMode, traderAgentId } from "../app/desks/delegation";
import { POST as BUY } from "../app/api/desks/buy/route";
import { GET as POSITIONS } from "../app/api/desks/positions/route";
import { GET as QUOTE } from "../app/api/desks/quote/route";
import { POST as SWEEP } from "../app/api/desks/sweep/route";
import { GET as TRADER } from "../app/api/desks/trader/route";

const HOST = { host: "127.0.0.1:3100" };
const get = (path: string) => new Request(`http://127.0.0.1:3100${path}`, { headers: HOST });
const post = (path: string, body: unknown, method = "POST") =>
  new Request(`http://127.0.0.1:3100${path}`, { method, headers: { ...HOST, "content-type": "application/json" }, body: JSON.stringify(body) });

const WALLET = "0x6732c0829808e8286012f53462013104289025b4";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const ORDER = { module: "stocks-robinhood", ticker: "NVDA", amountUsdg: "1", maxSlippageBps: 100, quotedAmountOut: "4200000000000000" };

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

/** PerkOS as the fetch boundary: one handler per path, everything else a 404. */
function perkos(routes: Record<string, (init?: RequestInit, url?: URL) => Response>) {
  const http = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
    const handler = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    return handler ? handler(init, url) : Response.json({ error: { message: "not found", code: "NOT_FOUND" } }, { status: 404 });
  });
  vi.stubGlobal("fetch", http);
  return http;
}

describe("POST /api/delegation", () => {
  it("carries each selected desk's Trader through the browser helper and local proxy", async () => {
    await signIn();
    const sent: unknown[] = [];
    const remote = perkos({ "POST /delegation/link-token": (init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ url: "https://api.perkos.xyz/delegate?t=fixture" });
    } });
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => input === "/api/delegation"
      ? DELEGATE(post(input, JSON.parse(String(init?.body)))) : remote(input, init));
    for (const desk of ["eqlty", "floor"]) {
      const agentId = traderAgentId({ templateId: desk, status: "ready", agents: [
        { role: "scout", name: `${desk}-scout`, agentId: `${desk}-scout-id`, state: "ready" },
        { role: "trader", name: `${desk}-trader`, agentId: `${desk}-stable-id`, state: "ready" },
      ] }, desk);
      for (const approved of [false, true]) {
        const world = { enabled: true, approved, grant: approved ? { agentId: agentId!, walletAddress: WALLET, chainIds: [4663], maxPerOrder: "25", revision: 1 } : null };
        const mode = delegationMode({ world, wallet: WALLET, chainId: 4663 }, agentId);
        await expect(delegationLink(mode, agentId)).resolves.toContain("/delegate?");
      }
    }
    expect(sent).toEqual([
      { mode: "grant", agentId: "eqlty-stable-id" }, { mode: "edit", agentId: "eqlty-stable-id" },
      { mode: "grant", agentId: "floor-stable-id" }, { mode: "edit", agentId: "floor-stable-id" },
    ]);
  });

  it("validates supplied IDs, requires the owner session and retains backend ownership refusals", async () => {
    expect((await DELEGATE(post("/api/delegation", { agentId: "trader-1" }))).status).toBe(401);
    for (const agentId of [null, 42, "", "trader/name", "a".repeat(129)]) {
      expect((await DELEGATE(post("/api/delegation", { agentId }))).status).toBe(400);
    }
    await signIn();
    const http = perkos({ "POST /delegation/link-token": () => Response.json({ error: { code: "WORLD_AGENT_OWNER_MISMATCH", message: "Wrong Trader owner" } }, { status: 409 }) });
    const res = await DELEGATE(post("/api/delegation", { agentId: "other-trader", owner: "forged-owner" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "WORLD_AGENT_OWNER_MISMATCH" });
    expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body))).toEqual({ mode: "grant", agentId: "other-trader" });
  });

  it("keeps legacy and revoke requests possible without a Trader ID and rejects another site", async () => {
    await signIn();
    const http = perkos({ "POST /delegation/link-token": () => Response.json({ url: "https://api.perkos.xyz/delegate" }) });
    expect((await DELEGATE(post("/api/delegation", { mode: "revoke" }))).status).toBe(200);
    expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body))).toEqual({ mode: "revoke" });
    const req = post("/api/delegation", { mode: "edit", agentId: "trader-1" });
    req.headers.set("sec-fetch-site", "cross-site");
    expect((await DELEGATE(req)).status).toBe(403);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/desks/trader", () => {
  it("asks which desk, needs a session, and refuses another site", async () => {
    expect((await TRADER(get("/api/desks/trader?module=Bad"))).status).toBe(400);
    expect((await TRADER(get("/api/desks/trader?module=stocks-robinhood"))).status).toBe(401);
    const foreign = new Request("http://127.0.0.1:3100/api/desks/trader?module=stocks-robinhood", { headers: { ...HOST, "sec-fetch-site": "cross-site" } });
    expect((await TRADER(foreign)).status).toBe(403);
  });

  it("returns the delegated wallet, its funds and the cap", async () => {
    await signIn();
    perkos({
      "GET /desks/stocks-robinhood/trader": () =>
        Response.json({
          ok: true,
          delegated: true,
          wallet: WALLET,
          chainId: 4663,
          gas: { amount: "0", enough: false },
          balances: [{ symbol: "USDG", address: USDG, decimals: 6, amount: "5000000" }],
          cap: { amount: "100", symbol: "USDG", source: "platform", reason: "no-rule-for-chain" },
        }),
    });
    const res = await TRADER(get("/api/desks/trader?module=stocks-robinhood"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trader: {
        delegated: true,
        wallet: WALLET,
        chainId: 4663,
        gas: { ok: false, wei: "0" },
        balances: [{ symbol: "USDG", address: USDG, decimals: 6, amount: "5000000" }],
        cap: 100,
        capBy: "platform",
        capReason: "no-rule-for-chain",
        input: null,
        marketAvailable: true,
      },
    });
  });

  it("refuses a Trader on any chain but Robinhood Chain, which is all the sheet can draw", async () => {
    await signIn();
    perkos({
      "GET /desks/stocks-robinhood/trader": () => Response.json({ ok: true, delegated: true, wallet: WALLET, chainId: 8453, gas: "1", balances: [], cap: 25 }),
    });
    const res = await TRADER(get("/api/desks/trader?module=stocks-robinhood"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "TRADER_CHAIN" });
  });

  it("passes PerkOS's nested reason and code through", async () => {
    await signIn();
    perkos({
      "GET /desks/stocks-robinhood/trader": () => Response.json({ error: { message: "Delegated access is not switched on", code: "DELEGATION_DISABLED" } }, { status: 503 }),
    });
    const res = await TRADER(get("/api/desks/trader?module=stocks-robinhood"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "DELEGATION_DISABLED", message: "Delegated access is not switched on" });
  });
});

describe("GET /api/desks/quote", () => {
  it("asks which desk, which stock and how much", async () => {
    await signIn();
    expect((await QUOTE(get("/api/desks/quote?module=stocks-robinhood&ticker=NVDA"))).status).toBe(400);
    expect((await QUOTE(get("/api/desks/quote?module=stocks-robinhood&ticker=NVDA&amountUsdg=0"))).status).toBe(400);
    expect((await QUOTE(get("/api/desks/quote?module=stocks-robinhood&ticker=NVDA&amountUsdg=1.0000001"))).status).toBe(400);
    expect((await QUOTE(get("/api/desks/quote?module=stocks-robinhood&ticker=N%20V&amountUsdg=1"))).status).toBe(400);
  });

  it("returns the desk's quote for the ticker and amount", async () => {
    await signIn();
    perkos({
      "GET /desks/stocks-robinhood/quote": (_init, url) => {
        expect(url?.searchParams.get("ticker")).toBe("NVDA");
        expect(url?.searchParams.get("amountUsdg")).toBe("2.5");
        expect(url?.searchParams.get("ticker")).not.toBeNull();
        return Response.json({
          chainId: 4663,
          ticker: "NVDA",
          tokenIn: { symbol: "USDG", address: USDG, decimals: 6 },
          tokenOut: { symbol: "NVDA", address: NVDA, decimals: 18 },
          amountIn: "2500000",
          amountOut: "10500000000000000",
          priceImpactPct: 0.1,
          routing: "CLASSIC",
          protocols: ["V4"],
          requestId: "req-9",
          quotedAt: "2026-09-26T12:00:00.000Z",
        });
      },
    });
    const res = await QUOTE(get("/api/desks/quote?module=stocks-robinhood&ticker=nvda&amountUsdg=2.50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quote: { ticker: "NVDA", amountIn: "2500000", amountOut: "10500000000000000", requestId: "req-9" } });
  });
});

describe("POST /api/desks/buy", () => {
  it("checks the order before anything reaches PerkOS", async () => {
    await signIn();
    const http = perkos({});
    for (const bad of [
      { ...ORDER, module: "Bad" },
      { ...ORDER, ticker: "" },
      { ...ORDER, amountUsdg: 0 },
      { ...ORDER, amountUsdg: "1.0000001" },
      { ...ORDER, maxSlippageBps: 0 },
      { ...ORDER, maxSlippageBps: 301 },
      { ...ORDER, maxSlippageBps: 500 },
      { ...ORDER, maxSlippageBps: 1.5 },
      { ...ORDER, quotedAmountOut: "4.2" },
      { ...ORDER, quotedAmountOut: "0" },
      { ...ORDER, quotedAmountOut: undefined },
    ]) {
      expect((await BUY(post("/api/desks/buy", bad))).status).toBe(400);
    }
    expect(http).not.toHaveBeenCalled();
  });

  it("needs a session and a same-site JSON request", async () => {
    expect((await BUY(post("/api/desks/buy", ORDER))).status).toBe(401);
    const form = new Request("http://127.0.0.1:3100/api/desks/buy", { method: "POST", headers: { ...HOST, "content-type": "text/plain" }, body: JSON.stringify(ORDER) });
    expect((await BUY(form)).status).toBe(403);
  });

  it("sends the approved order and returns the receipt with its steps", async () => {
    await signIn();
    perkos({
      "POST /desks/stocks-robinhood/orders/buy": (init) => {
        // PerkOS reads the amount as a decimal string, exactly as the owner held for it, and always gets the quote.
        expect(JSON.parse(String(init?.body))).toEqual({ ticker: "NVDA", amountUsdg: "1.5", maxSlippageBps: 300, quotedAmountOut: "4200000000000000" });
        return Response.json({
          ok: true,
          bought: true,
          status: "success",
          hash: "0xfeed",
          explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed",
          amountOut: "4190000000000000",
          steps: [
            { kind: "permit2", hash: "0xb22", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xb22" },
            { kind: "swap", hash: "0xfeed", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed" },
          ],
          notice: null,
        });
      },
    });
    const res = await BUY(post("/api/desks/buy", { ...ORDER, ticker: "nvda", amountUsdg: "01.50", maxSlippageBps: 300 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      receipt: {
        status: "success",
        bought: true,
        hash: "0xfeed",
        explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed",
        amountOut: "4190000000000000",
        steps: [
          { kind: "permit2", hash: "0xb22", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xb22" },
          { kind: "swap", hash: "0xfeed", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed" },
        ],
        notice: null,
      },
    });
  });

  it("sends the desk turn a buy follows as the order's reason, and refuses one that is not a turn", async () => {
    await signIn();
    const bodies: unknown[] = [];
    perkos({
      "POST /desks/stocks-robinhood/orders/buy": (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, bought: true, status: "success", hash: "0xfeed", explorerUrl: null, amountOut: null, steps: [], notice: null });
      },
    });
    expect((await BUY(post("/api/desks/buy", { ...ORDER, turnId: "20260926-143205-ab12" }))).status).toBe(200);
    expect(bodies).toEqual([{ ticker: "NVDA", amountUsdg: "1", maxSlippageBps: 100, quotedAmountOut: "4200000000000000", reason: "20260926-143205-ab12" }]);
    for (const turnId of ["../../session", "", 42, "20260926-143205"]) {
      expect((await BUY(post("/api/desks/buy", { ...ORDER, turnId }))).status).toBe(400);
    }
    expect(bodies).toHaveLength(1);
  });

  it("passes an order that stopped before the swap, or a swap not confirmed yet, through as a receipt", async () => {
    await signIn();
    perkos({
      "POST /desks/stocks-robinhood/orders/buy": () =>
        Response.json({
          ok: true,
          bought: false,
          status: "not_sent",
          hash: null,
          explorerUrl: null,
          amountOut: null,
          steps: [{ kind: "approve", hash: "0xa11", status: "success", explorerUrl: null }],
          notice: "The price moved: ask for a new quote",
        }),
    });
    expect(await (await BUY(post("/api/desks/buy", ORDER))).json()).toMatchObject({
      receipt: { status: "not_sent", bought: false, hash: null, notice: "The price moved: ask for a new quote", steps: [{ kind: "approve" }] },
    });
    perkos({
      "POST /desks/stocks-robinhood/orders/buy": () =>
        Response.json({ ok: true, bought: null, status: "pending", hash: "0xfeed", explorerUrl: null, amountOut: null, steps: [], notice: null }),
    });
    expect(await (await BUY(post("/api/desks/buy", ORDER))).json()).toMatchObject({ receipt: { status: "pending", bought: null, hash: "0xfeed" } });
  });

  it("keeps each refusal's code, so the sheet says what to do", async () => {
    await signIn();
    for (const [code, status] of [
      ["NO_DELEGATION", 409],
      ["OVER_LIMIT", 403],
      ["STALE_ORDER", 409],
      ["SIGNER_REFUSED", 403],
      ["TRADER_NEEDS_GAS", 409],
      ["DESK_UNAVAILABLE", 503],
      ["ORDER_IN_FLIGHT", 409],
      ["ORDER_FAILED", 502],
    ] as const) {
      perkos({ "POST /desks/stocks-robinhood/orders/buy": () => Response.json({ error: { message: `refused: ${code}`, code } }, { status }) });
      const res = await BUY(post("/api/desks/buy", ORDER));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code, message: `refused: ${code}` });
    }
  });

  it("answers 502 PERKOS_UNREACHABLE when PerkOS never answers, which the sheet reads as unconfirmed", async () => {
    await signIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("The operation was aborted due to timeout"))),
    );
    const res = await BUY(post("/api/desks/buy", ORDER));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "PERKOS_UNREACHABLE" });
  });
});

describe("POST /api/desks/sweep", () => {
  it("names a token and never a destination", async () => {
    await signIn();
    expect((await SWEEP(post("/api/desks/sweep", { module: "stocks-robinhood", token: "nope" }))).status).toBe(400);
    expect((await SWEEP(post("/api/desks/sweep", { module: "stocks-robinhood", token: NVDA, amount: "1.5" }))).status).toBe(400);
    perkos({
      "POST /desks/stocks-robinhood/sweep": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ token: NVDA });
        return Response.json({ ok: true, hash: "0xbeef", status: "pending", explorerUrl: null });
      },
    });
    const res = await SWEEP(post("/api/desks/sweep", { module: "stocks-robinhood", token: NVDA, to: "0x000000000000000000000000000000000000dEaD" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { hash: "0xbeef", status: "pending", explorerUrl: null } });
  });
});

describe("DELETE /api/delegation", () => {
  it("revokes the Trader's access on PerkOS", async () => {
    expect((await REVOKE(post("/api/delegation", {}, "DELETE"))).status).toBe(401);
    await signIn();
    const http = perkos({ "POST /delegation/revoke": () => Response.json({ ok: true, revoked: true }) });
    const res = await REVOKE(post("/api/delegation", {}, "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("says so when there was nothing to revoke", async () => {
    await signIn();
    perkos({ "POST /delegation/revoke": () => Response.json({ ok: true, revoked: false }) });
    expect(await (await REVOKE(post("/api/delegation", {}, "DELETE"))).json()).toEqual({ revoked: false });
  });
});

describe("GET /api/desks/positions", () => {
  const PORTFOLIO = {
    ok: true,
    module: "stocks-robinhood",
    delegated: true,
    wallet: WALLET,
    chain: "robinhood",
    chainId: 4663,
    input: { symbol: "USDG", address: USDG, decimals: 6 },
    gas: { symbol: "ETH", raw: "2000000000000000", formatted: "0.002" },
    cash: { symbol: "USDG", raw: "12500000", formatted: "12.5" },
    positions: [
      {
        ticker: "NVDA",
        name: "NVIDIA • Robinhood Token",
        address: NVDA,
        decimals: 18,
        raw: "100000000000000000",
        amount: "0.1",
        price: 180,
        change24hPct: 1.5,
        logoUrl: null,
        value: 18,
        spent: "30",
        received: "0.15",
        avgCost: 200,
        cost: 20,
        pnl: -2,
        pnlPct: -10,
        buys: 2,
        lastBuyAt: "2026-09-22T10:00:00.000Z",
      },
    ],
    totals: { value: 18, cost: 20, pnl: -2, pnlPct: -10, unpriced: 0, uncosted: 0 },
    swaps: [{ hash: "0xfeed", ticker: "NVDA", tokenOut: NVDA, usdgIn: "20", amountOut: "0.1", status: "success", explorerUrl: null, at: "2026-09-22T10:00:00.000Z" }],
    marketAvailable: true,
    unreadable: [],
    history: "complete",
  };

  it("asks which desk, needs a session, and refuses another site", async () => {
    expect((await POSITIONS(get("/api/desks/positions?module=Bad"))).status).toBe(400);
    expect((await POSITIONS(get("/api/desks/positions?module=stocks-robinhood"))).status).toBe(401);
    const foreign = new Request("http://127.0.0.1:3100/api/desks/positions?module=stocks-robinhood", { headers: { ...HOST, "sec-fetch-site": "cross-site" } });
    expect((await POSITIONS(foreign)).status).toBe(403);
  });

  it("returns the portfolio PerkOS read, in the client's atomic units", async () => {
    await signIn();
    perkos({ "GET /desks/stocks-robinhood/positions": () => Response.json(PORTFOLIO) });
    const res = await POSITIONS(get("/api/desks/positions?module=stocks-robinhood"));
    expect(res.status).toBe(200);
    const { portfolio } = await res.json();
    expect(portfolio).toMatchObject({
      delegated: true,
      wallet: WALLET,
      chainId: 4663,
      cash: { symbol: "USDG", address: USDG, decimals: 6, amount: "12500000" },
      gas: { ok: true, wei: "2000000000000000" },
      totals: { value: 18, cost: 20, pnl: -2, pnlPct: -10 },
      history: "complete",
    });
    expect(portfolio.positions).toEqual([
      expect.objectContaining({ ticker: "NVDA", amount: "100000000000000000", spent: "30000000", received: "150000000000000000", avgCost: 200, buys: 2 }),
    ]);
    expect(portfolio.swaps).toEqual([expect.objectContaining({ hash: "0xfeed", ticker: "NVDA", usdgIn: "20", amountOut: "0.1", status: "success" })]);
  });

  it("refuses a portfolio on any chain but Robinhood Chain, and passes PerkOS's code through", async () => {
    await signIn();
    perkos({ "GET /desks/stocks-robinhood/positions": () => Response.json({ ...PORTFOLIO, chainId: 8453 }) });
    let res = await POSITIONS(get("/api/desks/positions?module=stocks-robinhood"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "PORTFOLIO_CHAIN" });

    perkos({
      "GET /desks/stocks-robinhood/positions": () =>
        Response.json({ error: { message: "Robinhood Chain did not answer. Try again in a moment.", code: "CHAIN_UNAVAILABLE" } }, { status: 503 }),
    });
    res = await POSITIONS(get("/api/desks/positions?module=stocks-robinhood"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "CHAIN_UNAVAILABLE", message: "Robinhood Chain did not answer. Try again in a moment." });
  });
});

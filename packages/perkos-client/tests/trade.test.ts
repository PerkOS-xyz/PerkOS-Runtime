/**
 * The Trader's client: it reads the delegated wallet, asks for a quote, sends
 * one approved buy and sweeps a token home, and refuses answers it cannot
 * read instead of drawing them.
 */

import { describe, expect, it, vi } from "vitest";

import { atomic, DeskTrade, fromWhole, PerkosClient } from "../src/index.ts";

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const tradeWith = (http: typeof fetch) => new DeskTrade(new PerkosClient({ fetchImpl: http, token: () => "session-token" }));

const WALLET = "0x6732c0829808e8286012f53462013104289025b4";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";

describe("the delegated wallet", () => {
  it("reads the wallet, its funds on the desk's chain and the cap on one order", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/trader");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-token");
      return reply(200, {
        ok: true,
        delegated: true,
        wallet: WALLET,
        chainId: 4663,
        gas: { symbol: "ETH", amount: "500000000000000", enough: true },
        balances: [
          { symbol: "USDG", address: USDG, decimals: 6, amount: "25000000" },
          { symbol: "ETH", address: null, decimals: 18, amount: "500000000000000" },
          { symbol: "NVDA", address: NVDA, decimals: 18, amount: "4158000000000000" },
          { symbol: "BROKEN", address: NVDA, decimals: "x", amount: "1" },
        ],
        cap: 25,
      });
    });
    const trader = await tradeWith(http as typeof fetch).trader("stocks-robinhood");
    expect(trader).toEqual({
      delegated: true,
      wallet: WALLET,
      chainId: 4663,
      gas: { ok: true, wei: "500000000000000" },
      balances: [
        { symbol: "USDG", address: USDG, decimals: 6, amount: "25000000" },
        { symbol: "ETH", address: null, decimals: 18, amount: "500000000000000" },
        { symbol: "NVDA", address: NVDA, decimals: 18, amount: "4158000000000000" },
      ],
      cap: 25,
      capBy: null,
      capReason: null,
      input: null,
      marketAvailable: true,
    });
  });

  it("reads balances given as raw and formatted, the gas as an object and the cap with who set it", async () => {
    const http = vi.fn(async () =>
      reply(200, {
        ok: true,
        module: "stocks-robinhood",
        delegated: true,
        wallet: WALLET,
        chain: "robinhood",
        chainId: 4663,
        input: { symbol: "USDG", address: USDG, decimals: 6 },
        gas: { symbol: "ETH", raw: "0", formatted: "0" },
        balances: [
          { symbol: "USDG", ticker: null, address: USDG, decimals: 6, raw: "20000000", formatted: "20" },
          { symbol: "NVDA", ticker: "NVDA", address: NVDA, decimals: 18, formatted: "0.5" },
        ],
        cap: { amount: "10", symbol: "USDG", source: "owner", reason: "owner-limit" },
        marketAvailable: false,
      }),
    );
    await expect(tradeWith(http as unknown as typeof fetch).trader("stocks-robinhood")).resolves.toEqual({
      delegated: true,
      wallet: WALLET,
      chainId: 4663,
      gas: { ok: false, wei: "0" },
      balances: [
        { symbol: "USDG", address: USDG, decimals: 6, amount: "20000000" },
        { symbol: "NVDA", address: NVDA, decimals: 18, amount: "500000000000000000" },
      ],
      cap: 10,
      capBy: "owner",
      capReason: "owner-limit",
      input: { symbol: "USDG", address: USDG, decimals: 6 },
      marketAvailable: false,
    });
  });

  it("keeps why the cap is the platform's, and drops a reason it does not know", async () => {
    const read = (cap: unknown) =>
      tradeWith(vi.fn(async () => reply(200, { delegated: true, wallet: WALLET, chainId: 4663, gas: "1", balances: [], cap })) as unknown as typeof fetch).trader("stocks-robinhood");
    for (const reason of ["no-rule-for-chain", "owner-limit-above-platform", "no-owner-limit"]) {
      await expect(read({ amount: "100", source: "platform", reason })).resolves.toMatchObject({ cap: 100, capBy: "platform", capReason: reason });
    }
    await expect(read({ amount: "100", source: "platform", reason: "because" })).resolves.toMatchObject({ capReason: null });
  });

  it("refuses a Trader on another chain than the one asked for", async () => {
    const http = vi.fn(async () => reply(200, { delegated: true, wallet: WALLET, chainId: 8453, gas: "1", balances: [], cap: 25 }));
    const trade = tradeWith(http as unknown as typeof fetch);
    await expect(trade.trader("stocks-robinhood", 4663)).rejects.toMatchObject({ code: "TRADER_CHAIN", status: 502 });
    // Without an expected chain it reads as before.
    await expect(trade.trader("stocks-robinhood")).resolves.toMatchObject({ chainId: 8453 });
  });

  it("says no gas when the wallet holds none, whatever shape PerkOS used for it", async () => {
    const read = (gas: unknown, balances: unknown[] = []) =>
      tradeWith(vi.fn(async () => reply(200, { delegated: true, wallet: WALLET, chainId: 4663, gas, balances, cap: "25" })) as unknown as typeof fetch).trader("stocks-robinhood");
    expect((await read("0")).gas).toEqual({ ok: false, wei: "0" });
    expect((await read("0.0005")).gas).toEqual({ ok: true, wei: "500000000000000" });
    expect((await read(false, [{ symbol: "ETH", address: null, decimals: 18, amount: "1" }])).gas).toEqual({ ok: false, wei: "1" });
    expect((await read(undefined)).gas).toEqual({ ok: false, wei: null });
    expect((await read("0")).cap).toBe(25);
  });

  it("is not delegated without a wallet, and names no cap it was not given", async () => {
    const http = vi.fn(async () => reply(200, { delegated: false, wallet: null, chainId: 4663, gas: null, balances: [], cap: null }));
    await expect(tradeWith(http as unknown as typeof fetch).trader("stocks-robinhood")).resolves.toMatchObject({ delegated: false, wallet: null, cap: 0 });
  });

  it("refuses a Trader it cannot read", async () => {
    const http = vi.fn(async () => reply(200, { delegated: "yes", balances: [] }));
    await expect(tradeWith(http as unknown as typeof fetch).trader("stocks-robinhood")).rejects.toMatchObject({ code: "TRADER_SHAPE", status: 502 });
  });
});

describe("a quote", () => {
  const quote = {
    chainId: 4663,
    ticker: "NVDA",
    tokenIn: { symbol: "USDG", address: USDG, decimals: 6 },
    tokenOut: { symbol: "NVDA", address: NVDA, decimals: 18 },
    amountIn: "1000000",
    amountOut: "4200000000000000",
    priceImpactPct: 0.12,
    routing: "CLASSIC",
    protocols: ["V4"],
    route: [],
    gasFeeUsd: 0.01,
    requestId: "req-1",
    quotedAt: "2026-09-26T12:00:00.000Z",
    attribution: "Uniswap",
  };

  it("asks for the ticker and the amount in USDG, and keeps what the screen shows", async () => {
    const http = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/quote?ticker=NVDA&amountUsdg=1.5");
      return reply(200, { ok: true, ...quote });
    });
    await expect(tradeWith(http as typeof fetch).quote("stocks-robinhood", "NVDA", "1.5")).resolves.toEqual({
      chainId: 4663,
      ticker: "NVDA",
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: "1000000",
      amountOut: "4200000000000000",
      priceImpactPct: 0.12,
      routing: "CLASSIC",
      protocols: ["V4"],
      requestId: "req-1",
      quotedAt: "2026-09-26T12:00:00.000Z",
      gasFeeUsd: 0.01,
    });
  });

  it("reads a quote wrapped under quote, and refuses one that pays nothing", async () => {
    const wrapped = vi.fn(async () => reply(200, { ok: true, quote: { ...quote, protocols: "V4" } }));
    await expect(tradeWith(wrapped as unknown as typeof fetch).quote("stocks-robinhood", "NVDA", "1")).resolves.toMatchObject({ protocols: ["V4"] });
    const empty = vi.fn(async () => reply(200, { ...quote, amountOut: "0" }));
    await expect(tradeWith(empty as unknown as typeof fetch).quote("stocks-robinhood", "NVDA", "1")).rejects.toMatchObject({ code: "QUOTE_SHAPE" });
  });

  it("keeps the chain and the stock as the desk named them, not as they were asked for", async () => {
    const other = vi.fn(async () => reply(200, { ...quote, chainId: 1, ticker: "AAPL" }));
    await expect(tradeWith(other as unknown as typeof fetch).quote("stocks-robinhood", "NVDA", "1")).resolves.toMatchObject({ chainId: 1, ticker: "AAPL" });
    const { chainId: _c, ticker: _t, ...unnamed } = quote;
    const silent = vi.fn(async () => reply(200, unnamed));
    await expect(tradeWith(silent as unknown as typeof fetch).quote("stocks-robinhood", "NVDA", "1")).resolves.toMatchObject({ chainId: null, ticker: null });
  });
});

describe("a buy", () => {
  const input = { ticker: "NVDA", amountUsdg: "1", maxSlippageBps: 100, quotedAmountOut: "4200000000000000" };
  const buyWith = (body: unknown) => tradeWith(vi.fn(async () => reply(200, body)) as unknown as typeof fetch).buy("stocks-robinhood", input);

  it("gives PerkOS at least 180 s to answer", () => {
    expect(DeskTrade.BUY_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it("sends exactly the approved order, the quote included, and returns the receipt with every step", async () => {
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/orders/buy");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(input);
      return reply(200, {
        ok: true,
        bought: true,
        status: "success",
        hash: "0xfeed",
        explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed",
        amountOut: "4190000000000000",
        steps: [
          { kind: "approve", hash: "0xa11", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xa11" },
          { kind: "permit2", hash: "0xb22", status: "success", explorerUrl: null },
          { kind: "swap", hash: "0xfeed", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed" },
          { nope: true },
        ],
        notice: null,
      });
    });
    await expect(tradeWith(http as typeof fetch).buy("stocks-robinhood", input)).resolves.toEqual({
      status: "success",
      bought: true,
      hash: "0xfeed",
      explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed",
      amountOut: "4190000000000000",
      steps: [
        { kind: "approve", hash: "0xa11", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xa11" },
        { kind: "permit2", hash: "0xb22", status: "success", explorerUrl: null },
        { kind: "swap", hash: "0xfeed", status: "success", explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xfeed" },
      ],
      notice: null,
    });
  });

  it("reads an order that stopped before the swap as nothing bought, and keeps no approval's hash as the order's", async () => {
    await expect(
      buyWith({
        ok: true,
        bought: false,
        status: "not_sent",
        hash: "0xa11",
        explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xa11",
        amountOut: null,
        steps: [{ kind: "approve", hash: "0xa11", status: "success", explorerUrl: null }],
        notice: "The price moved: ask for a new quote",
      }),
    ).resolves.toEqual({
      status: "not_sent",
      bought: false,
      hash: null,
      explorerUrl: null,
      amountOut: null,
      steps: [{ kind: "approve", hash: "0xa11", status: "success", explorerUrl: null }],
      notice: "The price moved: ask for a new quote",
    });
  });

  it("reads a swap that was sent and not confirmed as neither bought nor not bought", async () => {
    await expect(buyWith({ ok: true, bought: null, status: "pending", hash: "0xfeed", explorerUrl: null, amountOut: null, steps: [], notice: null })).resolves.toMatchObject({
      status: "pending",
      bought: null,
      hash: "0xfeed",
    });
    await expect(buyWith({ ok: true, bought: false, status: "reverted", hash: "0xfeed", explorerUrl: null, amountOut: null, steps: [], notice: null })).resolves.toMatchObject({
      status: "reverted",
      bought: false,
    });
  });

  it("takes a verdict only when the swap status agrees with it", async () => {
    const said = (status: string, bought: unknown) => buyWith({ ok: true, bought, status, hash: "0xfeed", steps: [] });
    await expect(said("success", false)).resolves.toMatchObject({ bought: null });
    await expect(said("pending", true)).resolves.toMatchObject({ bought: null });
    await expect(said("pending", false)).resolves.toMatchObject({ bought: null });
    await expect(said("reverted", true)).resolves.toMatchObject({ bought: null });
    await expect(said("success", undefined)).resolves.toMatchObject({ bought: null });
    await expect(said("not_sent", true)).resolves.toMatchObject({ bought: null, hash: null });
  });

  it("reads the reason an older PerkOS gave as { code, message }", async () => {
    await expect(buyWith({ ok: true, bought: false, status: "not_sent", steps: [], notice: { code: "STALE_ORDER", message: "The price moved" } })).resolves.toMatchObject({
      notice: "The price moved",
    });
  });

  it("refuses a status it cannot read, and a sent swap without its hash", async () => {
    await expect(buyWith({ ok: true, hash: "0xfeed", status: "mined?", steps: [] })).rejects.toMatchObject({ code: "RECEIPT_SHAPE", status: 502 });
    await expect(buyWith({ ok: true, bought: true, status: "success", steps: [] })).rejects.toMatchObject({ code: "RECEIPT_SHAPE" });
    await expect(buyWith({ ok: true, bought: null, status: "pending", hash: null, steps: [] })).rejects.toMatchObject({ code: "RECEIPT_SHAPE" });
  });

  it("keeps the code PerkOS nests under error, so the screen can say what to do", async () => {
    const http = vi.fn(async () => reply(409, { error: { message: "The Trader needs a little ETH for gas", code: "TRADER_NEEDS_GAS" } }));
    await expect(tradeWith(http as unknown as typeof fetch).buy("stocks-robinhood", input)).rejects.toMatchObject({
      status: 409,
      code: "TRADER_NEEDS_GAS",
      message: "The Trader needs a little ETH for gas",
    });
  });
});

describe("sending a token home", () => {
  it("names only the token, or the token and an amount, never a destination", async () => {
    const bodies: unknown[] = [];
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.perkos.xyz/desks/stocks-robinhood/sweep");
      bodies.push(JSON.parse(String(init?.body)));
      return reply(200, { ok: true, hash: "0xbeef", status: "pending", explorerUrl: null });
    });
    const trade = tradeWith(http as typeof fetch);
    await expect(trade.sweep("stocks-robinhood", NVDA)).resolves.toEqual({ hash: "0xbeef", status: "pending", explorerUrl: null });
    await trade.sweep("stocks-robinhood", USDG, "1000000");
    expect(bodies).toEqual([{ token: NVDA }, { token: USDG, amount: "1000000" }]);
  });
});

describe("amounts in atomic units", () => {
  it("keeps atomic strings and converts whole units with a decimal point", () => {
    expect(fromWhole("20", 6)).toBe("20000000");
    expect(fromWhole(".5", 6)).toBe("500000");
    expect(atomic("25000000", 6)).toBe("25000000");
    expect(atomic("1.5", 6)).toBe("1500000");
    expect(atomic(0.0005, 18)).toBe("500000000000000");
    expect(atomic("0.1234567", 6)).toBe("123456");
    expect(atomic("-1", 6)).toBeNull();
    expect(atomic("abc", 6)).toBeNull();
  });
});

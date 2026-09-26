/**
 * The Trader's plan in a finished turn: the stock it names first among the
 * facts and the size it starts with, capped at one order. An answer that says
 * to wait, in English or in Spanish, has no plan.
 */

import { describe, expect, it } from "vitest";

import type { RoleReply, TurnEvent, TurnRecord } from "../app/lib/turnRecord";
import { sizesIn } from "../app/lib/turnLint";
import { planOfRecord, planOfView, readPlan } from "../app/turn/turnPlan";
import { idleTurn, reduceTurn, stopLocally } from "../app/turn/turnState";

const FACTS = [
  "[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable. 7-day range 172.10 to 184.00 USDG (pool).",
  "[F2] AAPL (Apple): 228.40 USDG at 14:30, -0.40% in 24h, tradeable.",
  "[F3] BRK.B (Berkshire Hathaway): 471.00 USDG at 14:30, +0.10% in 24h, tradeable.",
  "[F4] Uniswap now: 50.00 USDG buys 0.2741 NVDA (182.42 USDG each), price impact 0.12%, UniswapX route.",
];
const plan = (reply: string, extra: Partial<Parameters<typeof readPlan>[0]> = {}) => readPlan({ reply, facts: FACTS, maxOrder: 100, quote: "USDG", ...extra });

describe("the Trader's plan", () => {
  it("takes the stock the Trader names first and the size it starts with", () => {
    expect(plan("@Sparky Entry plan for AAPL [F2]: 40 USDG, take profit at 240, stop at 220. Add NVDA on a dip.")).toEqual({ ticker: "AAPL", amount: 40 });
    expect(plan("@Sparky Buy 50 USDG of NVDA [F1] now, take profit at 190 USDG, stop at 172 USDG or exit in 5 days.")).toEqual({ ticker: "NVDA", amount: 50 });
    expect(plan("@Sparky Start with $60 in NVDA [F1]; take profit 195, stop 172.")).toEqual({ ticker: "NVDA", amount: 60 });
  });

  it("starts with the entry, not with the size for the second pick", () => {
    expect(plan("@Sparky Entry plan for AAPL [F2]: 40 USDG, take profit at 240, stop at 220. Add NVDA [F1] with 60 USDG if it holds 180.")).toEqual({
      ticker: "AAPL",
      amount: 40,
    });
  });

  it("never reads Uniswap as the stock, and needs the stock named with the size", () => {
    expect(plan("@Sparky Entry through Uniswap [F4]: 50 USDG of NVDA [F1], take profit at 190, stop at 172.")).toEqual({ ticker: "NVDA", amount: 50 });
    // Named only in a later sentence, the stock is another pick, not the one this size buys.
    expect(plan("@Sparky Entry: 50 USDG via Uniswap, take profit at 190, stop at 172. Pair it with AAPL [F2] later.")).toBeNull();
  });

  it("caps the size at what one order may spend", () => {
    expect(plan("@Sparky Size 150 USDG into NVDA [F1].")).toEqual({ ticker: "NVDA", amount: 100 });
    expect(plan("@Sparky Size 150 USDG into NVDA [F1].", { maxOrder: undefined })).toEqual({ ticker: "NVDA", amount: 150 });
  });

  it("reads a plan said in Spanish", () => {
    expect(plan("@Sparky Plan de entrada para NVDA [F1]: 50 USDG, toma de ganancias en 190, stop en 172. Añadir AAPL [F2] si mantiene 228.")).toEqual({
      ticker: "NVDA",
      amount: 50,
    });
    expect(plan("@Sparky Compraría AAPL [F2] con 40 USDG, objetivo 240 USDG, stop en 220 USDG.")).toEqual({ ticker: "AAPL", amount: 40 });
    expect(plan("@Sparky Posición de 250 USDG en NVDA [F1], salida por tiempo en 5 días.")).toEqual({ ticker: "NVDA", amount: 100 });
    expect(plan("@Sparky Entrada de 35,5 dólares en BRK.B [F3].")).toEqual({ ticker: "BRK.B", amount: 35.5 });
  });

  it("has no plan when the Trader would wait or not buy, in English", () => {
    for (const reply of [
      "@Sparky I would WAIT for the reference to unfreeze [F1]. If NVDA holds 180, start with 30 USDG.",
      "@Sparky No entry today: the reference is frozen [F1]. At the next close, buy 30 USDG of NVDA if it holds.",
      "@Sparky Hold off on NVDA [F1] until it reclaims 184; then buy 40 USDG.",
      "@Sparky Stand aside for now. NVDA [F1] sits at the top of its range; size 30 USDG only after a pullback.",
      "@Sparky I would not buy NVDA [F1] here. Next week, add 40 USDG on a pullback to 175.",
      "@Sparky Entry: wait for the open, then 50 USDG of NVDA [F1].",
      "@Sparky Stay on the sidelines; if NVDA [F1] closes above 184, buy 40 USDG.",
    ]) {
      expect(sizesIn(reply, "USDG").length, reply).toBeGreaterThan(0);
      expect(plan(reply), reply).toBeNull();
    }
  });

  it("has no plan when the Trader would wait or not buy, in Spanish", () => {
    for (const reply of [
      "@Sparky Esperaría: la referencia está congelada [F1]. Si NVDA se mantiene en 180, entrar con 30 USDG.",
      "@Sparky Mejor esperar al cierre [F1]; después, posición de 30 USDG en NVDA.",
      "@Sparky No compraría NVDA [F1] hoy. La próxima semana, entrada de 40 USDG.",
      "@Sparky Espera. NVDA [F1] está arriba del rango; compra de 30 USDG solo tras un retroceso.",
      "@Sparky Me quedaría al margen hasta el cierre [F1]; después, entrada de 40 USDG en NVDA.",
    ]) {
      expect(sizesIn(reply, "USDG").length, reply).toBeGreaterThan(0);
      expect(plan(reply), reply).toBeNull();
    }
  });

  it("keeps a plan that says to wait only after its entry, about something else", () => {
    expect(plan("@Sparky Buy 50 USDG of NVDA [F1] now, take profit at 190, stop at 172; wait on AAPL [F2] until it reclaims 230.")).toEqual({
      ticker: "NVDA",
      amount: 50,
    });
    expect(plan("@Sparky Don't wait for a dip: buy 40 USDG of NVDA [F1] now, stop at 172.")).toEqual({ ticker: "NVDA", amount: 40 });
    expect(plan("@Sparky Compra 40 USDG de AAPL [F2] ahora; esperaría a que NVDA [F1] recupere 184 para añadirlo.")).toEqual({ ticker: "AAPL", amount: 40 });
  });

  it("has no plan without a size, without a stock of the facts, or once Risk blocked the order", () => {
    expect(plan("@Sparky Entry plan for NVDA [F1]: a small size, take profit at 190, stop at 172.")).toBeNull();
    expect(plan("@Sparky TSLA looks better to me: buy 50 USDG.")).toBeNull();
    expect(plan("@Sparky Buy 50 USDG of NVDA [F1].", { verdict: "BLOCK" })).toBeNull();
    expect(plan("@Sparky Buy 50 USDG of NVDA [F1].", { verdict: "GO" })).toEqual({ ticker: "NVDA", amount: 50 });
    expect(plan("   ")).toBeNull();
  });
});

const ID = "20260926-143200-ab12";
const T0 = Date.parse("2026-09-26T14:32:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const TRADER = "@Sparky Entry plan for AAPL [F2]: 40 USDG, take profit at 240, stop at 220. Add NVDA on a dip.";
const events = (trader: Extract<TurnEvent, { step: "reply" }>): TurnEvent[] => [
  { step: "open", turnId: ID, kind: "advise", desk: "eqlty-desk", question: "What should I buy this month?", principal: "@Scout @Risk ...", facts: FACTS, roles: ["scout", "risk", "trader", "auditor"], at: at(0) },
  { step: "start", role: "trader", phase: 2, at: at(20) },
  trader,
];
const run = (list: TurnEvent[]) => list.reduce((v, e) => reduceTurn(v, e, T0), idleTurn);
const done: TurnEvent = { step: "done", turnId: ID, replies: [], flags: [], ms: 42_000, kept: "vault" };
const delivered = { step: "reply", role: "trader", phase: 2, ok: true, reply: TRADER, ms: 15_100 } as const;

describe("a turn's plan in the window", () => {
  it("waits for the turn to be over", () => {
    const live = run(events(delivered));
    expect(planOfView(live, 100)).toBeNull();
    expect(planOfView(run([...events(delivered), done]), 100)).toEqual({ ticker: "AAPL", amount: 40 });
    expect(planOfView(idleTurn, 100)).toBeNull();
  });

  it("keeps the plan of a turn the person stopped once the Trader had answered", () => {
    expect(planOfView(stopLocally(run(events(delivered)), T0 + 60_000), 100)).toEqual({ ticker: "AAPL", amount: 40 });
  });

  it("has none when the Trader gave no answer, even one that arrived looking like one", () => {
    const failed = run([...events({ step: "reply", role: "trader", phase: 2, ok: false, reply: "", failure: "timeout", ms: 85_000 }), done]);
    expect(planOfView(failed, 100)).toBeNull();
    const disguised = run([...events({ ...delivered, reply: "API call failed after 3 retries: HTTP 502: upstream_failed" }), done]);
    expect(planOfView(disguised, 100)).toBeNull();
  });
});

describe("a kept turn's plan", () => {
  const reply = (extra: Partial<RoleReply> = {}): RoleReply => ({ role: "trader", phase: 2, ok: true, reply: TRADER, ms: 15_100, ...extra });
  const record = (replies: RoleReply[], extra: Partial<TurnRecord> = {}): Pick<TurnRecord, "replies" | "facts" | "verdict"> => ({ replies, facts: FACTS, ...extra });

  it("reads the Trader's answer as it was kept", () => {
    expect(planOfRecord(record([reply()]), 100)).toEqual({ ticker: "AAPL", amount: 40 });
    expect(planOfRecord(record([reply({ reply: "@Sparky Size 150 USDG into NVDA [F1]." })]), 100)).toEqual({ ticker: "NVDA", amount: 100 });
  });

  it("has none without the Trader's answer, for a runtime's failure, or once Risk blocked the order", () => {
    expect(planOfRecord(record([]), 100)).toBeNull();
    expect(planOfRecord(record([reply({ ok: false, reply: "", failure: "model" })]), 100)).toBeNull();
    expect(planOfRecord(record([reply({ reply: "API call failed after 3 retries: HTTP 502: upstream_failed" })]), 100)).toBeNull();
    expect(planOfRecord(record([reply()], { verdict: "BLOCK" }), 100)).toBeNull();
  });
});

/**
 * The Trader opened from a desk turn's plan: the form starts on the plan's
 * stock and amount and says where they came from. Nothing is quoted or
 * signed by that; the owner still asks for the quote and holds to approve.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { clockOf } from "../app/desks/history";
import { WalletTraderSheet, type TraderPrefill } from "../app/desks/WalletTraderSheet";

const STARTED = Date.parse("2026-09-26T14:32:00.000Z");
const html = (prefill: TraderPrefill | null) =>
  renderToStaticMarkup(createElement(WalletTraderSheet, { title: "EQLTY Desk", module: "stocks-robinhood", chain: "robinhood", onClose: () => undefined, prefill })).replace(
    /<!-- -->/g,
    "",
  );

describe("the Trader opened from the desk's plan", () => {
  it("starts on the plan's stock and amount, and says where they came from", () => {
    const out = html({ turnId: "20260926-143200-ab12", ticker: "NVDA", amount: 50, startedAt: STARTED, key: 1 });
    expect(out).toContain(`<span class="tr-plan-kicker">From the desk&#x27;s plan · ${clockOf(new Date(STARTED).toISOString())}</span>`);
    expect(out).toContain("<b>NVDA</b> for <b>50 USDG</b>, as the Trader planned it.");
    expect(out).toContain("Nothing is bought until you get a quote and hold to approve, and the receipt stays with the turn.");
    expect(out).toMatch(/<input type="number"[^>]*value="50"/);
  });

  it("quotes and signs nothing by itself: the owner still asks for the quote", () => {
    const out = html({ turnId: "20260926-143200-ab12", ticker: "NVDA", amount: 50, startedAt: STARTED, key: 1 });
    expect(out).toContain(">Get a quote</button>");
    expect(out).not.toContain("hold-btn");
  });

  it("opens on the empty form when nothing was planned", () => {
    const out = html(null);
    expect(out).not.toContain("tr-plan");
    expect(out).toMatch(/<input type="number"[^>]*value="1"/);
  });
});

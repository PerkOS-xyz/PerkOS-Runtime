/**
 * The launch card's rules without a browser: which words open it, what its
 * form sends, which pairs it shows, and what an answer to a launch means.
 */

import { describe, expect, it, vi } from "vitest";

import { parsePairs } from "../app/lib/bankrLaunch";
import { LAUNCH_UNCONFIRMED } from "../app/desks/launch";
import { draftKey, formKey, formReady, isLaunchOutcome, launchBody, launchIntent, launchOutcome, pairChips, seedForm, sendLaunch, suggestSymbol } from "../app/desks/launchForm";
import { isLaunchSummary } from "../app/desks/launchStore";
import { BANKR_WALLET, POOL, QUOTES, TOKEN, TX, WALLET } from "./bankrFixtures";

const RECEIPT = {
  tokenAddress: TOKEN,
  poolId: POOL,
  txHash: TX,
  chain: "robinhood",
  name: "Night Owl",
  symbol: "OWL",
  pairedSymbol: "NVDA",
  pairAddress: null,
  feeRecipient: WALLET,
  deployer: BANKR_WALLET,
  deployedAt: "2026-09-27T01:00:00.000Z",
  links: { uniswap: "https://app.uniswap.org/x", bankr: "https://bankr.bot/launches/x", explorer: "https://robinhoodchain.blockscout.com/token/x" },
};

describe("launch intent", () => {
  it("opens the card when the person asks to launch a token, in English or Spanish, with the pair they named", () => {
    expect(launchIntent("launch a token paired with NVDA")).toEqual({ pair: "nvda" });
    expect(launchIntent("Launch a token paired with NVDA")).toEqual({ pair: "nvda" });
    expect(launchIntent("lanza un token con NVDA")).toEqual({ pair: "nvda" });
    expect(launchIntent("Lánzame un token emparejado con Tesla")).toEqual({ pair: "tesla" });
    expect(launchIntent("Sparky, deploy a new coin against $SPY")).toEqual({ pair: "spy" });
    expect(launchIntent("I want to launch my own token")).toEqual({});
    expect(launchIntent("quiero crear una moneda")).toEqual({});
  });

  it("keeps a name and a symbol the person gave", () => {
    expect(launchIntent("create a coin called Night Owl with symbol OWL paired with AAPL")).toEqual({ name: "Night Owl", symbol: "OWL", pair: "aapl" });
    expect(launchIntent('launch a token named "Moon Desk" paired with TSLA')).toEqual({ name: "Moon Desk", pair: "tsla" });
  });

  it("leaves questions and other requests to Sparky", () => {
    expect(launchIntent("How do I launch a token?")).toBeNull();
    expect(launchIntent("What does launching a token cost?")).toBeNull();
    expect(launchIntent("¿Cómo lanzo un token?")).toBeNull();
    expect(launchIntent("Launch the market")).toBeNull();
    expect(launchIntent("Buy NVDA with 10 USDG")).toBeNull();
    expect(launchIntent("")).toBeNull();
  });

  it("does not take a word after 'with' for a pair when it is not one", () => {
    expect(launchIntent("launch a token with vesting")).toEqual({});
    expect(launchIntent("lanza un token con mi logo")).toEqual({});
  });
});

describe("launch form", () => {
  it("starts from what the person said, with Bankr's defaults", () => {
    expect(seedForm({ pair: "nvda", name: "Night Owl" })).toEqual({
      name: "Night Owl",
      symbol: "NIGH",
      pair: "nvda",
      feesTo: "wallet",
      description: "",
      image: "",
      vesting: true,
      quoteOnlyFees: false,
    });
    expect(suggestSymbol("d/acc 2")).toBe("DACC");
  });

  it("sends a cleaned form, and a check is good only for the form it checked", () => {
    const form = { ...seedForm({ pair: "NVDA" }), name: "  Night Owl ", symbol: "owl!", description: " Hi " };
    expect(launchBody(form)).toEqual({ name: "Night Owl", symbol: "OWL", pair: "NVDA", feesTo: "wallet", description: "Hi", image: "", vesting: true, quoteOnlyFees: false });
    expect(launchBody(form, "0xabc").pair).toBe("0xabc");
    expect(formKey(form)).toBe(formKey({ ...form }));
    expect(formKey(form)).not.toBe(formKey({ ...form, vesting: false }));
    expect(formReady(form)).toBe(true);
    expect(formReady({ ...form, pair: " " })).toBe(false);
  });

  it("shows the first stocks, then WETH, the picked pair even further down, and what a search matches", () => {
    const pairs = parsePairs(QUOTES);
    expect(pairChips(pairs, "", "", 2).map((p) => p.symbol)).toEqual(["NVDA", "TSLA", "WETH"]);
    expect(pairChips(pairs, "", "GLW", 2).map((p) => p.symbol)).toEqual(["GLW", "NVDA", "TSLA", "WETH"]);
    expect(pairChips(pairs, "cor", "").map((p) => p.symbol)).toEqual(["GLW"]);
    expect(pairChips(pairs, "$bnk", "").map((p) => p.symbol)).toEqual(["BNKR"]);
  });
});

describe("launch outcome", () => {
  it("reads a launch as live only with a receipt, as refused only when nothing was sent, and anything else as in doubt", () => {
    expect(launchOutcome(201, { receipt: RECEIPT })).toEqual({ kind: "live", receipt: RECEIPT });
    expect(launchOutcome(403, { error: "X", message: "Bankr refused: no.", sent: false })).toEqual({ kind: "refused", message: "Bankr refused: no." });
    expect(launchOutcome(504, { error: "unconfirmed", message: "Maybe.", sent: null })).toEqual({ kind: "unconfirmed", message: "Maybe." });
    expect(launchOutcome(500, "not json")).toEqual({ kind: "unconfirmed", message: LAUNCH_UNCONFIRMED });
    expect(launchOutcome(201, { receipt: { tokenAddress: "nope" } })).toEqual({ kind: "unconfirmed", message: LAUNCH_UNCONFIRMED });
  });

  it("posts the launch to the deploy route", async () => {
    const http = vi.fn(async () => Response.json({ receipt: RECEIPT }, { status: 201 }));
    const body = launchBody(seedForm({ pair: "NVDA", name: "Night Owl" }), "0xpair");
    expect(await sendLaunch(body, http as unknown as typeof fetch)).toMatchObject({ kind: "live" });
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/launch/deploy");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("brings back after a reload only what the card can draw", () => {
    expect(isLaunchOutcome({ kind: "live", receipt: RECEIPT })).toBe(true);
    expect(isLaunchOutcome({ kind: "live", receipt: {} })).toBe(false);
    expect(isLaunchOutcome({ kind: "unconfirmed", message: "x" })).toBe(true);
    expect(isLaunchSummary({ name: "Night Owl", symbol: "OWL", pairedSymbol: "NVDA", deployer: BANKR_WALLET })).toBe(true);
    expect(isLaunchSummary({ name: "Night Owl" })).toBe(false);
  });
});

describe("the draft the team reads", () => {
  it("is keyed by what would launch, whatever the checks said, so the same draft goes to the team once", () => {
    const draft = { name: "Night Owl", symbol: "OWL", pair: { address: "0xD0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" }, feesTo: "wallet", vesting: true, quoteOnlyFees: false, description: "", image: "" };
    expect(draftKey(draft)).toBe(draftKey({ ...draft, pair: { address: draft.pair.address.toLowerCase() } }));
    expect(draftKey(draft)).not.toBe(draftKey({ ...draft, feesTo: "bankr" }));
    expect(draftKey(draft)).not.toBe(draftKey({ ...draft, symbol: "OWLS" }));
  });
});

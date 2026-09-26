import { DeskTrade } from "@perkos/client";

import { MAX_SLIPPAGE_BPS } from "../../../desks/trade";
import { guard } from "../../../lib/guard";
import { perkosClient } from "../../../lib/perkos";
import { errorResponse } from "../../../lib/respond";

const MODULE = /^[a-z][a-z0-9-]{0,31}$/;
const TICKER = /^[A-Za-z0-9.\-]{1,16}$/;
const USDG = /^\d{1,7}(\.\d{1,6})?$/;
const UINT = /^\d{1,78}$/;

// POST { module, ticker, amountUsdg, maxSlippageBps, quotedAmountOut } -> { receipt }
//   buys with the wallet the owner delegated. The desk calls this only after
//   the owner holds to approve; PerkOS prices the order again, checks it
//   against the Trader's policy and the quote, and signs it through Dynamic.
//   The quote the owner saw is required: it sets the minimum the swap is held to.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const module = typeof body.module === "string" ? body.module.trim() : "";
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  const amount = typeof body.amountUsdg === "number" || typeof body.amountUsdg === "string" ? String(body.amountUsdg).trim() : "";
  const slippage = body.maxSlippageBps;
  const quoted = body.quotedAmountOut;
  if (
    !MODULE.test(module) ||
    !TICKER.test(ticker) ||
    !USDG.test(amount) ||
    !(Number(amount) > 0) ||
    typeof slippage !== "number" ||
    !Number.isInteger(slippage) ||
    slippage < 1 ||
    slippage > MAX_SLIPPAGE_BPS ||
    typeof quoted !== "string" ||
    !UINT.test(quoted) ||
    BigInt(quoted) === 0n
  ) {
    return Response.json(
      { error: "input", message: `The order needs a desk, a stock, an amount, a slippage from 1 to ${MAX_SLIPPAGE_BPS} bps and the quote you saw.` },
      { status: 400 },
    );
  }
  const client = await perkosClient();
  if (!client) return Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 });
  try {
    // "01.50" and "1.5" are the same order; PerkOS reads the plain decimal.
    const amountUsdg = String(Number(amount));
    const receipt = await new DeskTrade(client).buy(module, { ticker, amountUsdg, maxSlippageBps: slippage, quotedAmountOut: quoted });
    return Response.json({ receipt });
  } catch (err) {
    return errorResponse(err);
  }
}

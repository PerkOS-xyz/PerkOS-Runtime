"use client";

import type { DeskQuote, DeskTrader, TraderBalance } from "@perkos/client";
import type { DeskAsset } from "@perkos/desk-contract";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { buyRun, dismissBuy, startBuy, subscribeBuys, type BuyRun } from "./buyStore";
import type { Chain } from "./chains";
import { clockOf } from "./history";
import { createHold } from "./hold";
import { dismissSweep, startSweep, subscribeSweeps, sweepRun, type SweepRun } from "./sweepStore";
import {
  aboutAmount,
  addressUrl,
  arrived,
  boundAmount,
  buyOpen,
  buyReason,
  capNote,
  fundsOf,
  heldOf,
  minAfterSlippage,
  outcomeDismissible,
  planAmount,
  priceCheck,
  quoteMismatch,
  quoteSecondsLeft,
  readable,
  recheckBuy,
  RECHECK_MS,
  receiptView,
  revokeAllowed,
  sendHomeAllowed,
  sendSweep,
  short,
  showAmount,
  SLIPPAGE_BPS,
  SLIPPAGE_CHOICES,
  slippageOk,
  STEP_LABEL,
  STEP_STATE,
  sweepUnsettled,
  sweepView,
  txUrl,
  unresolved,
  usd,
  type PlanCap
} from "./trade";
import { sendBuyForTurn } from "./turnReceipts";
import { useMarket } from "./useMarket";
import { useTrader } from "./useTrader";
import { WorldDelegationNote } from "../world/WorldDelegationNote";
import { delegationChanged, delegationLink, delegationMode, effectiveOrderCap, worldApprovalRequired } from "./delegation";

const HOLD_MS = 1600;
const WAIT_MS = 3 * 60_000;
const AMOUNT = /^\d{1,7}(\.\d{1,6})?$/;
const name = (a: DeskAsset | undefined) => a?.name.split(" • ")[0] ?? "";

/** What Buy in Trader fills the Trader with: the plan of a finished desk turn. */
export interface TraderPrefill {
  /** The desk turn whose plan this is: a buy from it names the turn to PerkOS and keeps its receipt there. */
  turnId: string;
  /** One of the desk's tickers. */
  ticker: string;
  /** Whole USDG, as the plan says it. The form never starts above the sheet's own limit. */
  amount: number;
  /** When the turn started, for the note above the form. */
  startedAt: number | null;
  /** Each press of Buy in Trader starts the form over, even for the same plan. */
  key: number;
}

/**
 * The Trader on a desk that buys from a wallet the owner delegated. The owner
 * gives access on a PerkOS page in the browser; the money sits in that wallet;
 * a buy runs only after a quote and a hold, and PerkOS signs it through
 * Dynamic inside the owner's limits. What the wallet buys stays there until
 * the owner sends it home.
 *
 * Opened from a desk turn's plan, the form starts on the plan's stock and
 * amount. Nothing is quoted or signed by that: the owner still asks for the
 * quote and holds to approve, and one buy from it keeps its receipt with the turn.
 */
export function WalletTraderSheet({
  title,
  module,
  chain,
  agentId,
  onClose,
  prefill = null,
  onPlanUsed
}: {
  title: string;
  module: string;
  chain: Chain;
  agentId?: string;
  onClose: () => void;
  prefill?: TraderPrefill | null;
  /** A buy from the plan went out: the plan has done its part. */
  onPlanUsed?: () => void;
}) {
  const { trader, error, loading, load } = useTrader(module);
  const { market } = useMarket(module);
  const buy = useBuyRun(module);
  const sweep = useSweepRun(module);
  // A buy or a transfer home that PerkOS is still signing: revoking now could leave an approval out with nothing bought.
  const moving = !revokeAllowed(buy, sweep);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className={`mk-sheet tr-sheet ${chain}`} aria-label={`${title} trader`}>
      <div className="mk-sheet-bar">
        <span className="kicker">Trader</span>
        <button type="button" className="bubble-close" aria-label="Close the trader" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="tr-body">
        {error ? (
          <p className="mk-error" role="alert">
            {error}
            <button type="button" className="chip-btn" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : null}
        {!trader && loading ? <p className="tr-note">Reading the delegated wallet…</p> : null}
        {trader ? <Access trader={trader} agentId={agentId} load={load} moving={moving} /> : null}
        {trader?.delegated && trader.wallet ? <Funds module={module} trader={trader} assets={market?.assets ?? []} load={load} /> : null}
        {/* Always drawn: a buy that was in flight when the sheet closed shows its outcome even if the wallet cannot be read now. */}
        <Buy key={prefill?.key ?? 0} module={module} trader={trader} agentId={agentId} assets={market?.assets ?? []} load={load} prefill={prefill} onPlanUsed={onPlanUsed} />
      </div>
    </aside>
  );
}

/** A one-time link to the PerkOS page where the owner gives access, edits limits or revokes. */
async function openDelegation(mode: "grant" | "edit" | "revoke", agentId?: string): Promise<void> {
  const url = await delegationLink(mode, agentId);
  // The shell sends the page to the system browser, where the owner signs in with Dynamic.
  window.open(url, "_blank", "noopener");
}

/** Who has access, and the three places its limits live. */
function Access({ trader, agentId, load, moving }: { trader: DeskTrader; agentId?: string; load: () => Promise<DeskTrader | null>; moving: boolean }) {
  const [busy, setBusy] = useState<"" | "grant" | "edit" | "revoke">("");
  const [waiting, setWaiting] = useState<"" | "grant" | "edit">("");
  const [note, setNote] = useState("");
  const [revokeFailed, setRevokeFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Revoke asks once more before it runs. An order that starts meanwhile hides the question until it finishes.
  const [confirming, setConfirming] = useState(false);
  const before = useRef(trader);
  const needsApproval = worldApprovalRequired(trader, agentId);
  const cap = effectiveOrderCap(trader, agentId);

  // While the owner finishes in the browser, read the wallet every 4 s, with a
  // ceiling: an abandoned page must not leave a poll running for ever.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = window.setInterval(async () => {
      const next = await load();
      const done = next && (waiting === "grant" ? next.delegated && !worldApprovalRequired(next, agentId) : delegationChanged(before.current, next));
      if (done) {
        setWaiting("");
        setNote("");
      } else if (Date.now() - started > WAIT_MS) {
        setWaiting("");
        // Saving the same limits changes nothing here, so only a grant that never arrived is worth a word.
        if (waiting === "grant") setNote("Nothing came back from the browser yet. Finish there, then press Check.");
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load, agentId]);

  async function open(mode: "grant" | "edit") {
    setBusy(mode);
    setNote("");
    before.current = trader;
    try {
      if (trader.world?.enabled && !agentId) throw new Error("This desk's Trader is not available yet. Set up its team, then try again.");
      await openDelegation(mode, agentId);
      setWaiting(mode);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function revoke() {
    setConfirming(false);
    if (moving) return;
    setBusy("revoke");
    setNote("");
    setRevokeFailed(false);
    try {
      const res = await fetch("/api/delegation", { method: "DELETE" }).catch(() => null);
      if (!res?.ok) {
        setRevokeFailed(true);
        setNote("Could not revoke from here. You can also revoke on the delegation page.");
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The address is on screen.
    }
  }

  const footer = (
    <>
      {note ? (
        <p className="tr-note err">
          {note}{" "}
          <button type="button" className="link-btn" onClick={() => void load()}>
            Check
          </button>
          {revokeFailed ? (
            <button type="button" className="link-btn" onClick={() => void openDelegation("revoke").catch((e: Error) => setNote(e.message))}>
              Open the delegation page ↗
            </button>
          ) : null}
        </p>
      ) : null}
      <p className="tr-note">Owned by you on Dynamic. A delegated share keeps your key private; spending also requires the current Trader permission.</p>
      <WorldDelegationNote />
    </>
  );

  if (!trader.delegated || !trader.wallet) {
    return (
      <section className="tr-wallet empty" aria-label="Trader access">
        <h2>{waiting === "grant" ? "Waiting for your approval in the browser…" : "Let the Trader buy from a wallet you own"}</h2>
        <p>
          Sign in with your email on the delegation page and delegate a Dynamic wallet of yours. The Trader buys from it only when you hold to approve,
          within your limits, and you can revoke anytime.
        </p>
        {waiting === "grant" ? (
          <div className="tr-actions">
            <button type="button" className="chip-btn" disabled={busy !== ""} onClick={() => void open("grant")}>
              Open again
            </button>
            <button type="button" className="link-btn" onClick={() => setWaiting("")}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="pill small" disabled={busy !== ""} onClick={() => void open("grant")}>
            {busy === "grant" ? "Opening…" : "Give access"} <span className="arrow" aria-hidden>↗</span>
          </button>
        )}
        {footer}
      </section>
    );
  }

  const wallet = trader.wallet;
  return (
    <section className="tr-wallet" aria-label="Trader access">
      <div className="tr-wallet-row">
        <span className={`tr-dot${trader.gas.ok ? "" : " low"}`} aria-hidden />
        <div>
          <small>{needsApproval ? "Wallet connected · World approval required" : "The Trader buys from your wallet"}</small>
          <b title={wallet}>{short(wallet)}</b>
        </div>
        <button type="button" className="link-btn" onClick={() => void copy(wallet)}>
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="link-btn" href={addressUrl(wallet)} target="_blank" rel="noreferrer">
          Explorer ↗
        </a>
      </div>
      <dl className="tr-limits">
        <dt>Per order</dt>
        <dd>
          {needsApproval ? "Buying paused" : cap > 0 ? `up to ${cap} USDG` : "not set yet"}
          {!needsApproval ? <i className={`by ${trader.world?.enabled ? "you" : trader.capBy === "owner" ? "dyn" : "perkos"}`}>{trader.world?.enabled ? "World + limits" : trader.capBy === "owner" ? "Dynamic" : "PerkOS"}</i> : null}
        </dd>
        <dt>Buys</dt>
        <dd>
          tokenized stocks on Uniswap, paid in USDG<i className="by perkos">PerkOS</i>
        </dd>
        <dt>Proceeds</dt>
        <dd>
          stay in this wallet; Send home pays only you<i className="by perkos">PerkOS</i>
        </dd>
        <dt>Key export</dt>
        <dd>
          blocked<i className="by dyn">Dynamic</i>
        </dd>
        <dt>Every order</dt>
        <dd>
          a quote, then you hold to approve<i className="by you">You</i>
        </dd>
      </dl>
      <p className="tr-note">{needsApproval
        ? "Confirm access for this desk's Trader, wallet and chain with your linked World identity. Your wallet and funds remain accessible."
        : trader.world?.enabled ? `World and your saved limits allow up to ${cap} USDG per order for this Trader.` : capNote(trader)}</p>
      <div className="tr-actions">
        <button type="button" className="chip-btn" disabled={busy !== "" || waiting !== ""} onClick={() => void open(delegationMode(trader, agentId))}>
          {waiting !== "" ? "Waiting for the browser…" : busy !== "" ? "Opening…" : needsApproval ? "Confirm Trader access ↗" : "Edit limits ↗"}
        </button>
        <button
          type="button"
          className="chip-btn tr-revoke"
          disabled={busy !== "" || moving || confirming}
          title={moving ? "Wait for the order in flight to finish" : undefined}
          onClick={() => setConfirming(true)}
        >
          {busy === "revoke" ? "Revoking…" : "Revoke"}
        </button>
      </div>
      {confirming && !moving ? (
        <div className="tr-confirm" role="alertdialog" aria-label="Revoke the Trader's access">
          <p>
            Revoke the Trader&apos;s access? PerkOS stops signing for this wallet, so no order goes out until you give access again. The wallet and what it
            holds stay yours.
          </p>
          <div className="tr-actions">
            <button type="button" className="chip-btn tr-revoke" disabled={busy !== ""} onClick={() => void revoke()}>
              Revoke access
            </button>
            <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
              Keep access
            </button>
          </div>
        </div>
      ) : null}
      {moving ? <p className="tr-note">Revoke waits until the order or transfer in flight finishes.</p> : null}
      {footer}
    </section>
  );
}

/** What the delegated wallet holds on Robinhood Chain. Every token but the gas can go home to the owner. */
function Funds({ module, trader, assets, load }: { module: string; trader: DeskTrader; assets: DeskAsset[]; load: () => Promise<DeskTrader | null> }) {
  const byAddress = useMemo(() => new Map(assets.map((a) => [a.address.toLowerCase(), a])), [assets]);
  const funds = fundsOf(trader);
  // Nothing leaves the wallet while a buy is spending from it, or while a swap it sent may still land.
  const run = useBuyRun(module);
  const buying = buyOpen(run);
  // The transfer home lives above the sheet, so closing it neither forgets the answer nor frees the button early.
  const sweep = useSweepRun(module);
  const sending = sweep !== null && sweep.outcome === null ? sweep.summary.token : "";
  // A transfer that may still land keeps Send home off until the owner puts its note away: a second
  // one would replace the note that says to check the explorer first.
  const unsettled = sweep?.outcome ? sweepUnsettled(sweep.outcome) : false;
  const held = !sendHomeAllowed(run, sweep);

  function sendHome(b: TraderBalance) {
    const token = b.address;
    if (!token || held) return;
    startSweep(module, { symbol: b.symbol, token }, () => sendSweep({ module, token }));
  }

  // When the answer arrives, read the wallet; when the chain has not settled it yet, read it once more a little later.
  const answered = sweep?.outcome ? sweep.id : 0;
  useEffect(() => {
    if (!answered) return;
    void load();
    if (!unsettled) return;
    const timer = window.setTimeout(() => void load(), 6000);
    return () => window.clearTimeout(timer);
  }, [answered, unsettled, load]);

  const gasEth = funds.gasWei ? showAmount(funds.gasWei, 18, 6) : null;
  const noUsdg = !funds.usdg || BigInt(funds.usdg.amount) === 0n;
  const row = (b: TraderBalance, label: string, detail: string) => (
    <li key={b.address ?? b.symbol} className="tr-fund">
      <div>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
      <span className="tr-amt">{showAmount(b.amount, b.decimals, b.symbol.toUpperCase() === "USDG" ? 2 : 6)}</span>
      <button type="button" className="link-btn" disabled={held || BigInt(b.amount) === 0n} onClick={() => sendHome(b)}>
        {sending === b.address ? "Sending…" : "Send home"}
      </button>
    </li>
  );

  return (
    <section className="tr-sec" aria-label="Funds on Robinhood Chain">
      <header className="tr-sec-head">
        <div>
          <h2>On Robinhood Chain</h2>
          <p>What the Trader can spend and what it bought. Send home moves a token to the wallet you signed in with, and nowhere else.</p>
        </div>
      </header>
      <ul className="tr-list">
        {funds.usdg ? row(funds.usdg, "USDG", "What the Trader spends") : null}
        <li className="tr-fund">
          <div>
            <b>ETH</b>
            <small>Pays the gas, so it stays</small>
          </div>
          <span className={`tr-amt${trader.gas.ok ? "" : " low"}`}>{gasEth ?? (trader.gas.ok ? "enough" : "none")}</span>
          <span />
        </li>
        {funds.stocks.map((b) => {
          const asset = b.address ? byAddress.get(b.address.toLowerCase()) : undefined;
          const units = Number(readable(b.amount, b.decimals, 8));
          const value = asset?.priceUsd != null ? units * asset.priceUsd : null;
          return row(b, asset?.ticker ?? b.symbol, `${name(asset) || "Bought by the Trader"}${value !== null ? ` · about $${value.toFixed(2)}` : ""}`);
        })}
      </ul>
      {noUsdg || !trader.gas.ok ? (
        <p className="tr-gas low">
          {noUsdg
            ? `Fund it to trade: send USDG on Robinhood Chain to ${short(trader.wallet!)}${trader.gas.ok ? "." : ", plus a little ETH for gas."}`
            : `Send a little ETH on Robinhood Chain to ${short(trader.wallet!)} for gas.`}
        </p>
      ) : null}
      {!trader.marketAvailable ? <p className="tr-note">The desk&apos;s stock list did not answer, so stocks this wallet holds may be missing here.</p> : null}
      {buying ? <p className="tr-note">Send home waits while the order below is going through or may still land.</p> : null}
      {sweep?.outcome ? <SweepNote run={sweep} wallet={trader.wallet!} /> : null}
    </section>
  );
}

/** What happened to the last transfer home, until the owner puts it away. */
function SweepNote({ run, wallet }: { run: SweepRun; wallet: string }) {
  const outcome = run.outcome;
  if (!outcome) return null;
  // Putting away a transfer that may still land frees Send home again, so the button says what it assumes.
  const ok = (
    <button type="button" className="link-btn" onClick={() => dismissSweep(run.module)}>
      {sweepUnsettled(outcome) ? "I checked the explorer" : "OK"}
    </button>
  );
  if (outcome.kind === "receipt") {
    const r = outcome.receipt;
    return (
      <p className={r.status === "reverted" ? "hint err" : "tr-note"} aria-live="polite">
        {sweepView(r, run.summary.symbol)}{" "}
        <a className="link-btn" href={txUrl(r.hash, r.explorerUrl)} target="_blank" rel="noreferrer">
          {short(r.hash)} ↗
        </a>
        {ok}
      </p>
    );
  }
  if (outcome.kind === "refused") {
    return (
      <p className="hint err" role="alert">
        Nothing was sent. {outcome.message}
        {outcome.detail ? ` ${outcome.detail}` : ""} {ok}
      </p>
    );
  }
  return (
    <p className="hint err" role="alert">
      {outcome.message}{" "}
      <a className="link-btn" href={addressUrl(wallet)} target="_blank" rel="noreferrer">
        See the wallet on the explorer ↗
      </a>
      {ok}
    </p>
  );
}

/** The buy the desk is sending, or the last outcome the owner has not dismissed. Survives the sheet closing. */
function useBuyRun(module: string): BuyRun | null {
  const read = useCallback(() => buyRun(module), [module]);
  return useSyncExternalStore(subscribeBuys, read, () => null);
}

/** The transfer home the desk is sending, or its last outcome. Survives the sheet closing the same way. */
function useSweepRun(module: string): SweepRun | null {
  const read = useCallback(() => sweepRun(module), [module]);
  return useSyncExternalStore(subscribeSweeps, read, () => null);
}

/** One order: stock, amount, slippage, quote, hold, receipt. */
function Buy({
  module,
  trader,
  agentId,
  assets,
  load,
  prefill = null,
  onPlanUsed
}: {
  module: string;
  trader: DeskTrader | null;
  agentId?: string;
  assets: DeskAsset[];
  load: () => Promise<DeskTrader | null>;
  prefill?: TraderPrefill | null;
  onPlanUsed?: (() => void) | undefined;
}) {
  const tradeable = useMemo(() => assets.filter((a) => a.tradeable !== false).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);
  const run = useBuyRun(module);
  const sweep = useSweepRun(module);
  const [ticker, setTicker] = useState(prefill?.ticker ?? "");
  const [amountText, setAmountText] = useState(prefill ? planAmount(prefill.amount, null).amount : "1");
  const [slippage, setSlippage] = useState<number>(SLIPPAGE_BPS);
  // The quote keeps the stock and amount it was asked for: those, not the form, are what a hold approves.
  const [quote, setQuote] = useState<{ quote: DeskQuote; receivedAt: number; asset: DeskAsset; amount: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(0);

  // The plan's amount, once the wallet is read: never above one order's limit or what the wallet holds.
  const cap = trader ? effectiveOrderCap(trader, agentId) : 0;
  const fromPlan = prefill ? planAmount(prefill.amount, trader ? { ...trader, cap } : null) : null;
  const planned = fromPlan?.amount ?? null;
  // An amount the owner typed is theirs: the plan no longer sets it.
  const typed = useRef(false);
  useEffect(() => {
    if (planned !== null && !typed.current) setAmountText(planned);
  }, [planned]);

  const asset = tradeable.find((a) => a.ticker === ticker);
  const amount = AMOUNT.test(amountText.trim()) ? Number(amountText) : NaN;
  // A transfer home in flight, or one of USDG that may still land, keeps the buy waiting.
  const reason = buyReason(trader, amount, asset !== undefined, sweep, agentId);

  // The outcome of a buy moves money: read the wallet again as soon as it lands.
  const settled = run?.outcome ? run.id : 0;
  useEffect(() => {
    if (settled) void load();
  }, [settled, load]);

  // The countdown runs on this machine's monotonic clock, from when the quote arrived.
  useEffect(() => {
    if (!quote) return;
    setClock(performance.now());
    const timer = window.setInterval(() => setClock(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);
  const secondsLeft = quote ? quoteSecondsLeft(quote.receivedAt, Math.max(clock, quote.receivedAt)) : 0;
  // Held against the market's latest reference price, which refreshes while the quote is on screen.
  const check = quote ? priceCheck(quote.quote, tradeable.find((a) => a.address === quote.asset.address) ?? quote.asset) : null;

  async function ask() {
    if (reason || !asset) return;
    setAsking(true);
    setError("");
    setQuote(null);
    try {
      const params = new URLSearchParams({ module, ticker: asset.ticker, amountUsdg: String(amount) });
      const res = await fetch(`/api/desks/quote?${params}`);
      const body = (await res.json().catch(() => ({}))) as { quote?: DeskQuote; message?: string };
      if (!res.ok || !body.quote) throw new Error(body.message ?? `The desk could not quote this order (${res.status})`);
      // Approve only what was asked: this stock as the market counts it, for this much of the wallet's USDG, on Robinhood Chain.
      const mismatch = quoteMismatch(body.quote, { asset, amount, usdgAddress: trader ? (fundsOf(trader).usdg?.address ?? null) : null });
      if (mismatch) throw new Error(`${mismatch} Get a new quote.`);
      setQuote({ quote: body.quote, receivedAt: performance.now(), asset, amount });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  function approve() {
    if (!trader || !quote || reason || check?.blocked || !slippageOk(slippage) || quoteSecondsLeft(quote.receivedAt, performance.now()) <= 0) return;
    if (buyReason(trader, quote.amount, true, sweep, agentId)) return;
    const { quote: q, asset: stock } = quote;
    const usdg = String(quote.amount);
    // The quote the owner saw always goes with the order: PerkOS refuses the swap below it less this slippage.
    const order = { module, ticker: stock.ticker, amountUsdg: usdg, maxSlippageBps: slippage, quotedAmountOut: q.amountOut, ...(prefill ? { turnId: prefill.turnId } : {}) };
    const started = startBuy(
      module,
      {
        ticker: stock.ticker,
        amountUsdg: usdg,
        tokenOut: { symbol: stock.ticker, address: stock.address, decimals: q.tokenOut.decimals },
        quotedAmountOut: q.amountOut,
        minAmountOut: minAfterSlippage(q.amountOut, slippage),
        maxSlippageBps: slippage,
        heldBefore: heldOf(trader, stock.address)
      },
      async () => {
        const current = await load();
        const blocked = recheckBuy({ before: trader, current, amount: quote.amount, agentId, receivedAt: quote.receivedAt, now: performance.now(), sweep: sweepRun(module) });
        if (blocked) return { kind: "refused", code: "TRADER_PERMISSION_CHANGED", message: blocked, detail: "Nothing was submitted. Review the Trader's current access and limits." };
        return sendBuyForTurn(order);
      }
    );
    if (started) setQuote(null);
    // One buy from the plan: the next one from this form follows no turn.
    if (started && prefill) onPlanUsed?.();
  }

  const reset = () => {
    setQuote(null);
    setError("");
  };
  const live = quote && secondsLeft > 0 ? quote.quote : null;
  const pct = `${slippage / 100}%`;

  return (
    <section className="tr-sec" aria-label="Buy">
      <header className="tr-sec-head">
        <div>
          <h2>Buy</h2>
          <p>Paid in USDG from the delegated wallet. What you buy stays there until you send it home.</p>
        </div>
      </header>
      {run ? (
        <Outcome run={run} trader={trader} load={load} />
      ) : (
        <div className="tr-form">
          {prefill && fromPlan ? (
            <PlanNote prefill={prefill} capped={fromPlan.capped} amount={fromPlan.amount} missing={tradeable.length > 0 && !tradeable.some((a) => a.ticker === prefill.ticker)} />
          ) : null}
          <label className="tr-field">
            <span>Stock</span>
            <select
              value={ticker}
              disabled={asking}
              onChange={(e) => {
                setTicker(e.target.value);
                reset();
              }}
            >
              <option value="">Choose a stock</option>
              {tradeable.map((a) => (
                <option key={a.address} value={a.ticker}>
                  {a.ticker} · {name(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="tr-field">
            <span>Spend · USDG{cap > 0 ? ` · up to ${cap}` : ""}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              max={cap > 0 ? cap : undefined}
              step={0.01}
              value={amountText}
              disabled={asking}
              onChange={(e) => {
                typed.current = true;
                setAmountText(e.target.value);
                reset();
              }}
            />
          </label>
          <label className="tr-field">
            <span>Max slippage</span>
            <select value={slippage} disabled={asking} onChange={(e) => setSlippage(Number(e.target.value))}>
              {SLIPPAGE_CHOICES.map((bps) => (
                <option key={bps} value={bps}>
                  {bps / 100}%{bps === SLIPPAGE_BPS ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          {reason ? <p className="tr-why wide">{reason}</p> : null}

          {live && check ? (
            <div className="tr-quote wide">
              <dl>
                <dt>You pay</dt>
                <dd>
                  {readable(live.amountIn, live.tokenIn.decimals, 6)} {live.tokenIn.symbol}
                </dd>
                <dt>You receive</dt>
                <dd>
                  {aboutAmount(live.amountOut, live.tokenOut.decimals, 6)} {quote?.asset.ticker}
                </dd>
                <dt>Least you accept</dt>
                <dd>
                  {boundAmount(minAfterSlippage(live.amountOut, slippage), live.tokenOut.decimals, 6)} {quote?.asset.ticker} ({pct} slippage)
                </dd>
                <dt>Price</dt>
                <dd>
                  {Number.isFinite(check.implied) ? `${usd(check.implied)} a share` : "no shares for this USDG"}
                  {check.reference === null
                    ? " · the market has no price to compare"
                    : check.gapPct !== null
                      ? ` · market ${usd(check.reference)} (${check.gapPct >= 0 ? "+" : ""}${check.gapPct.toFixed(1)}%)`
                      : ""}
                </dd>
                <dt>Price impact</dt>
                <dd>{live.priceImpactPct !== null ? `${live.priceImpactPct.toFixed(2)}%` : "not given"}</dd>
                <dt>Route</dt>
                <dd>{live.routing ?? "Uniswap"}</dd>
                <dt>Protocols</dt>
                <dd>{live.protocols.length ? live.protocols.join(" · ") : "not given"}</dd>
                <dt>Request</dt>
                <dd className="tr-id">{live.requestId ?? "none"}</dd>
              </dl>
              {check.blocked ? <p className="tr-why">{check.blocked}</p> : null}
              <small>
                Valid for {secondsLeft}s. PerkOS prices it again just before sending. It refuses the order only if the new price gives you less than
                the least you accept above, and then nothing is bought.
              </small>
              <HoldToApprove disabled={Boolean(reason) || secondsLeft <= 0 || Boolean(check.blocked)} onApprove={approve} />
              <button type="button" className="link-btn" onClick={reset}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="pill small wide" disabled={Boolean(reason) || asking} onClick={() => void ask()}>
              {asking ? "Asking the desk…" : quote ? "Quote expired: get a new one" : "Get a quote"}
            </button>
          )}
          {error ? <p className="hint err wide">{error}</p> : null}
        </div>
      )}
    </section>
  );
}

/** Where the form's stock and amount came from: the desk's plan, and the turn its receipt goes to. */
function PlanNote({ prefill, capped, amount, missing }: { prefill: TraderPrefill; capped: PlanCap; amount: string; missing: boolean }) {
  const when = prefill.startedAt !== null ? clockOf(new Date(prefill.startedAt).toISOString()) : "";
  const held = capped === "cap" ? ` One order can spend up to ${amount} USDG, so it starts there.` : capped === "held" ? ` The wallet holds ${amount} USDG, so it starts there.` : "";
  const gone = missing ? ` ${prefill.ticker} cannot be bought on the desk right now.` : "";
  return (
    <div className="tr-plan wide" role="note">
      <span className="tr-plan-kicker">From the desk&apos;s plan{when ? ` · ${when}` : ""}</span>
      <p>
        <b>{prefill.ticker}</b> for <b>{prefill.amount} USDG</b>, as the Trader planned it.{held}
        {gone} Nothing is bought until you get a quote and hold to approve, and the receipt stays with the turn.
      </p>
    </div>
  );
}

const STEP_CLASS = { success: "done", pending: "active", reverted: "failed" } as const;

/**
 * What happened to the order the owner approved. Never offers a second hold
 * for an order that may be on chain: an answer that is not a verdict stays on
 * screen, the wallet is read again a few times, and it can be put away once
 * the stock shows up or a minute has passed.
 */
function Outcome({ run, trader, load }: { run: BuyRun; trader: DeskTrader | null; load: () => Promise<DeskTrader | null> }) {
  const { summary, outcome } = run;
  const stock = (units: string) => `${showAmount(units, summary.tokenOut.decimals, 6)} ${summary.ticker}`;
  // "about 0.0042 NVDA", or "less than 0.000001 NVDA" for an amount too small to show.
  const aboutStock = (units: string) => `${aboutAmount(units, summary.tokenOut.decimals, 6)} ${summary.ticker}`;
  const least = `${boundAmount(summary.minAmountOut, summary.tokenOut.decimals, 6)} ${summary.ticker}`;
  const open = outcome !== null && unresolved(outcome);
  const more = open ? arrived(summary.heldBefore, heldOf(trader, summary.tokenOut.address)) : null;
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!open) return;
    const timers = RECHECK_MS.map((ms) => window.setTimeout(() => void load(), ms));
    const tick = window.setInterval(() => setNow(performance.now()), 1000);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(tick);
    };
  }, [open, run.id, load]);

  const done =
    outcomeDismissible(run, now, more !== null) ? (
      <button type="button" className="link-btn" onClick={() => dismissBuy(run.module)}>
        {outcome?.kind === "refused" ? "Back" : open && !more ? "I checked the explorer" : "Done"}
      </button>
    ) : (
      <small>Reading the wallet again shortly. This stays here for a minute, or until the stock shows up, so a second order does not go out by mistake.</small>
    );
  const approved = (
    <p>
      You approved {aboutStock(summary.quotedAmountOut)} for {summary.amountUsdg} USDG, at least {least}.
    </p>
  );
  const landed = more ? <p>The wallet now holds {stock(more)} more than when you approved.</p> : null;
  const walletLink = trader?.wallet ? (
    <a className="link-btn" href={addressUrl(trader.wallet)} target="_blank" rel="noreferrer">
      See the wallet on the explorer ↗
    </a>
  ) : null;

  if (!outcome) {
    return (
      <section className="tr-order sending" aria-live="polite">
        <b>Sending from your delegated wallet…</b>
        <p>
          You approved {aboutStock(summary.quotedAmountOut)} for {summary.amountUsdg} USDG; PerkOS refuses it below {least} ({summary.maxSlippageBps / 100}%
          slippage). It checks the order against your limits and signs it through Dynamic, which can take up to three minutes. You can close this sheet: the
          outcome waits here.
        </p>
        <i className="tr-wait" aria-hidden>
          <i />
        </i>
      </section>
    );
  }

  if (outcome.kind === "receipt") {
    const r = outcome.receipt;
    const view = receiptView(r);
    // A purchase names what arrived; without that number it says the quote was "about", never that it was bought.
    const title = r.bought === true ? (r.amountOut ? `Bought ${stock(r.amountOut)}` : `Bought ${summary.ticker}`) : view.title;
    const body =
      r.bought === true
        ? r.amountOut
          ? `For ${summary.amountUsdg} USDG. ${view.body}`
          : `For ${summary.amountUsdg} USDG. The quote was ${aboutStock(summary.quotedAmountOut)}; the wallet's balance above shows what arrived. ${view.body}`
        : view.body;
    return (
      <section className={`tr-order receipt ${view.tone}`} aria-live="polite">
        <b>{title}</b>
        <p>{body}</p>
        {r.bought === null ? approved : null}
        {landed}
        {/* The swap's own link, unless the steps below already list it. */}
        {r.hash && !r.steps.some((s) => s.hash === r.hash) ? (
          <a className="link-btn" href={txUrl(r.hash, r.explorerUrl)} target="_blank" rel="noreferrer">
            Swap {short(r.hash)} on the explorer ↗
          </a>
        ) : null}
        {r.steps.length ? (
          <ol className="tr-steps">
            {r.steps.map((s, i) => {
              const url = s.hash ? txUrl(s.hash, s.explorerUrl) : s.explorerUrl;
              return (
                <li key={`${s.kind}-${i}`} className={STEP_CLASS[s.status]}>
                  {STEP_LABEL[s.kind] ?? s.kind} · {STEP_STATE[s.status]}
                  {url ? (
                    <>
                      {" · "}
                      <a href={url} target="_blank" rel="noreferrer">
                        {s.hash ? short(s.hash) : "explorer"} ↗
                      </a>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {r.bought === true ? null : walletLink}
        {done}
      </section>
    );
  }

  if (outcome.kind === "refused") {
    return (
      <section className="tr-order receipt refused" role="alert">
        <b>Nothing was sent</b>
        <p>{outcome.message}</p>
        {outcome.detail ? <small>{outcome.detail}</small> : null}
        {done}
      </section>
    );
  }

  return (
    <section className="tr-order receipt unconfirmed" role="alert">
      <b>Not confirmed</b>
      <p>{outcome.message}</p>
      {approved}
      {landed}
      {walletLink}
      {done}
    </section>
  );
}

/**
 * Nothing is sent until the owner holds the button for the whole count, with
 * one pointer or key, in a window that keeps the focus. The rules live in
 * createHold; this only feeds it events.
 */
export function HoldToApprove({ onApprove, disabled, label = "Hold to approve" }: { onApprove: () => void; disabled: boolean; label?: string }) {
  const [holding, setHolding] = useState(false);
  const approve = useRef(onApprove);
  const blocked = useRef(disabled);
  useEffect(() => {
    approve.current = onApprove;
    blocked.current = disabled;
  });
  const [hold] = useState(() =>
    createHold({
      ms: HOLD_MS,
      onChange: setHolding,
      onFire: () => approve.current(),
      // Checked again at the end: the quote may have expired, the window may have lost focus.
      canFire: () => !blocked.current && document.visibilityState === "visible" && document.hasFocus()
    })
  );

  useEffect(() => {
    const cancel = () => hold.cancel();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
      hold.cancel();
    };
  }, [hold]);

  useEffect(() => {
    if (disabled) hold.cancel();
  }, [disabled, hold]);

  return (
    <button
      type="button"
      className={`hold-btn${holding ? " holding" : ""}`}
      style={{ "--hold": `${HOLD_MS}ms` } as CSSProperties}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        hold.press(`pointer:${e.pointerId}`);
      }}
      onPointerUp={(e) => hold.release(`pointer:${e.pointerId}`)}
      onPointerLeave={(e) => hold.release(`pointer:${e.pointerId}`)}
      onPointerCancel={() => hold.cancel()}
      onLostPointerCapture={() => hold.cancel()}
      onContextMenu={(e) => e.preventDefault()}
      onBlur={() => hold.cancel()}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (!e.repeat && !disabled) hold.press(`key:${e.key}`);
      }}
      onKeyUp={(e) => hold.release(`key:${e.key}`)}
    >
      <i className="hold-fill" aria-hidden />
      <span>{holding ? "Keep holding…" : label}</span>
    </button>
  );
}

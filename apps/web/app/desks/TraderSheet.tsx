"use client";

import type { DeskRail, DeskRails, OrderReceipt, PreparedOrder } from "@perkos/client";
import type { DeskAsset } from "@perkos/desk-contract";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useWallet } from "../wallet/context";
import type { Chain } from "./chains";
import { newRail, RAIL_STATE_LABEL, railsCalls, railsProblem, railState, readable, toUnits, type RailsDraft } from "./rails";
import { useMarket } from "./useMarket";
import { useRails } from "./useRails";

const HOLD_MS = 1600;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Trader on a vault desk. The person's own wallet sets the rails: one
 * strategy per stock, with a limit per trade, a budget and an end date, held
 * by the desk's vault. The Trader buys inside them from the wallet they
 * delegated, and only after they hold to approve. What it buys goes to them.
 */
export function TraderSheet({ title, module, chain, onClose }: { title: string; module: string; chain: Chain; onClose: () => void }) {
  const { rails, error, loading, load } = useRails(module);
  const { market } = useMarket(module);
  const assets = useMemo(() => new Map((market?.assets ?? []).map((a) => [a.address.toLowerCase(), a])), [market]);
  const [buying, setBuying] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = Date.now();
  // Only the strategies that name the Trader's wallet: older ones belong to the app that made them.
  const hidden = (rails?.rails ?? []).filter((r) => !r.forTrader).length;
  const list = (rails?.rails ?? []).filter((r) => r.forTrader).sort((a, b) => Number(railState(b, now) === "active") - Number(railState(a, now) === "active") || Number(b.strategyId) - Number(a.strategyId));

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
          <p className="hint err" role="alert">
            {error}
          </p>
        ) : null}
        {!rails && loading ? <p className="tr-note">Reading your rails on the chain…</p> : null}
        {rails ? <TraderWallet rails={rails} /> : null}

        {rails ? (
          <section className="tr-rails" aria-label="Your rails">
            <header className="tr-sec-head">
              <div>
                <h2>Your rails</h2>
                <p>Each one lets the Trader buy one stock: never more per trade, never past the budget, never after the date. You sign them; the vault holds the money.</p>
              </div>
              {rails.trader ? (
                <button type="button" className="chip-btn" aria-expanded={drafting} onClick={() => setDrafting((v) => !v)}>
                  {drafting ? "Close" : "New rails"}
                </button>
              ) : null}
            </header>
            {drafting && rails.trader ? (
              <RailsForm
                rails={rails}
                assets={market?.assets ?? []}
                reload={load}
                onDone={() => {
                  setDrafting(false);
                  void load();
                }}
              />
            ) : null}
            {list.length ? (
              <ul className="tr-list">
                {list.map((r, i) => {
                  const state = railState(r, now);
                  const asset = assets.get(r.outputToken.toLowerCase());
                  return (
                    <li key={r.strategyId} className={`tr-rail ${state}`} style={{ "--i": Math.min(i, 12) } as CSSProperties}>
                      <div className="tr-rail-head">
                        <b>{asset?.ticker ?? short(r.outputToken)}</b>
                        {asset ? <small>{asset.name.split(" • ")[0]}</small> : null}
                        <span className={`tr-state ${state}`}>{RAIL_STATE_LABEL[state]}</span>
                      </div>
                      <p className="tr-rail-meta">
                        Up to {r.maxAmountPerTrade} {rails.input.symbol} a trade · {r.spent} of {r.maxTotalSpend} spent · {r.available} left · until {day(r.expiresAt)}
                      </p>
                      {state === "active" && buying !== r.strategyId ? (
                        <button type="button" className="pill small tr-buy" onClick={() => setBuying(r.strategyId)}>
                          Buy {asset?.ticker ?? ""}
                        </button>
                      ) : null}
                      {buying === r.strategyId ? (
                        <OrderFlow
                          module={module}
                          desk={title}
                          rail={r}
                          rails={rails}
                          asset={asset}
                          onClose={() => setBuying(null)}
                          onSent={() => void load()}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="tr-note">{rails.trader ? "No rails yet. Set the first one: a stock, a limit per trade and a budget." : "Rails come after the Trader has a wallet of yours."}</p>
            )}
            {hidden ? (
              <p className="tr-note">
                {hidden} older {hidden === 1 ? "strategy names" : "strategies name"} another agent, so {hidden === 1 ? "it stays" : "they stay"} out of the Trader&apos;s reach.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

/** The wallet the person delegated to the Trader, and the gas it has to send orders. */
function TraderWallet({ rails }: { rails: DeskRails }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function openAccess() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/delegation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "grant" }) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !body.url) throw new Error(body.message ?? "PerkOS did not return a link.");
      window.open(body.url, "_blank", "noopener");
      setNote("Finish in your browser, then come back here.");
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rails.trader) {
    return (
      <section className="tr-wallet empty" aria-label="The Trader's wallet">
        <h2>Give the Trader a wallet you own</h2>
        <p>You sign in with your email and delegate a wallet of yours. The Trader signs only orders you approve, inside the rails you set, and you can take it back anytime.</p>
        <button type="button" className="pill small" disabled={busy} onClick={() => void openAccess()}>
          {busy ? "Opening…" : "Give access"} <span className="arrow" aria-hidden>&nearr;</span>
        </button>
        {note ? <p className="tr-note">{note}</p> : null}
      </section>
    );
  }
  const gas = Number(rails.trader.gas);
  return (
    <section className="tr-wallet" aria-label="The Trader's wallet">
      <div className="tr-wallet-row">
        <span className={`tr-dot${gas > 0 ? "" : " low"}`} aria-hidden />
        <div>
          <small>The Trader signs from your wallet</small>
          <b title={rails.trader.address}>{short(rails.trader.address)}</b>
        </div>
        <button type="button" className="link-btn" onClick={() => void navigator.clipboard?.writeText(rails.trader!.address)}>
          Copy
        </button>
      </div>
      <p className={`tr-gas${gas > 0 ? "" : " low"}`}>
        {gas > 0
          ? `${readable(String(Math.round(gas * 1e18)), 18, 6)} ${rails.trader.gasSymbol} for gas on Robinhood Chain`
          : `No ${rails.trader.gasSymbol} for gas yet. Send a little ${rails.trader.gasSymbol} on Robinhood Chain to this address so the Trader can send your orders.`}
      </p>
    </section>
  );
}

type Step = "todo" | "active" | "done" | "failed";

/** New rails, signed by the person's own wallet: the strategy, the allowance, the funding. */
function RailsForm({ rails, assets, reload, onDone }: { rails: DeskRails; assets: DeskAsset[]; reload: () => Promise<DeskRails | null>; onDone: () => void }) {
  const wallet = useWallet();
  const tradeable = useMemo(() => assets.filter((a) => a.tradeable !== false).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);
  const [draft, setDraft] = useState<RailsDraft>({ outputToken: "", perTrade: 5, budget: 20, days: 7, slippagePct: 1 });
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState("");
  const problem = railsProblem(draft);
  const set = (k: keyof RailsDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: k === "outputToken" ? e.target.value : Number(e.target.value) }));

  async function sign() {
    if (problem || !wallet.connected) return;
    setError("");
    const mark = (i: number, s: Step) => setSteps((all) => (all ?? ["todo", "todo", "todo"]).map((v, j) => (j === i ? s : v)));
    setSteps(["active", "todo", "todo"]);
    let at = 0;
    try {
      const calls = railsCalls(rails, draft, wallet.address, Date.now());
      const before = rails.rails;
      const created = await wallet.sendTransaction({ chainId: rails.chainId, ...calls.create });
      if (created.status !== "success") throw new Error("The strategy was not created");
      // The vault numbers it; read it back rather than guess.
      let rail: DeskRail | null = null;
      for (let i = 0; i < 10 && !rail; i++) {
        const fresh = await reload();
        rail = fresh ? newRail(before, fresh.rails, draft.outputToken) : null;
        if (!rail) await sleep(2500);
      }
      if (!rail) throw new Error("The strategy was created but does not show yet. Open the Trader again in a moment.");
      mark(0, "done");
      at = 1;
      mark(1, "active");
      const approved = await wallet.sendTransaction({ chainId: rails.chainId, ...calls.approve });
      if (approved.status !== "success") throw new Error("The allowance did not go through");
      mark(1, "done");
      at = 2;
      mark(2, "active");
      const funded = await wallet.sendTransaction({ chainId: rails.chainId, ...calls.fund(rail.strategyId) });
      if (funded.status !== "success") throw new Error("The funding did not go through");
      mark(2, "done");
      onDone();
    } catch (err) {
      mark(at, "failed");
      setError((err as Error).message);
    }
  }

  const running = steps?.includes("active") ?? false;
  const labels = ["Create the strategy", `Let the vault take ${draft.budget} ${rails.input.symbol}`, "Fund the strategy"];
  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        void sign();
      }}
    >
      <label className="tr-field wide">
        <span>Stock</span>
        <select value={draft.outputToken} onChange={set("outputToken")} disabled={running}>
          <option value="">Choose a stock</option>
          {tradeable.map((a) => (
            <option key={a.address} value={a.address}>
              {a.ticker} · {a.name.split(" • ")[0]}
            </option>
          ))}
        </select>
      </label>
      <label className="tr-field">
        <span>Per trade · {rails.input.symbol}</span>
        <input type="number" min={0.1} step={0.1} value={draft.perTrade} onChange={set("perTrade")} disabled={running} />
      </label>
      <label className="tr-field">
        <span>Budget · {rails.input.symbol}</span>
        <input type="number" min={0.1} step={0.1} value={draft.budget} onChange={set("budget")} disabled={running} />
      </label>
      <label className="tr-field">
        <span>Days</span>
        <input type="number" min={1} max={90} step={1} value={draft.days} onChange={set("days")} disabled={running} />
      </label>
      <label className="tr-field">
        <span>Slippage · %</span>
        <input type="number" min={0.1} max={20} step={0.1} value={draft.slippagePct} onChange={set("slippagePct")} disabled={running} />
      </label>
      <p className="tr-note wide">Your wallet signs three times on Robinhood Chain and pays a little ETH for gas. The budget moves from your wallet into the vault, and only an order you approve can spend it.</p>
      {steps ? (
        <ol className="tr-steps wide">
          {labels.map((l, i) => (
            <li key={l} className={steps[i]}>
              {l}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <p className="hint err wide">{error}</p> : null}
      <button type="submit" className="pill small wide" disabled={Boolean(problem) || running || !wallet.connected}>
        {running ? "Approve in your wallet…" : problem ?? "Sign the rails"}
      </button>
    </form>
  );
}

/** One order inside a strategy: amount, quote, hold to approve, receipt. */
function OrderFlow({
  module,
  desk,
  rail,
  rails,
  asset,
  onClose,
  onSent
}: {
  module: string;
  desk: string;
  rail: DeskRail;
  rails: DeskRails;
  asset: DeskAsset | undefined;
  onClose: () => void;
  onSent: () => void;
}) {
  const max = Math.min(Number(rail.maxAmountPerTrade), Number(rail.available));
  const [amount, setAmount] = useState(Math.min(1, max));
  const [order, setOrder] = useState<PreparedOrder | null>(null);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [busy, setBusy] = useState<"" | "quote" | "send">("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const ticker = asset?.ticker ?? "the stock";
  const decimals = asset?.decimals ?? 18;

  useEffect(() => {
    if (!order || receipt) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [order, receipt]);

  const secondsLeft = order ? Number(order.execution.deadline) - Math.floor(clock / 1000) - 15 : 0;

  async function quote() {
    setBusy("quote");
    setError("");
    setOrder(null);
    try {
      const res = await fetch("/api/desks/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          module,
          step: "prepare",
          strategyId: rail.strategyId,
          amountIn: toUnits(amount, rails.input.decimals),
          signal: `Buy ${amount} ${rails.input.symbol} of ${ticker} on ${desk}, approved by the owner's hold.`
        })
      });
      const body = (await res.json().catch(() => ({}))) as { order?: PreparedOrder; message?: string };
      if (!res.ok || !body.order) throw new Error(body.message ?? `The desk could not prepare this order (${res.status})`);
      setOrder(body.order);
      setClock(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!order) return;
    setBusy("send");
    setError("");
    try {
      const res = await fetch("/api/desks/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module, step: "execute", order, reason: `Buy ${amount} ${rails.input.symbol} of ${ticker}` })
      });
      const body = (await res.json().catch(() => ({}))) as { receipt?: OrderReceipt; message?: string };
      if (!res.ok || !body.receipt) throw new Error(body.message ?? `The order was not sent (${res.status})`);
      setReceipt(body.receipt);
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setOrder(null);
    } finally {
      setBusy("");
    }
  }

  if (receipt) {
    const got = receipt.amountOut ? readable(receipt.amountOut, decimals) : null;
    return (
      <div className={`tr-order receipt ${receipt.status}`}>
        <b>{receipt.status === "success" ? `Bought ${got ?? ""} ${ticker}` : receipt.status === "pending" ? "Sent, waiting for the chain" : "The chain refused this order"}</b>
        <p>
          {amount} {rails.input.symbol} from the vault, signed by your Trader wallet. {receipt.status === "success" ? "It is in your wallet now." : ""}
        </p>
        {receipt.explorerUrl ? (
          <a className="link-btn" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            See it on the explorer &nearr;
          </a>
        ) : null}
        <button type="button" className="link-btn" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="tr-order">
      <label className="tr-field">
        <span>Spend · {rails.input.symbol}</span>
        <input
          type="number"
          min={0.01}
          max={max}
          step={0.01}
          value={amount}
          disabled={busy !== ""}
          onChange={(e) => {
            setAmount(Math.min(max, Number(e.target.value)));
            setOrder(null);
          }}
        />
      </label>
      {order && secondsLeft > 0 ? (
        <div className="tr-quote">
          <p>
            You pay <b>{amount} {rails.input.symbol}</b> and receive at least <b>{readable(order.execution.minAmountOut, decimals)} {ticker}</b>
          </p>
          <small>
            Quoted {readable(order.execution.quotedAmountOut, decimals)} {ticker} · Uniswap · valid {secondsLeft}s
          </small>
          <HoldToApprove disabled={busy !== ""} busy={busy === "send"} onApprove={() => void send()} />
        </div>
      ) : (
        <button type="button" className="pill small" disabled={busy !== "" || !(amount > 0)} onClick={() => void quote()}>
          {busy === "quote" ? "Asking the desk…" : order ? "Quote expired: ask again" : "Get a quote"}
        </button>
      )}
      {error ? <p className="hint err">{error}</p> : null}
      <button type="button" className="link-btn" onClick={onClose} disabled={busy === "send"}>
        Cancel
      </button>
    </div>
  );
}

/** Nothing is sent until the person holds the button down for the whole count. */
function HoldToApprove({ onApprove, disabled, busy }: { onApprove: () => void; disabled: boolean; busy: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = () => {
    if (disabled) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onApprove();
    }, HOLD_MS);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <button
      type="button"
      className={`hold-btn${holding ? " holding" : ""}`}
      style={{ "--hold": `${HOLD_MS}ms` } as CSSProperties}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
    >
      <i className="hold-fill" aria-hidden />
      <span>{busy ? "Sending from your Trader wallet…" : holding ? "Keep holding…" : "Hold to approve"}</span>
    </button>
  );
}

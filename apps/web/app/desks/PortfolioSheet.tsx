"use client";

import type { DeskPortfolio, PortfolioPosition, PortfolioSwap } from "@perkos/client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { buyRun, subscribeBuys } from "./buyStore";
import type { Chain } from "./chains";
import { clockOf, dayOf } from "./history";
import { Logo } from "./MarketPanel";
import {
  ARROW,
  launchesOf,
  money,
  notesOf,
  perShare,
  shareOf,
  shortName,
  signedMoney,
  signedPct,
  SWAP_STATE,
  swapReachedChain,
  toneOf,
  usdgText,
  wholeText,
  type Launch
} from "./portfolio";
import { subscribeSweeps, sweepRun } from "./sweepStore";
import { short, showAmount, txUrl } from "./trade";
import { usePortfolio } from "./usePortfolio";

/**
 * The desk's Portfolio, opened from the right over the desk like Market,
 * Trader and History: what the Trader's delegated wallet holds, at the desk's
 * price, against what it paid; the USDG and gas beside it; the last swaps with
 * their links on the explorer; and the tokens the owner launched, once Runtime
 * knows of any. Escape closes it.
 */
export function PortfolioSheet({
  title,
  module,
  chain,
  onTrader,
  onClose
}: {
  title: string;
  module: string;
  chain: Chain;
  /** Opens the Trader, where the owner gives access and buys. Left out on a desk without one. */
  onTrader?: () => void;
  onClose: () => void;
}) {
  const { portfolio, status, error, loading, load } = usePortfolio(module);
  useReadAfterOrders(module, load);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className={`mk-sheet pf-sheet ${chain}`} aria-label={`${title} portfolio`}>
      <div className="mk-sheet-bar">
        <span className="kicker">Portfolio</span>
        <button type="button" className="bubble-close" aria-label="Close the portfolio" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="pf-body">
        {error && status !== "signed_out" ? (
          <p className="mk-error" role="alert">
            <span>{portfolio ? `${error} What shows below is the last read.` : error}</span>
            <button type="button" className="chip-btn" disabled={loading} onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : null}
        {status === "signed_out" ? <p className="tr-note">Sign in to PerkOS to see this desk&apos;s portfolio.</p> : null}
        {status === "loading" ? <Skeleton /> : null}
        {portfolio && !portfolio.delegated ? <NoAccess onTrader={onTrader} /> : null}
        {portfolio?.delegated ? <Holdings portfolio={portfolio} refreshing={loading} onRefresh={() => void load()} onTrader={onTrader} /> : null}
        <Launches />
      </div>
    </aside>
  );
}

/**
 * Reads the portfolio again when a buy or a transfer home on this desk
 * answers, one sent before the sheet opened included: what the wallet holds
 * has just changed.
 */
function useReadAfterOrders(module: string, load: () => Promise<unknown>) {
  const readBuy = useCallback(() => buyRun(module), [module]);
  const readSweep = useCallback(() => sweepRun(module), [module]);
  const buy = useSyncExternalStore(subscribeBuys, readBuy, () => null);
  const sweep = useSyncExternalStore(subscribeSweeps, readSweep, () => null);
  const answered = `${buy?.outcome ? buy.id : 0}:${sweep?.outcome ? sweep.id : 0}`;
  const seen = useRef(answered);
  useEffect(() => {
    if (answered === seen.current) return;
    seen.current = answered;
    void load();
  }, [answered, load]);
}

/** Before the owner gives the Trader a wallet there is nothing to hold, and the sheet says where to start. */
function NoAccess({ onTrader }: { onTrader?: () => void }) {
  return (
    <section className="pf-empty" aria-label="No portfolio yet">
      <span className="pf-empty-mark" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <b>No portfolio yet</b>
      <p>
        Your portfolio is what the Trader buys for you from a wallet you delegate: each stock at the desk&apos;s price, against what it paid. Give the
        Trader access to a wallet of yours to start.
      </p>
      {onTrader ? (
        <button type="button" className="pill small" onClick={onTrader}>
          Open the Trader <span className="arrow" aria-hidden>→</span>
        </button>
      ) : null}
    </section>
  );
}

/** Everything read from the delegated wallet. A read in progress keeps the last one on screen, dimmed, so nothing jumps. */
function Holdings({
  portfolio: p,
  refreshing,
  onRefresh,
  onTrader
}: {
  portfolio: DeskPortfolio;
  refreshing: boolean;
  onRefresh: () => void;
  onTrader?: () => void;
}) {
  const notes = notesOf(p);
  return (
    <div className={`pf-holdings${refreshing ? " stale" : ""}`} aria-busy={refreshing}>
      <Totals portfolio={p} refreshing={refreshing} onRefresh={onRefresh} />
      {notes.length ? (
        <ul className="pf-notes">
          {notes.map((n) => (
            <li key={n.text} className={n.tone}>
              {n.text}
            </li>
          ))}
        </ul>
      ) : null}
      {p.positions.length ? (
        <Positions positions={p.positions} total={p.totals.value} />
      ) : (
        // Only a swap that landed, or may still land, bought anything.
        <NothingHeld bought={p.swaps.some((s) => s.status === "success" || s.status === "pending")} onTrader={onTrader} />
      )}
      <Swaps swaps={p.swaps} />
    </div>
  );
}

/** What the positions are worth, their P&L against what they cost, and the USDG and gas beside them. */
function Totals({ portfolio: p, refreshing, onRefresh }: { portfolio: DeskPortfolio; refreshing: boolean; onRefresh: () => void }) {
  const t = p.totals;
  const tone = toneOf(t.pnl);
  const count = p.positions.length;
  // P&L needs a position with both a price and a cost; without one there is no P&L to show, not a P&L of zero.
  const hasPnl = p.positions.some((x) => x.pnl !== null);
  // "$1,234.56" drawn as a small "$", the dollars, and the cents a step down.
  const [whole, cents] = money(Math.max(0, t.value)).slice(1).split(".");
  return (
    <section className="pf-hero" aria-label="Totals">
      <header className="pf-hero-head">
        <span className="pf-label">Worth now{count ? ` · ${count} ${count === 1 ? "stock" : "stocks"}` : ""}</span>
        <button type="button" className="link-btn" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Reading…" : "Refresh"}
        </button>
      </header>
      {count && t.unpriced === count ? (
        // Stocks held and none priced: what they are worth is unknown, not $0.00.
        <b className="pf-worth none">No prices now</b>
      ) : (
        <b className="pf-worth">
          <span className="pf-cur">$</span>
          {whole}
          {cents ? <span className="pf-cents">.{cents}</span> : null}
        </b>
      )}
      {hasPnl ? (
        <p className={`pf-delta ${tone}`}>
          <span className="pf-chip">
            <i aria-hidden>{ARROW[tone]}</i>
            <b>{signedMoney(t.pnl)}</b>
            {t.pnlPct !== null ? <span>{signedPct(t.pnlPct)}</span> : null}
          </span>
          <small>P&amp;L against what it cost</small>
        </p>
      ) : (
        <p className="pf-delta flat">
          <small>
            {!count
              ? "No stocks held, so no P&L."
              : t.unpriced === count
                ? "No P&L without prices from the desk."
                : "No P&L: no stock here has both a price and a buy on record."}
          </small>
        </p>
      )}
      <dl className="pf-kpis">
        <div>
          <dt>Cost</dt>
          <dd>
            {/* Stocks held and none with a buy on record: the cost is unknown, not $0.00. */}
            {count && t.uncosted === count ? "—" : money(t.cost)}
            <small>of what is held</small>
          </dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd>
            {p.cash ? usdgText(p.cash.amount, p.cash.decimals) : "—"} <em>USDG</em>
            <small>ready to spend</small>
          </dd>
        </div>
        <div className={p.gas.ok ? "" : "low"}>
          <dt>Gas</dt>
          <dd>
            {p.gas.wei !== null ? showAmount(p.gas.wei, 18, 6) : p.gas.ok ? "enough" : "none"} <em>ETH</em>
            <small>{p.gas.ok ? "pays each order" : "needs a little"}</small>
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** A share of the whole as a label: "54%", or "<1%" for a sliver. */
const pctOf = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);

function Positions({ positions, total }: { positions: PortfolioPosition[]; total: number }) {
  return (
    <section className="pf-sec" aria-label="Positions">
      <header className="pf-sec-head">
        <div>
          <h2>Positions</h2>
          <p>Each stock the Trader holds for you, at the desk&apos;s price, against the average it paid.</p>
        </div>
      </header>
      <div className="pf-cols" aria-hidden>
        <span>Stock</span>
        <span>Value · P&amp;L</span>
      </div>
      <ol className="pf-list">
        {positions.map((pos, i) => (
          <PositionRow key={pos.address} position={pos} share={shareOf(pos, total)} index={i} />
        ))}
      </ol>
    </section>
  );
}

function PositionRow({ position: p, share, index }: { position: PortfolioPosition; share: number | null; index: number }) {
  const tone = toneOf(p.pnl);
  const bought = p.buys
    ? `${p.buys} ${p.buys === 1 ? "buy" : "buys"} on record${p.lastBuyAt ? `, the last ${dayOf(p.lastBuyAt)}` : ""}`
    : "No buy on record from this desk";
  return (
    <li className="pf-pos" style={{ "--i": Math.min(index, 12) } as CSSProperties} title={bought}>
      <Logo asset={p} />
      <span className="pf-name">
        <b>{p.ticker}</b>
        <small>{shortName(p.name)}</small>
      </span>
      <span className="pf-value">{p.value === null ? "—" : money(p.value)}</span>
      <span className="pf-meta">
        <span>
          <em>held</em>
          {showAmount(p.amount, p.decimals, 6)}
        </span>
        <span>
          <em>avg</em>
          {p.avgCost === null ? "—" : perShare(p.avgCost)}
        </span>
        <span>
          <em>now</em>
          {p.price === null ? "—" : perShare(p.price)}
        </span>
      </span>
      <span className={`pf-pnl ${p.pnl === null ? "none" : tone}`}>
        {p.pnl === null ? (
          "no P&L"
        ) : (
          <>
            <i aria-hidden>{ARROW[tone]}</i>
            {signedMoney(p.pnl)}
            {p.pnlPct !== null ? <small>{signedPct(p.pnlPct)}</small> : null}
          </>
        )}
      </span>
      {share !== null ? (
        <span className="pf-weight" role="img" aria-label={`${pctOf(share)} of what your stocks are worth`}>
          <span className="pf-track">
            <i style={{ width: `${Math.max(share * 100, 1.5)}%` }} />
          </span>
          <small>{pctOf(share)}</small>
        </span>
      ) : null}
    </li>
  );
}

/** A delegated wallet that holds no stock: nothing bought yet, or all of it sent home. */
function NothingHeld({ bought, onTrader }: { bought: boolean; onTrader?: () => void }) {
  return (
    <section className="pf-empty small" aria-label="No stocks held">
      <b>{bought ? "No stocks held right now" : "Nothing bought yet"}</b>
      <p>
        {bought
          ? "What the Trader bought has gone home, or has not landed yet. Its swaps are below."
          : "Buy a stock from the Trader and it shows here, priced by the desk, against what it cost."}
      </p>
      {onTrader && !bought ? (
        <button type="button" className="chip-btn" onClick={onTrader}>
          Open the Trader
        </button>
      ) : null}
    </section>
  );
}

function Swaps({ swaps }: { swaps: PortfolioSwap[] }) {
  return (
    <section className="pf-sec" aria-label="Recent buys">
      <header className="pf-sec-head">
        <div>
          <h2>Recent buys</h2>
          <p>The last swaps the Trader sent from your wallet, newest first. Each one opens on the explorer.</p>
        </div>
        {swaps.length ? <span className="pf-count">{swaps.length >= 20 ? "last 20" : `${swaps.length} ${swaps.length === 1 ? "swap" : "swaps"}`}</span> : null}
      </header>
      {swaps.length ? (
        <ol className="pf-swaps">
          {swaps.map((s, i) => (
            <SwapRow key={s.hash} swap={s} index={i} />
          ))}
        </ol>
      ) : (
        <p className="tr-note">No swap yet. Each buy the Trader sends shows here, with its link on the explorer.</p>
      )}
    </section>
  );
}

function SwapRow({ swap: s, index }: { swap: PortfolioSwap; index: number }) {
  const state = SWAP_STATE[s.status];
  const name = s.ticker ?? (s.tokenOut ? short(s.tokenOut) : "A stock");
  return (
    <li className={`pf-swap ${state.tone}`} style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <span className="pf-when">
        <b>{s.at ? clockOf(s.at) : "—"}</b>
        <small>{s.at ? dayOf(s.at) : "no time"}</small>
      </span>
      <i className="pf-node" aria-hidden />
      <span className="pf-swap-main">
        <b>{name}</b>
        <span>
          {s.usdgIn !== null ? `${wholeText(s.usdgIn, 6)} USDG` : "USDG not recorded"}
          {s.amountOut !== null ? ` → ${wholeText(s.amountOut, 6)}${s.ticker ? ` ${s.ticker}` : ""}` : ""}
        </span>
      </span>
      <span className="pf-swap-end">
        <span className="pf-state">{state.label}</span>
        {swapReachedChain(s.status) ? (
          <a className="link-btn" href={txUrl(s.hash, s.explorerUrl)} target="_blank" rel="noreferrer">
            {short(s.hash)} ↗
          </a>
        ) : (
          <small title="Signed but never sent, so the explorer has no page for it">{short(s.hash)}</small>
        )}
      </span>
    </li>
  );
}

/** The tokens the owner launched, from Runtime's own launches route. Nothing at all until it answers with some. */
function useLaunches(): Launch[] {
  const [launches, setLaunches] = useState<Launch[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/launches")
      .then(async (res) => (res.ok ? launchesOf(await res.json().catch(() => null)) : []))
      .then((list) => {
        if (live) setLaunches(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return launches;
}

function Launches() {
  const launches = useLaunches();
  if (!launches.length) return null;
  return (
    <section className="pf-sec" aria-label="Your launches">
      <header className="pf-sec-head">
        <div>
          <h2>Your launches</h2>
          <p>Tokens you launched, where they trade, and the fees they earn.</p>
        </div>
        <span className="pf-count">
          {launches.length} {launches.length === 1 ? "token" : "tokens"}
        </span>
      </header>
      <ul className="pf-launches">
        {launches.map((l, i) => (
          <LaunchRow key={l.tokenAddress} launch={l} index={i} />
        ))}
      </ul>
    </section>
  );
}

function LaunchRow({ launch: l, index }: { launch: Launch; index: number }) {
  const facts = [l.pairedSymbol ? `paired with ${l.pairedSymbol}` : null, l.deployedAt ? `launched ${dayOf(l.deployedAt)}` : null].filter(Boolean);
  const links: Array<[string, string | null]> = [
    ["Uniswap", l.links.uniswap],
    ["Bankr", l.links.bankr],
    ["Explorer", l.links.explorer]
  ];
  return (
    <li className="pf-launch" style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <span className="pf-launch-mark" aria-hidden>
        {l.symbol.slice(0, 2)}
      </span>
      <div className="pf-launch-main">
        <b>
          {l.symbol}
          <small>{l.name}</small>
        </b>
        {facts.length ? <p>{facts.join(" · ")}</p> : null}
        {l.fees ? (
          <p className="pf-fees">
            {l.fees.claimableUsd !== null ? <span>{money(l.fees.claimableUsd)} to claim</span> : null}
            {l.fees.claimedUsd !== null ? <span>{money(l.fees.claimedUsd)} claimed</span> : null}
          </p>
        ) : null}
      </div>
      <nav className="pf-launch-links" aria-label={`${l.symbol} links`}>
        {links.map(([label, url]) =>
          url ? (
            <a key={label} className="link-btn" href={url} target="_blank" rel="noreferrer">
              {label} ↗
            </a>
          ) : null
        )}
      </nav>
    </li>
  );
}

function Skeleton() {
  return (
    <div className="pf-skel" role="status" aria-label="Reading the portfolio">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

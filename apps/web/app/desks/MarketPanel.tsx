"use client";

import type { DeskAsset } from "@perkos/desk-contract";
import { useCallback, useMemo, useState, type CSSProperties } from "react";

import { AssetDetail } from "./AssetDetail";
import type { Chain } from "./chains";
import { useMarket } from "./useMarket";
import { useSeries } from "./useSeries";

const price = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const compact = (v: number) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
/** "Apple • Robinhood Token" reads as "Apple" in a row. */
const shortName = (name: string) => name.split(" • ")[0] ?? name;

function Logo({ asset }: { asset: DeskAsset }) {
  const [broken, setBroken] = useState(false);
  if (!asset.logoUrl || broken) {
    return (
      <i className="mk-logo" aria-hidden>
        {asset.ticker.slice(0, 2)}
      </i>
    );
  }
  return <img className="mk-logo" src={asset.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

/**
 * What the desk can trade, as the desk prices it. A value the desk does not
 * know shows as a dash, and a column nobody fills is left out.
 */
export function MarketPanel({ module, chain, onAsk }: { module: string; chain: Chain; onAsk?: (text: string) => void }) {
  const { market, error, loading, refresh } = useMarket(module);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const history = useSeries(module, picked);
  const close = useCallback(() => setPicked(null), []);
  const selected = market?.assets.find((a) => a.ticker === picked) ?? null;

  const assets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = market?.assets ?? [];
    return q ? all.filter((a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) : all;
  }, [market, query]);

  const hasChange = Boolean(market?.assets.some((a) => a.change24hPct !== null));
  const hasVolume = Boolean(market?.assets.some((a) => a.volume24hUsd !== null));
  const allTradeable = Boolean(market?.assets.every((a) => a.tradeable === true));
  const columns = ["minmax(0, 1fr)", "112px", hasChange && "76px", hasVolume && "80px", !allTradeable && "108px"].filter(Boolean).join(" ");
  const grid = { gridTemplateColumns: columns } as CSSProperties;

  return (
    <section className={`mk ${chain}${selected ? " has-detail" : ""}`} aria-label="Market">
      <header className="mk-head">
        <div className="mk-title">
          <span className="kicker">Market</span>
          <p className="mk-meta" aria-live="polite">
            {market
              ? `${market.assets.length} assets · priced in ${market.quoteSymbol}${allTradeable ? " · all tradeable" : ""} · as of ${clock(market.observedAt)}`
              : loading
                ? "Reading the market…"
                : ""}
          </p>
        </div>
        <label className="mk-find">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={query} placeholder="Find a stock" aria-label="Find a stock" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="link-btn" disabled={loading} onClick={refresh}>
          {loading && market ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? (
        <div className="mk-error" role="alert">
          <span>{error}</span>
          <button type="button" className="chip-btn" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : null}

      {market ? (
        <div className="mk-cols" style={grid} aria-hidden>
          <span>Asset</span>
          <span>Price · {market.quoteSymbol}</span>
          {hasChange ? <span>24h</span> : null}
          {hasVolume ? <span>Volume</span> : null}
          {!allTradeable ? <span>Status</span> : null}
        </div>
      ) : null}

      <ul className="mk-rows" aria-busy={loading && !market}>
        {!market && loading
          ? Array.from({ length: 8 }, (_, i) => <li key={i} className="mk-skel" style={{ "--i": i } as CSSProperties} />)
          : assets.map((a, i) => (
              <li key={a.address} className="mk-li" style={{ "--i": Math.min(i, 18) } as CSSProperties}>
                <button
                  type="button"
                  className={`mk-row${a.ticker === picked ? " on" : ""}`}
                  style={grid}
                  aria-pressed={a.ticker === picked}
                  onClick={() => setPicked(a.ticker === picked ? null : a.ticker)}
                >
                  <span className="mk-asset">
                    <Logo asset={a} />
                    <span>
                      <b>{a.ticker}</b>
                      <small>{shortName(a.name)}</small>
                    </span>
                  </span>
                  <span className="mk-price" title={a.priceAt ? `Price at ${clock(a.priceAt)}` : "No price right now"}>
                    {a.priceUsd === null ? "—" : price(a.priceUsd)}
                  </span>
                  {hasChange ? (
                    <span className={`mk-chg${a.change24hPct === null ? "" : a.change24hPct >= 0 ? " up" : " down"}`}>
                      {a.change24hPct === null ? "—" : pct(a.change24hPct)}
                    </span>
                  ) : null}
                  {hasVolume ? <span className="mk-vol">{a.volume24hUsd === null ? "—" : compact(a.volume24hUsd)}</span> : null}
                  {!allTradeable ? (
                    <span className={`mk-trade ${a.tradeable === true ? "yes" : a.tradeable === false ? "no" : "unknown"}`}>
                      {a.tradeable === true ? "Tradeable" : a.tradeable === false ? "Not tradeable" : "Unknown"}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
        {market && !assets.length ? <li className="mk-empty">No stock matches &ldquo;{query.trim()}&rdquo;.</li> : null}
      </ul>

      {selected && market ? (
        <AssetDetail
          key={selected.ticker}
          asset={selected}
          quote={market.quoteSymbol}
          logo={<Logo asset={selected} />}
          series={history.series}
          loading={history.loading}
          onAsk={onAsk}
          onClose={close}
        />
      ) : null}
    </section>
  );
}

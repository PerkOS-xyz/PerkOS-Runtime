"use client";

import type { DeskAsset, DeskSeries } from "@perkos/desk-contract";
import { useEffect, type ReactNode } from "react";

import { sparkline } from "./sparkline";

const num = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;

/** How long a series covers: "23-hour", "5-day". */
function span(series: DeskSeries): string {
  if (series.days) return `${series.days}-day`;
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  if (!first || !last) return "";
  const hours = Math.max(1, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 3_600_000));
  return hours >= 36 ? `${Math.round(hours / 24)}-day` : `${hours}-hour`;
}

/** One asset up close: its price, its recent range as the desk measured it, and a way to ask Sparky. */
export function AssetDetail({
  asset,
  quote,
  logo,
  series,
  loading,
  onAsk,
  onClose
}: {
  asset: DeskAsset;
  quote: string;
  logo: ReactNode;
  series: DeskSeries | null;
  loading: boolean;
  onAsk?: (text: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spark = series ? sparkline(series.points) : null;
  const change = asset.change24hPct ?? series?.change24hPct ?? null;

  return (
    <aside className="mk-detail" role="dialog" aria-label={`${asset.ticker} up close`}>
      <header>
        {logo}
        <div>
          <b>{asset.ticker}</b>
          <small>{asset.name.split(" • ")[0]}</small>
        </div>
        <div className="mk-detail-price">
          <strong>{asset.priceUsd === null ? "—" : num(asset.priceUsd)}</strong>
          <span>{quote}</span>
          {change !== null ? <em className={change >= 0 ? "up" : "down"}>{pct(change)} 24h</em> : null}
        </div>
        <button type="button" className="bubble-close" aria-label="Close" onClick={onClose}>
          &times;
        </button>
      </header>

      <figure className="mk-chart">
        {spark ? (
          <div className="mk-plot">
            <svg viewBox="0 0 600 140" preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="mk-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill="url(#mk-fill)" />
              <path d={spark.line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            <i className="mk-dot" style={{ left: `${spark.last.x}%`, top: `${spark.last.y}%` }} aria-hidden />
          </div>
        ) : (
          <p className="mk-chart-wait">{loading ? "Reading the history…" : `No history for ${asset.ticker} right now.`}</p>
        )}
        {series && spark ? (
          <figcaption>
            {span(series)} range {num(spark.low)} to {num(spark.high)} {quote} · measured by {series.source}
          </figcaption>
        ) : null}
      </figure>

      <footer>
        <span className={`mk-trade ${asset.tradeable === true ? "yes" : asset.tradeable === false ? "no" : "unknown"}`}>
          {asset.tradeable === true ? "Tradeable" : asset.tradeable === false ? "Not tradeable" : "Tradeability unknown"}
        </span>
        {onAsk ? (
          <button type="button" className="chip-btn" onClick={() => onAsk(`Tell me about ${asset.ticker} on this desk.`)}>
            Ask Sparky about {asset.ticker}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

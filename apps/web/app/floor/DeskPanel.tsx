"use client";

import { useEffect, useState } from "react";

// Pantallas propias del desk (PerkOS Floor desk): Market y Portfolio, como en
// EQLTY pero sin vault intermedio (las llaves son de la persona). El template
// declarara `screens[]`; hoy el registro es este componente y el desk es uno.

type Row = { symbol: string; ticker: string; name: string; issuer: string; address: string; priceUsd?: number; priceChange24hPct?: number; volume24hUsd?: number; pool: { address: string; fee: number; usdcDepth: number } | null; tradeable: boolean };
type Position = { symbol: string; ticker: string; name: string; issuer: string; balance: string; valueUsd: number; priceUsd?: number };

export type DeskScreen = "market" | "portfolio";

const usd = (n?: number, d = 2) => (n === undefined || !Number.isFinite(n) ? "–" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const issuerLabel = (i: string) => (i === "coinbase" ? "Coinbase" : i === "dinari" ? "Dinari" : i === "anchored" ? "Anchored" : i === "st0x" ? "ST0x" : i);

export default function DeskPanel({ screen, focus, onScreen, onClose, onSay }: {
  screen: DeskScreen;
  /** Ticker o simbolo que el turno de mesa esta mirando ("AMZN"). */
  focus: string;
  onScreen: (s: DeskScreen) => void;
  onClose: () => void;
  /** Manda una frase por el mismo router que el chat ("buy $5 of AAPLc"). */
  onSay: (text: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setErr("");
    if (screen === "market") {
      fetch("/api/market/stocks?depth=1&limit=24").then((r) => r.json()).then((j) => { if (live) setRows(j.stocks ?? []); }).catch((e) => live && setErr(String(e)));
    } else {
      fetch("/api/market/portfolio").then((r) => r.json()).then((j) => { if (!live) return; if (j.error) { setErr(j.detail ?? j.error); setPositions([]); } else { setPositions(j.positions ?? []); setTotal(j.totalUsd ?? 0); } }).catch((e) => live && setErr(String(e)));
    }
    return () => { live = false; };
  }, [screen]);

  const f = focus.toLowerCase();
  const list = (rows ?? []).filter((r) => !q || [r.symbol, r.ticker, r.name].some((v) => v.toLowerCase().includes(q.toLowerCase())));

  return (
    <aside className="desk-panel" aria-label="Desk screens">
      <header>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={screen === "market"} className={screen === "market" ? "on" : ""} onClick={() => onScreen("market")}>Market</button>
          <button type="button" role="tab" aria-selected={screen === "portfolio"} className={screen === "portfolio" ? "on" : ""} onClick={() => onScreen("portfolio")}>Portfolio</button>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {screen === "market" ? (
        <>
          <p className="hint-line">Tokenized stocks on Base · Uniswap V3 · deepest USDC pool decides what the desk can trade.</p>
          <input className="search" value={q} placeholder="Search a stock…" onChange={(e) => setQ(e.target.value)} />
          {err ? <p className="hint-line err">{err}</p> : null}
          {!rows ? <p className="hint-line">Loading the market…</p> : null}
          <ul className="rows">
            {list.map((r) => {
              const on = f && (r.ticker.toLowerCase() === f || r.symbol.toLowerCase() === f || r.name.toLowerCase().includes(f));
              return (
                <li key={r.address} className={`${on ? "focus" : ""}${r.tradeable ? "" : " thin"}`}>
                  <div className="cell name">
                    <b>{r.symbol}</b>
                    <small>{r.name} · {issuerLabel(r.issuer)}</small>
                  </div>
                  <div className="cell num">
                    <b>{usd(r.priceUsd)}</b>
                    <small className={(r.priceChange24hPct ?? 0) < 0 ? "down" : "up"}>{r.priceChange24hPct === undefined ? "" : `${r.priceChange24hPct > 0 ? "+" : ""}${r.priceChange24hPct.toFixed(2)}%`}</small>
                  </div>
                  <div className="cell num">
                    <b>{r.pool ? usd(r.pool.usdcDepth, 0) : "no pool"}</b>
                    <small>{r.pool ? `USDC · ${r.pool.fee / 10_000}%` : "USDC"}</small>
                  </div>
                  <div className="cell acts">
                    <button type="button" onClick={() => onSay(`analyze ${r.ticker}`)}>Analyze</button>
                    <button type="button" disabled={!r.tradeable} onClick={() => onSay(`buy $5 of ${r.symbol}`)}>Buy $5</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <p className="hint-line">Your tokenized stocks on Base, in your wallet. Sell drafts an order; Send moves them out.</p>
          {err ? <p className="hint-line err">{err}</p> : null}
          {!positions ? <p className="hint-line">Reading your wallet…</p> : positions.length === 0 ? <p className="hint-line">No tokenized stocks yet. Try "buy $5 of NVIDIA".</p> : null}
          {positions && positions.length ? <div className="total"><span>Total</span><b>{usd(total)}</b></div> : null}
          <ul className="rows">
            {(positions ?? []).map((p) => (
              <li key={p.symbol + p.issuer}>
                <div className="cell name">
                  <b>{p.symbol}</b>
                  <small>{p.name} · {issuerLabel(p.issuer)}</small>
                </div>
                <div className="cell num">
                  <b>{p.balance}</b>
                  <small>shares</small>
                </div>
                <div className="cell num">
                  <b>{usd(p.valueUsd)}</b>
                  <small>@ {usd(p.priceUsd)}</small>
                </div>
                <div className="cell acts">
                  <button type="button" onClick={() => onSay(`sell half of my ${p.symbol}`)}>Sell half</button>
                  <button type="button" onClick={() => onSay(`sell all of my ${p.symbol}`)}>Sell all</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

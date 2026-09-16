"use client";

import { useEffect, useState } from "react";

// Pantallas propias del desk (PerkOS Floor desk): Market y Portfolio, como en
// EQLTY pero sin vault intermedio (las llaves son de la persona). El template
// declarara `screens[]`; hoy el registro es este componente y el desk es uno.

type Row = { symbol: string; ticker: string; name: string; issuer: string; address: string; priceUsd?: number; priceChange24hPct?: number; volume24hUsd?: number; logoUrl?: string; sparkline?: number[]; pool: { address: string; fee: number; usdcDepth: number } | null; tradeable: boolean };
type Position = { symbol: string; ticker: string; name: string; issuer: string; balance: string; valueUsd: number; priceUsd?: number; priceChange24hPct?: number; sparkline?: number[] };

/** Linea de precio de las ultimas 24 h (un punto por hora). Sin ejes: es
 *  una senal, no un grafico de analisis. */
function Spark({ points, w = 96, h = 28, big = false }: { points?: number[]; w?: number; h?: number; big?: boolean }) {
  if (!points || points.length < 2) return <svg className="spark" width={w} height={h} aria-hidden />;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg className={`spark${up ? " up" : " down"}${big ? " big" : ""}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {big ? <path className="fill" d={`${d} L${w},${h} L0,${h} Z`} /> : null}
      <path d={d} />
    </svg>
  );
}

export type DeskScreen = "market" | "portfolio" | "notes";
type Note = { id: string; desk: string; kind: string; title: string; ticker?: string; body: string; updatedAt: string };
type Hit = { id: string; kind: string; title: string; ticker?: string; updatedAt: string; snippet: string };

const usd = (n?: number, d = 2) => (n === undefined || !Number.isFinite(n) ? "–" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const issuerLabel = (i: string) => (i === "coinbase" ? "Coinbase" : i === "dinari" ? "Dinari" : i === "anchored" ? "Anchored" : i === "st0x" ? "ST0x" : i);

export default function DeskPanel({ screen, focus, onScreen, onClose, onSay, onSummarize }: {
  screen: DeskScreen;
  /** Ticker o simbolo que el turno de mesa esta mirando ("AMZN"). */
  focus: string;
  onScreen: (s: DeskScreen) => void;
  onClose: () => void;
  /** Manda una frase por el mismo router que el chat ("buy $5 of AAPLc"). */
  onSay: (text: string) => void;
  /** Cierre del dia: diario -> memory.md. */
  onSummarize?: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState<(Note & { path: string }) | null>(null);
  const [nq, setNq] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const saveNote = async () => {
    if (!open) return;
    setSaving(true);
    try {
      const r = await fetch("/api/kb/note", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: open.id, body: draftBody }) });
      const j = await r.json();
      if (r.ok && j.body !== undefined) { setOpen(j); setEditing(false); }
    } finally { setSaving(false); }
  };

  useEffect(() => {
    let live = true;
    setErr("");
    if (screen === "market") {
      fetch("/api/market/stocks?depth=1&limit=24").then((r) => r.json()).then((j) => { if (live) setRows(j.stocks ?? []); }).catch((e) => live && setErr(String(e)));
    } else if (screen === "notes") {
      setOpen(null);
      fetch("/api/kb/notes?limit=40").then((r) => r.json()).then((j) => { if (live) setNotes(j.notes ?? []); }).catch((e) => live && setErr(String(e)));
    } else {
      fetch("/api/market/portfolio").then((r) => r.json()).then((j) => { if (!live) return; if (j.error) { setErr(j.detail ?? j.error); setPositions([]); } else { setPositions(j.positions ?? []); setTotal(j.totalUsd ?? 0); } }).catch((e) => live && setErr(String(e)));
    }
    return () => { live = false; };
  }, [screen]);

  const f = focus.toLowerCase();
  const list = (rows ?? []).filter((r) => !q || [r.symbol, r.ticker, r.name].some((v) => v.toLowerCase().includes(q.toLowerCase())));
  const [picked, setPicked] = useState<string>("");
  const isFocus = (r: Row) => Boolean(f && (r.ticker.toLowerCase() === f || r.symbol.toLowerCase() === f || r.name.toLowerCase().includes(f)));
  const detail = (rows ?? []).find((r) => r.address === picked) ?? (rows ?? []).find(isFocus) ?? null;

  return (
    <aside className="desk-panel" aria-label="Desk screens">
      <header>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={screen === "market"} className={screen === "market" ? "on" : ""} onClick={() => onScreen("market")}>Market</button>
          <button type="button" role="tab" aria-selected={screen === "portfolio"} className={screen === "portfolio" ? "on" : ""} onClick={() => onScreen("portfolio")}>Portfolio</button>
          <button type="button" role="tab" aria-selected={screen === "notes"} className={screen === "notes" ? "on" : ""} onClick={() => onScreen("notes")}>Notes</button>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {screen === "market" ? (
        <>
          <p className="hint-line">Tokenized stocks on Base · Uniswap V3 · deepest USDC pool decides what the desk can trade.</p>
          <input className="search" value={q} placeholder="Search a stock…" onChange={(e) => setQ(e.target.value)} />
          {err ? <p className="hint-line err">{err}</p> : null}
          {!rows ? <p className="hint-line">Loading the market…</p> : null}
          {detail ? (
            <div className="detail">
              <div className="detail-head">
                <div>
                  <b>{detail.name} <span>{detail.symbol} · {issuerLabel(detail.issuer)}</span></b>
                  <small>{detail.pool ? `Uniswap V3 · ${detail.pool.fee / 10_000}% · ${usd(detail.pool.usdcDepth, 0)} USDC deep` : "No USDC pool on Uniswap V3 Base"}</small>
                </div>
                <div className="num">
                  <b>{usd(detail.priceUsd)}</b>
                  <small className={(detail.priceChange24hPct ?? 0) < 0 ? "down" : "up"}>{detail.priceChange24hPct === undefined ? "24 h" : `${detail.priceChange24hPct > 0 ? "+" : ""}${detail.priceChange24hPct.toFixed(2)}% · 24 h`}</small>
                </div>
              </div>
              <Spark points={detail.sparkline} w={440} h={96} big />
              <div className="detail-acts">
                <button type="button" onClick={() => onSay(`analyze ${detail.ticker}`)}>Analyze</button>
                <button type="button" disabled={!detail.tradeable} onClick={() => onSay(`buy $5 of ${detail.symbol}`)}>Buy $5</button>
                <button type="button" disabled={!detail.tradeable} onClick={() => onSay(`sell half of my ${detail.symbol}`)}>Sell half</button>
              </div>
            </div>
          ) : null}
          <ul className="rows">
            {list.map((r) => {
              const on = isFocus(r) || r.address === picked;
              return (
                <li key={r.address} className={`${on ? "focus" : ""}${r.tradeable ? "" : " thin"}`} onClick={() => setPicked(r.address)}>
                  <div className="cell name">
                    <b>{r.symbol}</b>
                    <small>{r.name} · {issuerLabel(r.issuer)}</small>
                  </div>
                  <div className="cell chart"><Spark points={r.sparkline} /></div>
                  <div className="cell num">
                    <b>{usd(r.priceUsd)}</b>
                    <small className={(r.priceChange24hPct ?? 0) < 0 ? "down" : "up"}>{r.priceChange24hPct === undefined ? "" : `${r.priceChange24hPct > 0 ? "+" : ""}${r.priceChange24hPct.toFixed(2)}%`}</small>
                  </div>
                  <div className="cell num">
                    <b>{r.pool ? usd(r.pool.usdcDepth, 0) : "no pool"}</b>
                    <small>{r.pool ? `USDC · ${r.pool.fee / 10_000}%` : "USDC"}</small>
                  </div>
                  <div className="cell acts">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSay(`analyze ${r.ticker}`); }}>Analyze</button>
                    <button type="button" disabled={!r.tradeable} onClick={(e) => { e.stopPropagation(); onSay(`buy $5 of ${r.symbol}`); }}>Buy $5</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : screen === "notes" ? (
        <>
          <p className="hint-line">What this desk remembers: journal, analyses, orders and memory. Local Markdown in ~/.perkos-floor/knowledge, Obsidian-compatible.</p>
          <div className="notes-bar">
            <input className="search" value={nq} placeholder="Search the desk's notes (meaning, not just words)…" onChange={(e) => { const v = e.target.value; setNq(v); if (v.trim().length < 2) { setHits(null); return; } fetch(`/api/kb/search?q=${encodeURIComponent(v)}`).then((r) => r.json()).then((j) => setHits(j.hits ?? [])).catch(() => setHits([])); }} />
            {onSummarize ? <button type="button" onClick={onSummarize} title="Summarize today's journal into memory.md">Summarize today</button> : null}
            <button type="button" onClick={() => { fetch("/api/kb/notes?kind=memory").then((r) => r.json()).then((j) => { const m = (j.notes ?? [])[0]; if (m) fetch(`/api/kb/note?id=${encodeURIComponent(m.id)}`).then((r2) => r2.json()).then((n) => { if (n.body !== undefined) { setOpen(n); setEditing(false); } }); }); }} title="The desk's stable memory (editable)">Memory</button>
          </div>
          {err ? <p className="hint-line err">{err}</p> : null}
          {open ? (
            <div className="note-open">
              <div className="note-head">
                <b>{open.title}</b>
                <div className="acts">
                  <a href={`obsidian://open?path=${encodeURIComponent(open.path)}`} title="Open in Obsidian">Obsidian ↗</a>
                  {editing ? (
                    <>
                      <button type="button" disabled={saving} onClick={() => void saveNote()}>{saving ? "Saving…" : "Save"}</button>
                      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setDraftBody(open.body); setEditing(true); }}>Edit</button>
                  )}
                  <button type="button" onClick={() => { setOpen(null); setEditing(false); }}>Back</button>
                </div>
              </div>
              {editing ? <textarea className="note-edit" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} spellCheck={false} /> : <pre>{open.body}</pre>}
            </div>
          ) : (
            <ul className="rows notes">
              {(hits ?? notes ?? []).map((n) => (
                <li key={n.id} onClick={() => { fetch(`/api/kb/note?id=${encodeURIComponent(n.id)}`).then((r) => r.json()).then((j) => { if (j.body !== undefined) setOpen(j); }).catch(() => undefined); }}>
                  <div className="cell name">
                    <b>{n.title}</b>
                    <small>{n.kind}{n.ticker ? ` · ${n.ticker}` : ""} · {n.updatedAt.slice(0, 16).replace("T", " ")}</small>
                    {"snippet" in n ? <small className="snip">{(n as Hit).snippet}</small> : null}
                  </div>
                </li>
              ))}
              {!notes && !hits ? <li><div className="cell name"><small>Reading the vault…</small></div></li> : null}
              {notes && notes.length === 0 && !hits ? <li><div className="cell name"><small>Nothing yet. Every turn, analysis and order will be written here.</small></div></li> : null}
            </ul>
          )}
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
                <div className="cell chart"><Spark points={p.sparkline} /></div>
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

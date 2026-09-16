"use client";

import { useEffect, useState, type ReactNode } from "react";
import AgentCards, { type DeskTurn } from "./AgentCards";
import { marked } from "marked";
import DOMPurify from "dompurify";

/** Markdown -> HTML saneado para la vista previa de una nota (sin frontmatter). */
function renderMd(body: string): string {
  const src = body.replace(/^---\n[\s\S]*?\n---\n/, "");
  const html = marked.parse(src, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
/** Imprime solo la nota (Print > Save as PDF en macOS). */
function printNote(title: string, html: string) {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title><style>body{font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.25}code,pre{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:#f4f4f6;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}small.src{display:block;margin-top:32px;color:#777}</style></head><body>${html}<small class="src">PerkOS Floor · ${new Date().toLocaleString()}</small></body></html>`);
  w.document.close();
  w.focus();
  window.setTimeout(() => { w.print(); }, 300);
}

// Pantallas propias del desk (PerkOS Floor Desk): Market y Portfolio, como en
// EQLTY pero sin vault intermedio (las llaves son de la persona). El template
// declarara `screens[]`; hoy el registro es este componente y el desk es uno.

type Row = { symbol: string; ticker: string; name: string; issuer: string; address: string; priceUsd?: number; priceChange24hPct?: number; volume24hUsd?: number; logoUrl?: string; sparkline?: number[]; pool: { venue?: "uniswap" | "aerodrome"; address: string; fee: number; usdcDepth: number } | null; tradeable: boolean };
const venueName = (v?: string) => (v === "aerodrome" ? "Aerodrome" : "Uniswap V3");
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

export type DeskScreen = "market" | "portfolio" | "notes" | "map" | "history";
type Note = { id: string; desk: string; kind: string; title: string; ticker?: string; body: string; updatedAt: string };
type Hit = { id: string; kind: string; title: string; ticker?: string; updatedAt: string; snippet: string };

const usd = (n?: number, d = 2) => (n === undefined || !Number.isFinite(n) ? "–" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const issuerLabel = (i: string) => (i === "coinbase" ? "Coinbase" : i === "dinari" ? "Dinari" : i === "anchored" ? "Anchored" : i === "st0x" ? "ST0x" : i);

export default function DeskPanel({ screen, focus, onScreen, onClose, onSay, onSummarize, map, max, onMax }: {
  /** Maximizado: ocupa todo el stage y oculta el chat. */
  max?: boolean;
  onMax?: (v: boolean) => void;
  screen: DeskScreen;
  /** Ticker o simbolo que el turno de mesa esta mirando ("AMZN"). */
  focus: string;
  onScreen: (s: DeskScreen) => void;
  onClose: () => void;
  /** Manda una frase por el mismo router que el chat ("buy $5 of AAPLc"). */
  onSay: (text: string) => void;
  /** Cierre del dia: diario -> memory.md. */
  onSummarize?: () => void;
  /** Mapa del desk (grafo), lo renderiza FloorApp que tiene el estado vivo. */
  map?: ReactNode;
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
    <aside className={`desk-panel dock ${screen}${max ? " max" : ""}`} aria-label="Desk screens">
      <header>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={screen === "market"} className={screen === "market" ? "on" : ""} onClick={() => onScreen("market")}>Market</button>
          <button type="button" role="tab" aria-selected={screen === "portfolio"} className={screen === "portfolio" ? "on" : ""} onClick={() => onScreen("portfolio")}>Portfolio</button>
          <button type="button" role="tab" aria-selected={screen === "notes"} className={screen === "notes" ? "on" : ""} onClick={() => onScreen("notes")}>Notes</button>
          <button type="button" role="tab" aria-selected={screen === "map"} className={screen === "map" ? "on" : ""} onClick={() => onScreen("map")}>Map</button>
          <button type="button" role="tab" aria-selected={screen === "history"} className={screen === "history" ? "on" : ""} onClick={() => onScreen("history")}>History</button>
        </div>
        <div className="panel-acts">
          <button type="button" className="close" onClick={() => onMax?.(!max)} aria-label={max ? "Restore" : "Maximize"} title={max ? "Restore: show the chat" : "Maximize: hide the chat"}>
            {max ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4" /><path d="M15 3h4a2 2 0 0 1 2 2v4" /><path d="M9 21H5a2 2 0 0 1-2-2v-4" /><path d="M15 21h4a2 2 0 0 0 2-2v-4" /><rect x="8" y="8" width="8" height="8" rx="1" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
            )}
          </button>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </header>

      {screen === "history" ? (
        <History />
      ) : screen === "map" ? (
        <>
          <p className="hint-line">The desk as a graph: you sign, Floor speaks, the team hands off, the world is what they look at. Click a node.</p>
          {map}
        </>
      ) : screen === "market" ? (
        <>
          <p className="hint-line">Tokenized stocks on Base · Uniswap V3 and Aerodrome · the deepest USDC pool decides what the desk can trade, the best price decides where.</p>
          <input className="search" value={q} placeholder="Search a stock…" onChange={(e) => setQ(e.target.value)} />
          {err ? <p className="hint-line err">{err}</p> : null}
          {!rows ? <p className="hint-line">Loading the market…</p> : null}
          {detail ? (
            <div className="detail">
              <div className="detail-head">
                <div>
                  <b>{detail.name} <span>{detail.symbol} · {issuerLabel(detail.issuer)}</span></b>
                  <small>{detail.pool ? `${venueName(detail.pool.venue)} · ${detail.pool.fee / 10_000}% · ${usd(detail.pool.usdcDepth, 0)} USDC deep` : "No USDC pool on Uniswap V3 or Aerodrome"}</small>
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
            <li className="head" aria-hidden="true">
              <div className="cell name"><small>Stock · issuer</small></div>
              <div className="cell chart"><small>24h</small></div>
              <div className="cell num"><small>Price · 24h</small></div>
              <div className="cell num"><small>Liquidity · venue</small></div>
              <div className="cell acts"><small>Actions</small></div>
            </li>
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
                    <small>{r.pool ? `${venueName(r.pool.venue)} · ${r.pool.fee / 10_000}%` : "USDC"}</small>
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
                    <>
                      <button type="button" onClick={() => { setDraftBody(open.body); setEditing(true); }}>Edit</button>
                      <button type="button" onClick={() => printNote(open.title, renderMd(open.body))} title="Print or save as PDF">Print / PDF</button>
                    </>
                  )}
                  <button type="button" onClick={() => { setOpen(null); setEditing(false); }}>Back</button>
                </div>
              </div>
              {editing ? <textarea className="note-edit" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} spellCheck={false} /> : <div className="note-md" dangerouslySetInnerHTML={{ __html: renderMd(open.body) }} />}
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
            <li className="head" aria-hidden="true">
              <div className="cell name"><small>Position · issuer</small></div>
              <div className="cell chart"><small>24h</small></div>
              <div className="cell num"><small>Shares</small></div>
              <div className="cell num"><small>Value · price</small></div>
              <div className="cell acts"><small>Actions</small></div>
            </li>
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


/** History: cada decision de la mesa (nota decisions/ con el run en JSON) y su replay. */
function History() {
  const [view, setView] = useState<"decisions" | "log">("decisions");
  const [rows, setRows] = useState<Array<{ id: string; title: string; ticker?: string; updatedAt: string }>>([]);
  const [sel, setSel] = useState<string>("");
  const [run, setRun] = useState<DeskTurn | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/kb/notes?kind=decision&limit=40").then((r) => r.json()).then((j) => { if (alive) setRows((j.notes ?? []).map((n: { id: string; title: string; ticker?: string; updatedAt: string }) => ({ id: n.id, title: n.title, ticker: n.ticker, updatedAt: n.updatedAt }))); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    setBusy(true);
    fetch(`/api/kb/note?id=${encodeURIComponent(sel)}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const m = String(j.body ?? "").match(/```json\n([\s\S]*?)\n```/);
      setRun(m ? (JSON.parse(m[1]) as DeskTurn) : null);
    }).catch(() => setRun(null)).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [sel]);
  return (
    <div className="history">
      <div className="hist-seg" role="tablist" aria-label="History views">
        <button type="button" role="tab" aria-selected={view === "decisions"} className={view === "decisions" ? "on" : ""} onClick={() => setView("decisions")}>Decisions</button>
        <button type="button" role="tab" aria-selected={view === "log"} className={view === "log" ? "on" : ""} onClick={() => setView("log")}>Quality</button>
      </div>
      {view === "log" ? <QualityLog /> : null}
      {view === "log" ? null : <>
      <p className="hint">Every decision the desk made, with who said what. Click one to see the run.</p>
      {rows.length === 0 ? <p className="hint">No decisions yet. Ask the desk to draft a trade.</p> : null}
      <div className="hist-list">
        {rows.map((r) => (
          <button type="button" key={r.id} className={`hist-row${sel === r.id ? " on" : ""}`} onClick={() => setSel(r.id)}>
            <span className="d">{r.updatedAt.slice(5, 16).replace("T", " ")}</span>
            <span className="t">{r.title.replace(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} /, "")}</span>
            {r.ticker ? <span className="tk">{r.ticker}</span> : null}
          </button>
        ))}
      </div>
      {busy ? <p className="hint">Reading the run…</p> : null}
      {run ? (
        <div className="hist-run">
          <div className="hist-meta">{run.verdict ? <em className={`vchip ${run.verdict.toLowerCase()}`}>{run.verdict}</em> : null} {run.endedAt && run.startedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)} s` : ""} {run.receipt?.hash ? `· signed ${run.receipt.hash.slice(0, 10)}…` : "· unsigned"}</div>
          <AgentCards turn={{ ...run, collapsed: false, live: false }} mode="replay" />
          <div className="hist-who">
            {(["scout", "risk", "trader", "auditor"] as const).map((r) => run.agents[r]?.text ? <p key={r}><b>{r}</b> {run.agents[r].text}</p> : null)}
          </div>
        </div>
      ) : null}
      </>}
    </div>
  );
}

/** Quality: el log de turnos de la mesa (~/.perkos-floor/logs) con las
 * senales del lint, para ver donde falla cada rol sin abrir el JSONL. */
type LogReply = { role: string; ok: boolean; ms?: number; reply?: string; detail?: string };
type LogEntry = { at: string; mode: string; text: string; ms: number; verdict: string | null; flags: string[]; replies: LogReply[] };
const FLAG_HELP: Record<string, string> = {
  "no-answer": "did not answer in time",
  "says-market-closed": "said the market is closed; the token trades 24/7, only the reference pauses",
  "no-mention": "did not hand off with an @mention",
  "pct-not-in-facts": "quoted a percentage that is not in the facts, the news or the memory",
  "size-over-limit": "recommended a size above the 100 USDC limit",
  "over-length": "longer than the role's word budget",
  "no-verdict": "Risk gave no GO or BLOCK on an order",
  "no-risk-level": "Risk gave no risk level",
  "no-citation": "no [F<n>] or [N] tag pointing to the fact behind a claim"
};
const flagName = (f: string) => f.replace(/^[a-z]+:/, "").replace(/\(.*\)$/, "");
const flagRole = (f: string) => (f.match(/^([a-z]+):/)?.[1] ?? "");
type Outlook = { id: string; title: string; askedAt: string; dueAt: string; due: boolean; reviewed: boolean; picks: string[]; avoid?: string; result?: { daysLater: number; marketAvgPct: number; picksAvgPct?: number; beatBy?: number; verdict: string } };
const pctS = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
/** Outlooks fechados y su revision al mes (o a pedido): el track record de la mesa. */
function Outlooks() {
  const [rows, setRows] = useState<Outlook[] | null>(null);
  const [busy, setBusy] = useState<string>("");
  const load = () => fetch("/api/desk/review").then((r) => r.json()).then((j) => setRows(j.outlooks ?? [])).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);
  const review = async (id: string) => {
    setBusy(id);
    try { await fetch("/api/desk/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, force: true }) }); await load(); } finally { setBusy(""); }
  };
  if (!rows) return null;
  return (
    <div className="qlog-outlooks">
      <div className="qlog-h"><b className="t">Outlooks</b><span>{rows.length ? `${rows.filter((o) => o.reviewed).length} reviewed · ${rows.filter((o) => o.due).length} due` : "none yet"}</span></div>
      {rows.map((o) => {
        const days = Math.max(0, Math.ceil((Date.parse(o.dueAt) - Date.now()) / 86_400_000));
        return (
          <div key={o.id} className={`qlog-outlook${o.reviewed ? " done" : o.due ? " due" : ""}`}>
            <span className="d">{o.askedAt.slice(5, 16).replace("T", " ")}</span>
            <span className="t">{o.picks.length ? `picks ${o.picks.join(", ")}` : "no picks parsed"}{o.avoid ? ` · avoid ${o.avoid}` : ""}</span>
            {o.reviewed && o.result ? (
              <em title={o.result.verdict}>{o.result.picksAvgPct !== undefined ? `picks ${pctS(o.result.picksAvgPct)} vs market ${pctS(o.result.marketAvgPct)}` : `market ${pctS(o.result.marketAvgPct)}`} · {o.result.daysLater} d</em>
            ) : (
              <button type="button" disabled={busy === o.id} onClick={() => review(o.id)} title={o.due ? "Due: compare the picks with today's prices" : `Review is due in ${days} day${days === 1 ? "" : "s"}; review now against today's prices`}>{busy === o.id ? "Reviewing…" : o.due ? "Review (due)" : `Review now · due in ${days} d`}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
function QualityLog() {
  const [data, setData] = useState<{ count: number; totals: Record<string, number>; entries: LogEntry[] } | null>(null);
  const [sel, setSel] = useState<number>(-1);
  useEffect(() => {
    let alive = true;
    fetch("/api/desk/log?limit=40").then((r) => r.json()).then((j) => { if (alive) setData({ count: j.count ?? 0, totals: j.totals ?? {}, entries: j.entries ?? [] }); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!data) return <p className="hint">Reading the desk log…</p>;
  const byFlag: Record<string, number> = {};
  for (const [k, n] of Object.entries(data.totals)) byFlag[flagName(k)] = (byFlag[flagName(k)] ?? 0) + n;
  const flagged = data.entries.filter((e) => e.flags.length).length;
  const cur = sel >= 0 ? data.entries[sel] : null;
  return (
    <div className="qlog">
      <p className="hint">Every turn the desk ran, with the automatic checks on each reply. A flag is a signal to review, not a verdict.</p>
      <Outlooks />
      {data.count === 0 ? <p className="hint">No turns logged yet. Ask the desk something.</p> : (
        <div className="qlog-totals">
          <span className="n">{data.count} turns · {flagged} with flags</span>
          {Object.entries(byFlag).sort((a, b) => b[1] - a[1]).map(([f, n]) => <em key={f} title={FLAG_HELP[f] ?? f}>{f} <b>{n}</b></em>)}
        </div>
      )}
      <div className="hist-list">
        {data.entries.map((e, i) => (
          <button type="button" key={e.at + i} className={`hist-row qlog-row${sel === i ? " on" : ""}`} onClick={() => setSel(sel === i ? -1 : i)}>
            <span className="d">{e.at.slice(5, 16).replace("T", " ")}</span>
            <span className="t"><i className={`mode ${e.mode}`}>{e.mode}</i> {e.text}</span>
            <span className={`tk${e.flags.length ? " warn" : " ok"}`}>{e.flags.length ? `${e.flags.length} flag${e.flags.length > 1 ? "s" : ""}` : "clean"} · {(e.ms / 1000).toFixed(0)} s</span>
          </button>
        ))}
      </div>
      {cur ? (
        <div className="qlog-turn">
          {(["scout", "risk", "trader", "auditor"] as const).map((r) => {
            const rep = cur.replies.find((x) => x.role === r);
            const flags = cur.flags.filter((f) => flagRole(f) === r);
            return (
              <div key={r} className={`qlog-reply ${r}`}>
                <div className="qlog-h">
                  <b>{r}</b>
                  <span>{rep?.ms ? `${(rep.ms / 1000).toFixed(1)} s` : rep ? "" : "did not run"}</span>
                  {flags.map((f) => <em key={f} title={FLAG_HELP[flagName(f)] ?? f}>{f.replace(/^[a-z]+:/, "")}</em>)}
                  {rep && !flags.length ? <em className="ok">clean</em> : null}
                </div>
                {rep ? <p>{rep.ok && rep.reply ? rep.reply : `no answer${rep.detail ? `: ${rep.detail}` : ""}`}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

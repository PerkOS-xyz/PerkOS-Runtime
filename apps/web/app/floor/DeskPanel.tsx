"use client";

import { useEffect, useState, type ReactNode } from "react";
import AgentCards, { type DeskTurn } from "./AgentCards";
import PriceChart from "./PriceChart";
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
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title><style>body{font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.25}code,pre{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:#f4f4f6;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}small.src{display:block;margin-top:32px;color:#777}</style></head><body>${html}<small class="src">PerkOS · ${new Date().toLocaleString()}</small></body></html>`);
  w.document.close();
  w.focus();
  window.setTimeout(() => { w.print(); }, 300);
}

// Pantallas propias del desk (PerkOS Floor Desk): Market y Portfolio, como en
// EQLTY pero sin vault intermedio (las llaves son de la persona). El template
// declarara `screens[]`; hoy el registro es este componente y el desk es uno.

type Row = { symbol: string; ticker: string; name: string; issuer: string; address: string; priceUsd?: number; priceChange24hPct?: number; volume24hUsd?: number; logoUrl?: string; sparkline?: number[]; pool: { venue?: "uniswap" | "aerodrome"; address: string; fee: number; usdcDepth: number } | null; tradeable: boolean };
const venueName = (v?: string) => (v === "aerodrome" ? "Aerodrome" : "Uniswap V3");
type VenueInfo = { venue: string; label: string; pool: string; feePct: number; usdcDepth: number; url: string };
type Position = { symbol: string; ticker: string; name: string; issuer: string; address?: string; balance: string; valueUsd: number; priceUsd?: number; priceChange24hPct?: number; sparkline?: number[]; sharePct?: number; venue?: VenueInfo | null; otherVenue?: VenueInfo | null; tradeable?: boolean };
const deep = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);

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

export type DeskScreen = "market" | "portfolio" | "launches" | "automations" | "notes" | "map" | "history";
// Launches: los tokens que pagan fees a la wallet conectada (o que desplego la
// wallet Bankr del install), con Bankr, Basescan y Claim.
type LaunchMarket = { priceUsd?: number; change24hPct?: number; change1hPct?: number; volume24hUsd?: number; liquidityUsd?: number; fdvUsd?: number; pool?: { id: string; dex: string; label: string; quote: string; venueUrl: string; dexscreenerUrl: string; geckoUrl: string }; sparkline?: number[]; earnings?: Array<{ date: string; weth: string }>; lifetimeEarnedWeth?: string };
type LaunchRow = { tokenAddress: string; name: string; symbol: string; chain: string; timestamp?: number; status?: string; pair?: string; deployer?: string; deployerX?: string; feeRecipient?: string; mine: boolean; deployedHere: boolean; claimable?: { token0: string; token1: string; token0Label: string; token1Label: string }; claimed?: { token0: string; token1: string; count: number }; share?: string; bankrUrl: string; explorer: string; poolId?: string; market?: LaunchMarket };
const money = (n?: number) => (n === undefined ? "–" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`);
const pct = (n?: number) => (n === undefined ? "" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
/** Barras de ganancias por dia (WETH equivalente segun Bankr). */
function Bars({ points, w = 96, h = 28 }: { points: number[]; w?: number; h?: number }) {
  if (!points.length) return null;
  const max = Math.max(...points) || 1; const bw = w / points.length;
  return (
    <svg className="bars" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {points.map((v, i) => { const bh = Math.max(1, (v / max) * (h - 2)); return <rect key={i} x={(i * bw + 1).toFixed(1)} y={(h - bh).toFixed(1)} width={Math.max(1, bw - 2).toFixed(1)} height={bh.toFixed(1)} rx="1" />; })}
    </svg>
  );
}
// Automations (Bankr): DCA, stop loss y limit que corren en Bankr desde la
// wallet Bankr de la persona. Floor guarda lo que pidio y lo que Bankr contesto.
type AutoRec = { id: string; kind: string; asset?: string; amountUsd?: number; interval?: string; price?: number; text: string; prompt: string; createdAt: string; status: "active" | "paused" | "cancelled"; reply?: string };
type Note = { id: string; desk: string; kind: string; title: string; ticker?: string; body: string; updatedAt: string };
type Hit = { id: string; kind: string; title: string; ticker?: string; updatedAt: string; snippet: string };

const usd = (n?: number, d = 2) => (n === undefined || !Number.isFinite(n) ? "–" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const issuerLabel = (i: string) => (i === "coinbase" ? "Coinbase" : i === "dinari" ? "Dinari" : i === "anchored" ? "Anchored" : i === "st0x" ? "ST0x" : i);

export default function DeskPanel({ screen, focus, onScreen, onClose, onSay, onSummarize, map, max, onMax, refreshKey, claimedTokens }: {
  /** Cambia cuando algo fuera del panel movio los datos (un claim, una orden firmada): recarga la pantalla. */
  refreshKey?: number;
  /** Tokens cuyo claim se acaba de confirmar: Bankr cachea 2 min, asi que aqui se muestran ya sin saldo. */
  claimedTokens?: string[];

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
  const [usdc, setUsdc] = useState<number | undefined>(undefined);
  const [chg24, setChg24] = useState<number | undefined>(undefined);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState<(Note & { path: string }) | null>(null);
  const [nq, setNq] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [autos, setAutos] = useState<AutoRec[] | null>(null);
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);
  const [launchWallet, setLaunchWallet] = useState<string>("");
  const loadLaunches = () => fetch("/api/launches").then((r) => r.json()).then((j) => { if (j.error) { setErr(j.detail ?? j.error); setLaunches([]); } else { setLaunches(j.tokens ?? []); setLaunchWallet(j.wallet ?? ""); } }).catch((e) => setErr(String(e)));
  const [autoRemote, setAutoRemote] = useState<string>("");
  const [autoBusy, setAutoBusy] = useState<string>("");
  const [autoConfigured, setAutoConfigured] = useState(true);
  const loadAutos = (remote = false) => {
    if (remote) setAutoBusy("remote");
    return fetch(`/api/automation${remote ? "?remote=1" : ""}`).then((r) => r.json()).then((j) => { setAutos(j.local ?? []); setAutoConfigured(j.configured !== false); if (j.remote) setAutoRemote(j.remote.text ?? `${j.remote.error ?? ""} ${j.remote.detail ?? ""}`); }).catch((e) => setErr(String(e))).finally(() => setAutoBusy(""));
  };
  const autoAct = async (id: string, action: "pause" | "resume" | "cancel") => {
    setAutoBusy(id);
    try {
      const r = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const j = await r.json();
      if (!r.ok) setErr(j.detail ?? j.error ?? `HTTP ${r.status}`); else { setAutoRemote(j.reply ?? ""); await loadAutos(); }
    } finally { setAutoBusy(""); }
  };
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
    } else if (screen === "map" || screen === "history") {
      // pantallas con su propio componente y su propia carga
    } else if (screen === "launches") {
      void loadLaunches();
    } else if (screen === "automations") {
      setAutoRemote("");
      void loadAutos();
    } else if (screen === "notes") {
      setOpen(null);
      fetch("/api/kb/notes?limit=40").then((r) => r.json()).then((j) => { if (live) setNotes(j.notes ?? []); }).catch((e) => live && setErr(String(e)));
    } else {
      fetch("/api/market/portfolio").then((r) => r.json()).then((j) => { if (!live) return; if (j.error) { setErr(j.detail ?? j.error); setPositions([]); } else { setPositions(j.positions ?? []); setTotal(j.totalUsd ?? 0); setUsdc(typeof j.usdc === "number" ? j.usdc : undefined); setChg24(typeof j.change24hPct === "number" ? j.change24hPct : undefined); } }).catch((e) => live && setErr(String(e)));
    }
    return () => { live = false; };
  }, [screen, refreshKey]);

  const f = focus.toLowerCase();
  const list = (rows ?? []).filter((r) => !q || [r.symbol, r.ticker, r.name].some((v) => v.toLowerCase().includes(q.toLowerCase())));
  const [picked, setPicked] = useState<string>("");
  const isFocus = (r: Row) => Boolean(f && (r.ticker.toLowerCase() === f || r.symbol.toLowerCase() === f || r.name.toLowerCase().includes(f)));
  const detail = (rows ?? []).find((r) => r.address === picked) ?? (rows ?? []).find(isFocus) ?? null;

  // Notes: lista y nota abierta como piezas; maximizado las pone lado a lado (maestro-detalle).
  const noteOpen = open ? (
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
  ) : null;
  const notesList = (
    <ul className="rows notes">
              {(hits ?? notes ?? []).map((n) => (
                <li key={n.id} className={open?.id === n.id ? "focus" : ""}>
                  <button type="button" className="rowbtn" onClick={() => { fetch(`/api/kb/note?id=${encodeURIComponent(n.id)}`).then((r) => r.json()).then((j) => { if (j.body !== undefined) setOpen(j); }).catch(() => undefined); }}>
                    <b>{n.title}</b>
                    <small>{n.kind}{n.ticker ? ` · ${n.ticker}` : ""} · {n.updatedAt.slice(0, 16).replace("T", " ")}</small>
                    {"snippet" in n ? <small className="snip">{(n as Hit).snippet}</small> : null}
                  </button>
                </li>
              ))}
              {!notes && !hits ? <li><div className="cell name"><small>Reading the vault…</small></div></li> : null}
              {notes && notes.length === 0 && !hits ? <li><div className="cell name"><small>Nothing yet. Every turn, analysis and order will be written here.</small></div></li> : null}
            </ul>
  );
  return (
    <aside className={`desk-panel dock ${screen}${max ? " max" : ""}`} aria-label="Desk screens">
      <header>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={screen === "market"} className={screen === "market" ? "on" : ""} onClick={() => onScreen("market")}>Market</button>
          <button type="button" role="tab" aria-selected={screen === "portfolio"} className={screen === "portfolio" ? "on" : ""} onClick={() => onScreen("portfolio")}>Portfolio</button>
          <button type="button" role="tab" aria-selected={screen === "launches"} className={screen === "launches" ? "on" : ""} onClick={() => onScreen("launches")}>Launches</button>
          <button type="button" role="tab" aria-selected={screen === "automations"} className={screen === "automations" ? "on" : ""} onClick={() => onScreen("automations")}>Automations</button>
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
      <div className={`sheet ${screen}`}>

      {screen === "history" ? (
        <History />
      ) : screen === "launches" ? (
        <div className="automations launches">
          <div className="auto-head">
            <small>{err ? `Could not read your tokens: ${err}` : launchWallet ? `Tokens that pay their creator fees to ${launchWallet.slice(0, 6)}…${launchWallet.slice(-4)}, the wallet connected here. Say: launch Night Owl (OWL) paired with NVDA.` : "Connect a wallet to see your tokens."}</small>
            <div className="acts">
              <button type="button" onClick={() => void loadLaunches()}>Refresh</button>
              <button type="button" onClick={() => onSay("claim my fees")}>Claim all</button>
            </div>
          </div>
          <ul className="launch-cards">
            {(launches ?? []).map((l) => {
              const justClaimed = (claimedTokens ?? []).includes(l.tokenAddress.toLowerCase());
              const fee = !justClaimed && l.claimable && (Number(l.claimable.token0) > 0 || Number(l.claimable.token1) > 0);
              const fmt = (v: string) => { const n = Number(v) || 0; return n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); };
              const m = l.market; const pool = m?.pool; const indexed = Boolean(m?.priceUsd !== undefined);
              const up24 = (m?.change24hPct ?? 0) >= 0; const up1 = (m?.change1hPct ?? 0) >= 0;
              const earn = (m?.earnings ?? []).slice(-14).map((e) => Number(e.weth) || 0);
              const when = l.timestamp ? new Date(l.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
              return (
                <li key={l.tokenAddress} className="launch-card">
                  <div className="lc-head">
                    <div className="lc-id">
                      <b title={l.name}>{l.name}</b>
                      <i className="sym">{l.symbol}</i>
                      <small>paired with {l.pair ?? "WETH"} · {l.deployerX ? `deployed by @${l.deployerX}` : l.deployedHere ? "deployed from this install" : `deployed by ${l.deployer ? `${l.deployer.slice(0, 6)}…${l.deployer.slice(-4)}` : "?"}`}{when ? ` · ${when}` : ""}</small>
                    </div>
                    <span className="lc-right"><em className={`st ${fee ? "active" : ""}`}>{justClaimed ? "claimed" : fee ? "fees to claim" : l.status ?? "live"}</em><CopyAddr address={l.tokenAddress} label={`${l.symbol} token`} /></span>
                  </div>
                  {indexed ? <PriceChart points={m?.sparkline} label="24h · 15m closes" /> : (
                    <div className="pc empty"><span>Not indexed yet</span><small>DexScreener usually picks up a new pool within a few minutes</small></div>
                  )}
                  <div className="kpis6">
                    <span><b>{indexed ? money(m!.priceUsd) : "–"}</b><small>price</small></span>
                    <span><b className={indexed && m?.change1hPct !== undefined ? (up1 ? "up" : "down") : ""}>{indexed ? pct(m?.change1hPct) || "–" : "–"}</b><small>1h</small></span>
                    <span><b className={indexed && m?.change24hPct !== undefined ? (up24 ? "up" : "down") : ""}>{indexed ? pct(m?.change24hPct) || "–" : "–"}</b><small>24h</small></span>
                    <span><b>{indexed ? money(m?.volume24hUsd) : "–"}</b><small>volume 24h</small></span>
                    <span><b>{indexed ? money(m?.liquidityUsd) : "–"}</b><small>liquidity</small></span>
                    <span><b>{indexed ? money(m?.fdvUsd) : "–"}</b><small>FDV</small></span>
                  </div>
                  <div className="launch-body">
                    <div className="launch-pool">
                      <small className="k">Pool</small>
                      <span>{pool ? `${pool.label} on Base · ${l.symbol} / ${pool.quote || l.pair || "WETH"}` : `Uniswap V4 on Base · ${l.symbol} / ${l.pair ?? "WETH"}`}</span>
                      <small className="mono">{(pool?.id ?? l.poolId) ? `${(pool?.id ?? l.poolId)!.slice(0, 12)}…${(pool?.id ?? l.poolId)!.slice(-6)}` : "pool id pending"}</small>
                      <small>Doppler, deployed by Bankr · 0.7% pool fee, 95% to the creator{pool ? "" : " · not indexed yet"}</small>
                    </div>
                    <nav className="launch-links" aria-label="Open in">
                      {pool ? <a href={pool.venueUrl} target="_blank" rel="noreferrer">Uniswap ↗</a> : null}
                      {pool ? <a href={pool.dexscreenerUrl} target="_blank" rel="noreferrer">DexScreener ↗</a> : null}
                      <a href={l.bankrUrl} target="_blank" rel="noreferrer">Bankr ↗</a>
                      <a href={l.explorer} target="_blank" rel="noreferrer">Basescan ↗</a>
                      <a className="share" href={shareLaunchUrl(l)} target="_blank" rel="noreferrer" title="Opens X in your browser with a post about this launch. Nothing is posted until you press Post.">Share on X</a>
                    </nav>
                    <div className="launch-fees">
                      <small className="k">Creator fees{l.share ? ` · ${l.share} of the pool fee` : ""}</small>
                      <span>{justClaimed ? "Claimed just now. New fees keep accruing." : l.claimable ? (fee ? `${fmt(l.claimable.token0)} ${l.claimable.token0Label} + ${fmt(l.claimable.token1)} ${l.claimable.token1Label} to claim` : "Fees accrue to the recipient. Nothing to claim yet.") : "Fees accrue to the recipient."}</span>
                      <small>{l.claimed && l.claimed.count > 0 ? `claimed ${l.claimed.count}× · ${fmt(l.claimed.token0)} ${l.claimable?.token0Label ?? ""} + ${fmt(l.claimed.token1)} ${l.claimable?.token1Label ?? ""}` : "no claims yet"}{m?.lifetimeEarnedWeth && Number(m.lifetimeEarnedWeth) > 0 ? ` · ${fmt(m.lifetimeEarnedWeth)} WETH lifetime` : ""}</small>
                      {earn.some((v) => v > 0) ? <Bars points={earn} w={160} h={26} /> : null}
                      {l.mine ? <button type="button" className="claim" disabled={!fee} onClick={() => onSay(`claim fees for ${l.tokenAddress}`)}>{justClaimed ? "Claimed" : fee ? "Claim fees" : "Nothing to claim"}</button> : null}
                    </div>
                  </div>
                </li>
              );
            })}
            {launches && launches.length === 0 ? <li className="launch-empty"><b>No tokens yet.</b><span>Launch one paired with a tokenized stock and it shows up here with its chart and fees.</span><button type="button" onClick={() => onSay("launch Night Owl (OWL) paired with NVDA")}>Launch a token</button></li> : null}
            {!launches ? <li className="launch-empty"><span>Reading Bankr…</span></li> : null}
          </ul>
        </div>
      ) : screen === "automations" ? (
        <div className="automations">
          <div className="auto-head">
            <small>{autoConfigured ? "Rules that run in Bankr from your Bankr wallet. Say: dca $5 into NVDA every week, or stop loss on TSLA at 380." : "Add a Bankr API key in Settings to create automations."}</small>
            <div className="acts">
              <button type="button" disabled={autoBusy === "remote" || !autoConfigured} onClick={() => void loadAutos(true)}>{autoBusy === "remote" ? "Asking Bankr…" : "Ask Bankr"}</button>
              <button type="button" onClick={() => onSay("dca $5 into NVDA every week")}>New DCA</button>
            </div>
          </div>
          {autoRemote ? <pre className="auto-remote">{autoRemote}</pre> : null}
          <ul className="rows autos">
            {(autos ?? []).map((a) => (
              <li key={a.id} className={a.status}>
                <div className="cell name">
                  <b>{a.kind === "dca" ? "DCA" : a.kind === "stop" ? "Stop loss" : a.kind === "limit" ? "Limit buy" : "Schedule"} {a.asset ?? ""}</b>
                  <small>{a.prompt}</small>
                  {a.reply ? <small className="snip">{a.reply.slice(0, 160)}</small> : null}
                </div>
                <em className={`st ${a.status}`}>{a.status}</em>
                <small>{a.createdAt.slice(0, 16).replace("T", " ")}</small>
                <div className="acts">
                  {a.status === "active" ? <button type="button" disabled={autoBusy === a.id} onClick={() => void autoAct(a.id, "pause")}>Pause</button> : null}
                  {a.status === "paused" ? <button type="button" disabled={autoBusy === a.id} onClick={() => void autoAct(a.id, "resume")}>Resume</button> : null}
                  {a.status !== "cancelled" ? <button type="button" disabled={autoBusy === a.id} onClick={() => void autoAct(a.id, "cancel")}>Cancel</button> : null}
                </div>
              </li>
            ))}
            {autos && autos.length === 0 ? <li><div className="cell name"><small>No automations yet. The first one you create here will be listed, with what Bankr answered.</small></div></li> : null}
            {!autos ? <li><div className="cell name"><small>Reading…</small></div></li> : null}
          </ul>
        </div>
      ) : screen === "map" ? (
        <>
          <p className="hint-line">The desk as a graph: you sign, Sparky speaks, the team hands off, the world is what they look at. Click a node.</p>
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
          <p className="hint-line">What this desk remembers: journal, analyses, orders and memory. Local Markdown in ~/.perkos-xyz/knowledge, Obsidian-compatible.</p>
          <div className="notes-bar">
            <input className="search" value={nq} placeholder="Search the desk's notes (meaning, not just words)…" onChange={(e) => { const v = e.target.value; setNq(v); if (v.trim().length < 2) { setHits(null); return; } fetch(`/api/kb/search?q=${encodeURIComponent(v)}`).then((r) => r.json()).then((j) => setHits(j.hits ?? [])).catch(() => setHits([])); }} />
            {onSummarize ? <button type="button" onClick={onSummarize} title="Summarize today's journal into memory.md">Summarize today</button> : null}
            <button type="button" onClick={() => { fetch("/api/kb/notes?kind=memory").then((r) => r.json()).then((j) => { const m = (j.notes ?? [])[0]; if (m) fetch(`/api/kb/note?id=${encodeURIComponent(m.id)}`).then((r2) => r2.json()).then((n) => { if (n.body !== undefined) { setOpen(n); setEditing(false); } }); }); }} title="The desk's stable memory (editable)">Memory</button>
          </div>
          {err ? <p className="hint-line err">{err}</p> : null}
          {max ? (
            <div className="md-split">{notesList}{noteOpen ?? <div className="note-open empty"><p className="hint">Pick a note to read it here.</p></div>}</div>
          ) : open ? noteOpen : notesList}
        </>
      ) : (
        <>
          <p className="hint-line">Your tokenized stocks on Base, in your wallet, and where each one trades.</p>
          {err ? <p className="hint-line err">{err}</p> : null}
          <div className="kpi k4">
            <div><b>{positions ? usd(total + (usdc ?? 0)) : "…"}</b><small>value</small></div>
            <div><b>{usdc === undefined ? "…" : usd(usdc)}</b><small>USDC on Base</small></div>
            <div><b>{positions ? positions.length : "…"}</b><small>positions</small></div>
            <div><b className={chg24 === undefined ? "" : chg24 >= 0 ? "up" : "down"}>{chg24 === undefined ? "–" : `${chg24 > 0 ? "+" : ""}${chg24.toFixed(2)}%`}</b><small>24h</small></div>
          </div>
          {positions && positions.length === 0 ? (
            <div className="empty">
              <b>No tokenized stocks yet</b>
              <span>The desk drafts, you sign. Start small.</span>
              <button type="button" onClick={() => onSay("buy $5 of NVDAc")}>Try "buy $5 of NVDAc"</button>
            </div>
          ) : null}
          {positions && positions.length ? <p className="hint-line draft-note">These buttons draft an order. Risk reviews it, you hold to approve, then you sign in your wallet. Nothing sells until then.</p> : null}
          <ul className="rows positions">
            <li className="head" aria-hidden="true">
              <div className="cell name"><small>Position · issuer</small></div>
              <div className="cell venue"><small>Trades on</small></div>
              <div className="cell chart"><small>24h</small></div>
              <div className="cell num"><small>Shares</small></div>
              <div className="cell num"><small>Value · price</small></div>
              <div className="cell acts"><small>Actions</small></div>
            </li>
            {!positions ? [0, 1, 2].map((i) => (
              <li key={`sk-${i}`} className="skeleton" aria-hidden="true">
                <div className="cell name"><i /></div><div className="cell venue"><i /></div><div className="cell chart"><i /></div><div className="cell num"><i /></div><div className="cell num"><i /></div><div className="cell acts"><i /></div>
              </li>
            )) : null}
            {(positions ?? []).map((p) => {
              const ok = p.tradeable !== false;
              const tip = ok ? "Drafts an order for the team to review. You approve and sign before anything sells." : "Pool too thin to trade safely right now.";
              return (
                <li key={p.symbol + p.issuer} className={ok ? "" : "thin"}>
                  <div className="cell name">
                    <b>{p.symbol}</b>
                    <small>{p.name} · {issuerLabel(p.issuer)}{p.sharePct !== undefined && (positions?.length ?? 0) > 1 ? ` · ${p.sharePct.toFixed(0)}% of portfolio` : ""}</small>
                    <CopyAddr address={p.address} label={`${p.symbol} token`} />
                  </div>
                  <div className="cell venue">
                    {p.venue ? (
                      <>
                        <b>{p.venue.label} <i>· {p.venue.feePct}% fee</i></b>
                        <small><a href={p.venue.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{deep(p.venue.usdcDepth)} USDC deep ↗</a></small>
                        {p.otherVenue ? <small className="also">also {p.otherVenue.label} · {deep(p.otherVenue.usdcDepth)} deep</small> : null}
                      </>
                    ) : <small>no USDC pool found</small>}
                  </div>
                  <div className="cell chart"><Spark points={p.sparkline} /></div>
                  <div className="cell num shares">
                    <b>{p.balance}</b>
                    <small>shares</small>
                  </div>
                  <div className="cell num value">
                    <b>{usd(p.valueUsd)}</b>
                    <small>@ {usd(p.priceUsd)}{p.priceChange24hPct !== undefined ? <em className={p.priceChange24hPct >= 0 ? "up" : "down"}> {p.priceChange24hPct > 0 ? "+" : ""}{p.priceChange24hPct.toFixed(2)}%</em> : null}</small>
                  </div>
                  <div className="cell acts">
                    <button type="button" disabled={!ok} title={tip} onClick={() => onSay(`sell half of my ${p.symbol}`)}><PencilIcon />Draft: sell half</button>
                    <button type="button" disabled={!ok} title={tip} onClick={() => onSay(`sell all of my ${p.symbol}`)}><PencilIcon />Draft: sell all</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      </div>
    </aside>
  );
}


/** Post para X sobre un launch: el token, el par, y que lo desplego PerkOS (@perk_os) por Bankr. */
export function shareLaunchUrl(l: { name: string; symbol: string; pair?: string; tokenAddress: string }): string {
  const pair = (l.pair ?? "WETH").replace(/c$/, "");
  const text = [
    `$${l.symbol} (${l.name}) is live on Base, paired with tokenized $${pair}.`,
    `My desk of agents drafted it, I approved it, and @perk_os deployed it through @bankrbot.`,
    `CA: ${l.tokenAddress}`
  ].join("\n\n");
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`https://bankr.bot/launches/${l.tokenAddress}`)}`;
}

/** Direccion corta con boton de copiar (contrato del token, pool). Si el
 *  portapapeles no esta disponible, muestra la direccion completa y seleccionable. */
function CopyAddr({ address, label = "contract" }: { address?: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "manual">("idle");
  if (!address) return null;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = () => { setState("done"); window.setTimeout(() => setState("idle"), 1500); };
    const manual = () => { setState("manual"); window.setTimeout(() => setState("idle"), 8000); };
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = address; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(ta);
        if (copied) ok(); else manual();
      } catch { manual(); }
    };
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(address).then(ok).catch(fallback); else fallback();
  };
  if (state === "manual") return <code className="copy-addr manual" style={{ textTransform: "none", letterSpacing: 0 }} title="Select and copy">{address}</code>;
  return (
    <button type="button" className={`copy-addr${state === "done" ? " done" : ""}`} style={{ textTransform: "none", letterSpacing: 0, whiteSpace: "nowrap" }} onClick={copy} title={`Copy the ${label} address: ${address}`} aria-label={`Copy the ${label} address`}>
      {state === "done" ? "Copied" : `${address.slice(0, 6)}…${address.slice(-4)}`}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{state === "done" ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}</svg>
    </button>
  );
}

function PencilIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>;
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
      {view === "log" ? null : <div className="hist-body"><div className="hist-left">
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
      </div><div className="hist-right">
      {busy ? <p className="hint">Reading the run…</p> : null}
      {!busy && !run ? <p className="hint dim">Pick a decision to replay it here.</p> : null}
      {run ? (
        <div className="hist-run">
          <div className="hist-meta">{run.verdict ? <em className={`vchip ${run.verdict.toLowerCase()}`}>{run.verdict}</em> : null} {run.endedAt && run.startedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)} s` : ""} {run.receipt?.hash ? `· signed ${run.receipt.hash.slice(0, 10)}…` : "· unsigned"}</div>
          <AgentCards turn={{ ...run, collapsed: false, live: false }} mode="replay" />
          <div className="hist-who">
            {(["scout", "risk", "trader", "auditor"] as const).map((r) => run.agents[r]?.text ? <p key={r}><b>{r}</b> {run.agents[r].text}</p> : null)}
          </div>
        </div>
      ) : null}
      </div></div>}
    </div>
  );
}

/** Quality: el log de turnos de la mesa (~/.perkos-xyz/logs) con las
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

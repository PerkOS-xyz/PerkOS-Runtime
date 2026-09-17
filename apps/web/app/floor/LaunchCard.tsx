"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shareLaunchUrl } from "./DeskPanel";

// Tarjeta guiada para lanzar un token emparejado con una accion tokenizada (Bankr, Base).
// Una sola tarjeta en el chat que se completa por bloques: Basics (nombre, simbolo, par,
// destinatario de fees), Profile (logo, about, web, post en X), Advanced (vesting, fees,
// degen), Checks + simulacion, y Hold to launch. Nada se despliega sin el hold.
// La tarjeta aparece al instante; el turno de mesa llega despues, sin retenerla.

export type LaunchEdit = {
  name?: string; symbol?: string; pair?: string; recipient?: string;
  vesting?: "on" | "off"; feesIn?: "both" | "quote"; degen?: boolean;
  description?: string; image?: string; websiteUrl?: string; tweetUrl?: string;
};
export type LaunchView = {
  name: string; symbol: string; description?: string;
  pair: { address: string; symbol: string; name: string; kind?: string; illiquid?: boolean };
  recipient: { type: string; value: string }; recipientLabel: string; resolvedRecipient?: string; feeRecipient: string; ownRecipient: boolean;
  options: { vesting: "on" | "off"; feesIn: "both" | "quote"; degen: boolean; description?: string; image?: string; websiteUrl?: string; tweetUrl?: string };
  deployer: string | null; ownKey: boolean;
  checks: Array<{ label: string; ok: boolean; note: string }>; ready: boolean;
  sim: { tokenAddress: string; poolId: string } | null; simError?: string;
  wallet: { evm: string; ethBase: number; club: boolean } | null; last24h: number;
  receipt?: { tokenAddress: string; poolId: string; txHash: string; explorer: string; bankrUrl: string };
  // Solo cliente
  recipientRaw?: string; stale?: boolean; busy?: boolean; fromStarter?: boolean; turnDone?: boolean;
};
export type LaunchTx = { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
type PairOption = { address: string; symbol: string; name: string; illiquid?: boolean };

// Lista de pares de Bankr (acciones tokenizadas); WETH y BNKR fijos arriba. Cache por ventana.
let pairCache: PairOption[] | null = null;
const PINNED: PairOption[] = [{ address: "", symbol: "WETH", name: "Wrapped Ether, the default quote" }, { address: "", symbol: "BNKR", name: "Bankr" }];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// El logo del laptop: se reduce a 512 px (cuadrado, centrado) y se sube via /api/launch/logo,
// que lo aloja en PerkOS (Firebase Storage) y devuelve la URL publica que Bankr exige.
async function squareDataUrl(file: File, size = 512): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}
const httpsOk = (v?: string) => !v || /^https:\/\/[^\s]+$/i.test(v);

export default function LaunchCard({ launch, tx, onLaunch, onFees, onEdit, onResim, wallet, pairWarning }: {
  launch: LaunchView;
  tx: LaunchTx;
  /** Wallet conectada: es quien cobra las fees salvo que la persona nombre a otro. */
  wallet?: string;
  /** Aviso sobre el par elegido (fino, o el desk dijo evitarlo): el token puede quedar sin indexar hasta el primer swap. */
  pairWarning?: string;
  onLaunch: () => void;
  onFees?: () => void;
  /** Cualquier edicion; el padre decide si hay que volver a simular. */
  onEdit?: (patch: LaunchEdit) => void;
  /** Volver a simular ahora (sin esperar el debounce). */
  onResim?: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const editable = Boolean(onEdit) && (tx.stage === "idle" || tx.stage === "failed" || tx.stage === "blocked");
  const basicsOk = Boolean(launch.name.trim() && launch.symbol.trim() && launch.pair.symbol);
  const armed = (tx.stage === "idle" || tx.stage === "failed") && launch.ready && basicsOk && !launch.stale && !launch.busy;
  const canResim = Boolean(onResim) && (tx.stage === "idle" || tx.stage === "failed" || tx.stage === "blocked") && basicsOk && !launch.busy && (launch.stale || (!launch.ready && !launch.sim));
  const [showBasics, setShowBasics] = useState(!basicsOk);
  const [showAdv, setShowAdv] = useState(false);
  const [open, setOpen] = useState(false);
  // Maximizar: la tarjeta pasa a una capa amplia sobre la escena para escribir comodo (prompt, About).
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMax(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [max]);
  const [pairs, setPairs] = useState<PairOption[]>(pairCache ?? []);
  const [pairQ, setPairQ] = useState("");
  useEffect(() => {
    if (pairCache || !editable) return;
    fetch("/api/launch/quotes").then((r) => r.json()).then((j: { stocks?: PairOption[] }) => { pairCache = j.stocks ?? []; setPairs(pairCache); }).catch(() => undefined);
  }, [editable]);

  const start = () => { if (!armed) return; setHolding(true); holdRef.current = window.setTimeout(() => { setHolding(false); onLaunch(); }, 2000); };
  const cancel = () => { window.clearTimeout(holdRef.current); setHolding(false); };

  const image = launch.options.image ?? "", website = launch.options.websiteUrl ?? "", tweet = launch.options.tweetUrl ?? "", about = launch.options.description ?? launch.description ?? "";
  const profileOk = Boolean(image) && Boolean(about);
  const recipientRaw = launch.recipientRaw ?? (launch.ownRecipient ? "" : launch.recipient.value);
  const decision = tx.stage === "blocked" ? "Wait" : tx.stage === "done" ? "Live" : tx.stage === "pending" ? "Deploying" : tx.stage === "failed" ? "Not deployed" : !basicsOk ? "Draft" : launch.busy ? "Checking" : launch.stale ? "Recheck" : launch.ready ? "Launch" : "Fix";
  const tone = tx.stage === "blocked" || (!launch.ready && basicsOk && !launch.busy && !launch.stale) ? "wait" : tx.stage === "done" ? "done" : basicsOk && launch.ready && !launch.stale && !launch.busy ? "go" : "wait";
  const label = tx.stage === "done" ? "Live" : tx.stage === "blocked" ? "Blocked" : tx.stage === "pending" ? "Deploying on Base…" : tx.stage === "failed" ? "Retry" : !basicsOk ? "Add a name, a symbol and a pair" : launch.busy ? "Simulating…" : launch.stale ? "Simulate now" : launch.ready ? (holding ? "Keep holding…" : "Hold to launch") : launch.sim ? "Fix the checks first" : "Simulate now";
  const [uploading, setUploading] = useState<"" | "busy" | string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadLogo = async (file: File) => {
    setUploading("busy");
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Pick a PNG, JPG, WebP or GIF");
      const data = await squareDataUrl(file);
      const r = await fetch("/api/launch/logo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      const j = (await r.json().catch(() => ({}))) as { url?: string; detail?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.detail ?? j.error ?? `upload ${r.status}`);
      onEdit?.({ image: j.url });
      setUploading("");
    } catch (e) { setUploading((e as Error).message); }
  };
  // Logo con IA: Grok genera la imagen desde un prompt propuesto (nombre + About), editable.
  const [genOpen, setGenOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [gen, setGen] = useState<"" | "busy" | string>("");
  const suggestedPrompt = () => `Logo for ${launch.name || "a new token"}${launch.symbol ? ` (${launch.symbol})` : ""}${about ? `: ${about}` : ""}. Coral and black on a dark background`;
  const generateLogo = async () => {
    const prompt = (genPrompt.trim() || suggestedPrompt()).slice(0, 600);
    setGen("busy");
    try {
      const r = await fetch("/api/launch/logo/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const j = (await r.json().catch(() => ({}))) as { url?: string; detail?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.detail ?? j.error ?? `generate ${r.status}`);
      onEdit?.({ image: j.url });
      setGen("");
      setGenOpen(false); // el logo ya esta: el prompt se pliega; "Edit prompt" lo reabre para redibujar
    } catch (e) { setGen((e as Error).message); }
  };
  const q = pairQ.trim().toLowerCase();
  const list = [...PINNED, ...pairs].filter((p) => !q || p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const pick = (sym: string) => { onEdit?.({ pair: sym }); setPairQ(""); };

  const card = (
    <div className={`draft-card launch st-${tx.stage}${open ? " open" : ""}${max ? " max" : ""}`}>
      <div className="draft-head">
        <b><span className={`decision ${tone}`}>{decision}</span> {launch.name || "New token"}{launch.symbol ? ` (${launch.symbol})` : ""} <small>{launch.pair.symbol ? `paired with ${launch.pair.symbol} on Base` : "pick a pair"} · Bankr</small></b>
        <span className="draft-btns">
          {tx.stage === "done" && launch.receipt ? <a className="draft-more share" href={shareLaunchUrl({ name: launch.name, symbol: launch.symbol, pair: launch.pair.symbol, tokenAddress: launch.receipt.tokenAddress })} target="_blank" rel="noreferrer" title="Post it on X">Share</a> : null}
          {tx.stage === "done" && onFees ? <button type="button" className="draft-more" onClick={onFees}>Fees</button> : null}
          {editable && basicsOk ? <button type="button" className="draft-more" onClick={() => setShowBasics((v) => !v)}>{showBasics ? "Done" : "Edit"}</button> : null}
          <button type="button" className="draft-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Less" : "Details"}</button>
          <button type="button" className="draft-more" onClick={() => setMax((v) => !v)} title={max ? "Back to the chat (Esc)" : "Open the card large to write comfortably"} aria-label={max ? "Collapse" : "Expand"}>{max ? "Close" : "Expand"}</button>
        </span>
      </div>

      {/* Quien cobra: siempre visible, no solo en Basics o en Details. */}
      <p className="lc-fees">
        <span>Fees pay to</span>
        {launch.recipientRaw?.trim() && !launch.ownRecipient
          ? <b>{launch.recipientLabel || launch.recipientRaw}{launch.resolvedRecipient ? <small> · {short(launch.resolvedRecipient)}</small> : null}</b>
          : launch.recipientRaw?.trim()
            ? <b>{launch.recipientRaw}</b>
            : <b>your connected wallet{wallet || launch.feeRecipient ? <small> · {short(launch.feeRecipient || wallet || "")}</small> : null}</b>}
        <small>95% of the pool fee, 5% to Bankr</small>
        {editable && !showBasics ? <button type="button" className="lc-link" onClick={() => setShowBasics(true)}>Change</button> : null}
      </p>
      {(pairWarning || launch.pair.illiquid) && tx.stage !== "done" ? (
        <p className="lc-warn"><b>Thin pair.</b> {pairWarning ?? `Bankr flags ${launch.pair.symbol} as illiquid.`} Until someone makes the first swap, DexScreener will not list the token and it will look inactive. {editable ? "Consider one of the desk's picks." : ""}</p>
      ) : null}
      {editable && showBasics ? (
        <div className="lc-basics">
          <div className="lc-two">
            <label><span>Name</span><input value={launch.name} maxLength={40} placeholder="Night Owl" onChange={(e) => onEdit?.({ name: e.target.value })} /></label>
            <label><span>Symbol</span><input value={launch.symbol} maxLength={8} placeholder="OWL" onChange={(e) => onEdit?.({ symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></label>
          </div>
          <div className="lc-pairs">
            <div className="lc-pairs-head"><span>Pair</span><small>{launch.symbol || "The token"} trades against this. Tokenized stocks are Coinbase B20 on Base.</small></div>
            <input className="lc-search" value={pairQ} placeholder="Search a stock or symbol…" onChange={(e) => setPairQ(e.target.value)} />
            <div className="lc-chips" role="listbox" aria-label="Pair">
              {list.map((p) => (
                <button type="button" key={p.symbol} role="option" aria-selected={launch.pair.symbol.toLowerCase() === p.symbol.toLowerCase()} className={`lc-chip${launch.pair.symbol.toLowerCase() === p.symbol.toLowerCase() ? " on" : ""}${p.illiquid ? " thin" : ""}`} onClick={() => pick(p.symbol)} title={p.name}>
                  <b>{p.symbol}</b><small>{p.illiquid ? "low liquidity" : p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name}</small>
                </button>
              ))}
              {!list.length ? <span className="lc-none">{pairs.length ? "No match" : "Loading Bankr's list…"}</span> : null}
            </div>
          </div>
          <label className="lc-recipient"><span>Fees pay to</span><input value={recipientRaw} placeholder="Your connected wallet. Or @handle, name.eth, farcaster:name, 0x…" onChange={(e) => onEdit?.({ recipient: e.target.value })} /></label>
        </div>
      ) : null}

      {editable ? (
        <div className="lc-profile">
          <button type="button" className="lc-logo" onClick={() => fileRef.current?.click()} title="Choose a logo from this computer">
            {httpsOk(image) && image ? <img src={image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }} /> : <span className="lc-logo-empty">{uploading === "busy" ? "…" : "+ logo"}</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
          <div className="lc-fields">
            <label><span>Logo</span>
              <div className="lc-logo-row">
                <button type="button" className="lc-pick" onClick={() => fileRef.current?.click()} disabled={uploading === "busy" || gen === "busy"}>{uploading === "busy" ? "Uploading…" : image ? "Change file" : "Choose file"}</button>
                <button type="button" className="lc-pick ai" onClick={() => { if (!genOpen && !genPrompt) setGenPrompt(suggestedPrompt()); setGenOpen((v) => !v); }} disabled={gen === "busy"}>{gen === "busy" ? "Drawing…" : genOpen ? "Hide prompt" : genPrompt && image ? "Edit prompt" : "Generate with AI"}</button>
                <input type="url" placeholder="or paste an https:// image URL" value={image} onChange={(e) => onEdit?.({ image: e.target.value.trim() })} className={httpsOk(image) ? "" : "bad"} />
              </div>
              {genOpen ? (
                <div className="lc-gen">
                  <textarea rows={4} maxLength={600} value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} placeholder="Describe the logo in one line" />
                  <div className="lc-gen-acts">
                    <button type="button" className="lc-pick ai" onClick={() => void generateLogo()} disabled={gen === "busy"}>{gen === "busy" ? "Drawing with Grok…" : image ? "Draw again" : "Draw it"}</button>
                    <small>Grok draws it, PerkOS hosts it, Bankr shows it. About 10 seconds.</small>
                  </div>
                </div>
              ) : null}
              {uploading && uploading !== "busy" ? <em className="lc-err">{uploading}</em> : null}
              {gen && gen !== "busy" ? <em className="lc-err">{gen}</em> : null}
            </label>
            <label><span>About</span><textarea rows={4} maxLength={500} placeholder="One or two lines: what the token is for" value={about} onChange={(e) => onEdit?.({ description: e.target.value })} /></label>
          </div>
        </div>
      ) : null}

      {editable ? (
        <div className="lc-adv">
          <button type="button" className="lc-adv-toggle" onClick={() => setShowAdv((v) => !v)} aria-expanded={showAdv}>Advanced (optional) · vesting {launch.options.vesting} · fees in {launch.options.feesIn === "quote" ? "quote only" : "both"}{launch.options.degen ? " · degen" : ""}</button>
          {showAdv ? (
            <div className="lc-adv-body">
              <button type="button" className={`lc-opt${launch.options.vesting === "on" ? " on" : ""}`} onClick={() => onEdit?.({ vesting: launch.options.vesting === "on" ? "off" : "on" })}><b>Vesting</b><small>{launch.options.vesting === "on" ? "15% of supply to the fee recipient over one year, 30 day cliff" : "off: 100% of supply goes to the pool"}</small></button>
              <button type="button" className={`lc-opt${launch.options.feesIn === "quote" ? " on" : ""}`} onClick={() => onEdit?.({ feesIn: launch.options.feesIn === "quote" ? "both" : "quote" })}><b>Fees in quote only</b><small>{launch.options.feesIn === "quote" ? "fees paid in the pair token only" : "fees paid in the token and the pair"}</small></button>
              <button type="button" className={`lc-opt${launch.options.degen ? " on" : ""}`} onClick={() => onEdit?.({ degen: !launch.options.degen })}><b>Degen mode</b><small>{launch.options.degen ? "$2,500 starting cap, faster curve" : "standard curve"}</small></button>
              <div className="lc-two">
                <label className="lc-field"><span>Website (optional)</span><input type="url" placeholder="https://…" value={website} onChange={(e) => onEdit?.({ websiteUrl: e.target.value.trim() })} className={httpsOk(website) ? "" : "bad"} /></label>
                <label className="lc-field"><span>Announcement post on X (optional)</span><input type="url" placeholder="https://x.com/…/status/… (Bankr shows it as the launch announcement)" value={tweet} onChange={(e) => onEdit?.({ tweetUrl: e.target.value.trim() })} className={httpsOk(tweet) ? "" : "bad"} /></label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="launch-checks">
        {launch.checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "bad"}><i aria-hidden>{c.ok ? "✓" : "✕"}</i><span>{c.label}</span><small>{c.note}</small></li>)}
        <li className={profileOk ? "ok" : "skip"}><i aria-hidden>{profileOk ? "✓" : "·"}</i><span>Token profile</span><small>{profileOk ? "logo and description set" : "logo or description missing: Bankr and the screeners show them (not blocking)"}</small></li>
        <li className={launch.busy ? "skip" : launch.stale ? "skip" : launch.sim ? "ok" : launch.simError ? "bad" : "skip"}><i aria-hidden>{launch.busy ? "…" : launch.stale ? "·" : launch.sim ? "✓" : launch.simError ? "✕" : "·"}</i><span>Bankr simulation</span><small>{launch.busy ? "running…" : launch.stale ? (basicsOk ? "changed, simulating again in a moment" : "waiting for name, symbol and pair") : launch.sim ? `token ${short(launch.sim.tokenAddress)} · pool ${short(launch.sim.poolId)}` : launch.simError ?? "not run"}{launch.last24h ? ` · launch ${launch.last24h} of 3 today` : ""}</small></li>
      </ul>

      {open ? <dl className="draft-rows">
        <dt>Pair</dt><dd>{launch.pair.name || launch.pair.symbol} <small>({launch.pair.symbol}{launch.pair.kind === "stock" ? " · Coinbase B20 on Base" : launch.pair.kind === "major" ? " · the default quote" : ""})</small></dd>
        <dt>Pool</dt><dd>Uniswap V4 via Doppler, deployed by Bankr <small>(gas sponsored on Base{launch.options.degen ? " · degen mode, $2,500 starting cap" : ""})</small></dd>
        <dt>Fees pay to</dt><dd>{launch.ownRecipient ? (launch.feeRecipient ? short(launch.feeRecipient) : "your wallet") : launch.recipientLabel}{launch.resolvedRecipient && !launch.ownRecipient ? <small> (Bankr resolved it to {short(launch.resolvedRecipient)})</small> : null}</dd>
        <dt>Split</dt><dd>95% of the pool fee to the recipient · 5% to Bankr · fees in {launch.options.feesIn === "quote" ? "the quote token only" : "the token and the quote"}</dd>
        <dt>Vesting</dt><dd>{launch.options.vesting === "on" ? "15% of supply to the fee recipient over one year, 30 day cliff" : "off: 100% of supply goes to the pool"}</dd>
        <dt>Deployer</dt><dd>{launch.deployer ? short(launch.deployer) : "no Bankr wallet"} <small>{launch.ownKey ? "(your Bankr wallet)" : "(Bankr wallet on this install: it keeps nothing)"}</small></dd>
        {about ? <><dt>About</dt><dd>{about}</dd></> : null}
        {website || tweet ? <><dt>Links</dt><dd>{website ? <a href={website} target="_blank" rel="noreferrer">website</a> : null}{website && tweet ? " · " : ""}{tweet ? <a href={tweet} target="_blank" rel="noreferrer">X post</a> : null}</dd></> : null}
        {launch.receipt ? <><dt>Token</dt><dd><a href={`https://basescan.org/token/${launch.receipt.tokenAddress}`} target="_blank" rel="noreferrer">{short(launch.receipt.tokenAddress)}</a> · <a href={launch.receipt.bankrUrl} target="_blank" rel="noreferrer">on Bankr</a> · <a href={launch.receipt.explorer} target="_blank" rel="noreferrer">tx</a></dd></> : null}
      </dl> : null}
      {tx.note ? <p className="hint-line err">{tx.note}</p> : null}
      {tx.hashes.length ? (
        <ul className="draft-tx">
          {tx.hashes.map((h) => (
            <li key={h.hash} className={h.status}>
              <span>{h.label}</span>
              <a href={h.explorer} target="_blank" rel="noreferrer">{h.hash.slice(0, 10)}…{h.hash.slice(-6)}</a>
              <em>{h.status === "success" ? "confirmed" : "pending"}</em>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="draft-actions">
        {/* Con la simulacion pendiente el boton queda activo como "simular ahora" (clic); solo con todo en verde pasa a hold. */}
        <button type="button" className={`approve${holding ? " holding" : ""}${tx.stage === "done" ? " done" : ""}${tx.stage === "pending" || launch.busy ? " busy" : ""}${canResim ? " resim" : ""}`} disabled={!armed && !canResim} onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
          onClick={canResim ? onResim : undefined}>
          <span className="ring" />
          <span className="lbl">{label}</span>
        </button>
        <small>{tx.stage === "done" ? `Token live on Base. Fees pay to ${launch.ownRecipient ? "your wallet" : launch.recipientLabel}.` : tx.stage === "blocked" ? "Risk said no. Nothing deployed." : "They draft. You launch. Bankr deploys, gas sponsored."}</small>
      </div>
    </div>
  );
  if (!max || typeof document === "undefined") return card;
  // Portal al body: dentro de la escena (backdrop-filter, transforms) un position: fixed queda atrapado.
  return (
    <>
      <div className="lc-max-hold" aria-hidden />
      {createPortal(
        <div className="lc-max-layer" role="dialog" aria-label="Launch a token" onClick={(e) => { if (e.target === e.currentTarget) setMax(false); }}>
          {card}
        </div>,
        document.body
      )}
    </>
  );
}

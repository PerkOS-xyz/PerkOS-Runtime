"use client";

import { useEffect, useRef, useState } from "react";
import XaiConnect from "./XaiConnect";
import { VOICES, VOICE_LABEL, type Voice } from "../lib/voices";
import { useWallet } from "./wallet/context";

type Llm = { provider: string; model: string; connected: boolean };

const LABELS: Record<string, string> = {
  "xai-oauth": "xAI · Grok (subscription)",
  xai: "xAI (API key)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  local: "Local"
};

type PerkosState = { connected: boolean; busy: boolean; fundingUrl: string; note: string };
// Rail de gasto 1Claw del Trader. Los limites (cadenas, allowlist, tope por tx,
// tope diario, aprobacion) viven en 1Claw como guardrails del agente y los edita
// la persona en su cuenta (1claw.co/agents/<id>); Floor solo enlaza con una fila
// propia, con el logo, para que la opcion se vea. Sin flota con rail no se muestra.
type RailState = { status: string; oneclawAgentId?: string; vaultId?: string; linkedRoles?: string[]; lockUsd?: number; hasRail: boolean };

/**
 * The guest seat has five honest states and they need different words. The
 * platform only gives a status string, so the classifier lives here: anything
 * it does not recognise counts as lost, because claiming a guest is working
 * when it is not is the failure that costs a person a turn.
 */
type GbPhase = "none" | "waiting" | "ready" | "lost" | "incomplete";

const GB_LOST = new Set(["unknown", "offline", "disconnected", "error", "failed", "revoked"]);
const GB_WAITING = new Set(["", "invited", "pending", "queued", "provisioning", "starting"]);

function grokBotPhase(guest: { invited: boolean; status?: string; complete?: boolean; prompt?: string } | null): GbPhase {
  if (!guest || !guest.invited) return "none";
  if (guest.complete === false || !guest.prompt) return "incomplete";
  const s = (guest.status || "").toLowerCase();
  if (GB_WAITING.has(s)) return "waiting";
  if (GB_LOST.has(s)) return "lost";
  return "ready";
}

const GB_PILL: Record<GbPhase, { label: string; title: string }> = {
  none: { label: "", title: "" },
  incomplete: { label: "Incomplete setup", title: "This setup is missing a key or id and cannot connect." },
  waiting: { label: "Waiting", title: "Invited. Waiting for your Grok Bot to connect." },
  lost: { label: "Connection lost", title: "PerkOS could not confirm the connection." },
  ready: { label: "Connected", title: "Connected. Drafting with the team." }
};

export default function SettingsPanel({ onClose, debug, onDebug, perkos, onReconnectPerkos, rail, onLinkRail, desk, onLogout }: {
  onClose: () => void;
  /** Cerrar sesion (en ventanas angostas el header no muestra Log out). */
  onLogout?: () => void;
  /** Desk activo: lo que cambia al cambiar de desk (cadena, equipo, revision). */
  desk?: { name: string; chain: string; builtOn: string; agents: string[]; revision: number; fleetStatus?: string };
  debug: boolean;
  onDebug: (v: boolean) => void;
  perkos: PerkosState;
  onReconnectPerkos: () => void;
  rail?: RailState;
  onLinkRail?: () => void;
}) {
  const wallet = useWallet();
  // Que wallet es y donde firma: con login por QR las firmas salen en el celular.
  const walletKind = wallet.signWhere === "phone" ? `${wallet.walletName || "External wallet"} · on your phone (WalletConnect)` : wallet.signWhere === "embedded" ? "PerkOS wallet (Privy) · signs inside this app" : wallet.signWhere === "extension" ? `${wallet.walletName || "External wallet"} · browser wallet` : "";
  const linkLost = wallet.connected && wallet.loaded && !wallet.busy && !wallet.canSign;
  const [llm, setLlm] = useState<Llm | null>(null);
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [voice, setVoice] = useState<Voice>("leo");
  const [previewing, setPreviewing] = useState(false);
  const [ver, setVer] = useState<{ version: string; build: string }>({ version: "", build: "" });
  // Bankr: segunda cotizacion, token launches y automatizaciones. La key vive
  // en el env del install; aqui se ve la wallet Bankr, su ETH en Base y el cupo.
  const [bankr, setBankr] = useState<{ configured: boolean; wallet?: { evm: string; ethBase: number; club: boolean; x?: string } | null; last24h?: number } | null>(null);
  const [guest, setGuest] = useState<{ invited: boolean; agentName?: string; status?: string; prompt?: string; complete?: boolean } | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const dockRef = useRef<HTMLFormElement>(null);
  const [hasMore, setHasMore] = useState(false);

  const refresh = () =>
    Promise.all([
      fetch("/api/llm/status").then((r) => r.json()).then((s: Llm) => { setLlm(s); setModel(s.model); }),
      fetch("/api/settings").then((r) => r.json()).then((s: { voice?: Voice; version?: string; build?: string }) => { if (s.voice && (VOICES as readonly string[]).includes(s.voice)) setVoice(s.voice); setVer({ version: s.version ?? "", build: s.build ?? "" }); }).catch(() => undefined),
      fetch("/api/launch/quotes").then((r) => r.json()).then((j: { configured?: boolean; wallet?: { evm: string; ethBase: number; club: boolean; x?: string } | null; last24h?: number }) => setBankr({ configured: j.configured === true, wallet: j.wallet ?? null, last24h: j.last24h ?? 0 })).catch(() => setBankr({ configured: false })),
      fetch("/api/fleet/guest").then((r) => r.json()).then((j: { invited?: boolean; agentName?: string; status?: string; prompt?: string; complete?: boolean }) => setGuest({ invited: j.invited === true, agentName: j.agentName, status: j.status, prompt: j.prompt, complete: j.complete })).catch(() => setGuest({ invited: false }))
    ]);

  // La voz se guarda al elegirla y se puede escuchar antes de cerrar.
  const pickVoice = (v: Voice) => {
    setVoice(v);
    void fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: v }) });
  };
  const preview = async () => {
    setPreviewing(true);
    try {
      const r = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Sparky here. They draft. You approve.", voice }) });
      if (!r.ok) return;
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play().catch(() => undefined);
    } finally { setPreviewing(false); }
  };

  const mintGuest = async () => {
    setGuestBusy(true);
    setCopied(false);
    try {
      const r = await fetch("/api/fleet/guest", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { error?: string; invited?: boolean; agentName?: string; status?: string; prompt?: string; complete?: boolean; already?: boolean; ok?: boolean };
      if (!r.ok) { setGuest({ invited: false }); return; }
      setGuest({ invited: true, agentName: j.agentName, status: j.status, prompt: j.prompt, complete: j.complete });
    } finally { setGuestBusy(false); }
  };
  const copyGuest = async () => {
    if (!guest?.prompt) return;
    await navigator.clipboard.writeText(guest.prompt).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const refreshGuest = async () => {
    setRefreshing(true);
    try {
      const j = (await fetch("/api/fleet/guest").then((r) => r.json())) as { invited?: boolean; agentName?: string; status?: string; prompt?: string; complete?: boolean };
      setGuest({ invited: j.invited === true, agentName: j.agentName, status: j.status, prompt: j.prompt, complete: j.complete });
    } catch {
      /* leave the last known state; the row says when it cannot confirm */
    } finally { setRefreshing(false); }
  };

  useEffect(() => { void refresh(); }, []);

  // While a bot is expected to connect, the panel checks for it, because the
  // row saying "waiting" after the seat went live is the thing that makes
  // people paste the invite twice. It backs off and then stops: every check is
  // a read on the platform, and a panel left open all afternoon must not turn
  // into a poll. The Check again button is always there.
  useEffect(() => {
    if (grokBotPhase(guest) !== "waiting") return;
    let delay = 8000;
    let checks = 0;
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === "hidden") { timer = window.setTimeout(tick, delay); return; }
      void refreshGuest();
      checks += 1;
      if (checks >= 12) return;           // about four minutes of watching
      delay = Math.min(Math.round(delay * 1.5), 60_000);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
    return () => window.clearTimeout(timer);
  }, [guest?.invited, guest?.status, guest?.complete]);

  // The dock scrolls, and it has to look like it does: the fade only appears
  // when there is something below.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const check = () => setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [guest, llm, bankr, rail, desk]);

  async function saveModel(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    });
    setSaved(true);
    void refresh();
  }

  const railText = !rail?.hasRail ? null
    : rail.status === "linked" ? `Linked · ${(rail.linkedRoles ?? ["trader"]).map((r) => r[0].toUpperCase() + r.slice(1)).join(", ")}${rail.vaultId ? ` · vault ${rail.vaultId.slice(0, 8)}` : ""}`
    : rail.status === "claim_pending" ? "Claim pending at 1Claw"
    : rail.status === "not_configured" ? "Not enabled on this PerkOS yet"
    : "Not linked · the Trader drafts only";
  const railUrl = rail?.oneclawAgentId ? `https://1claw.co/agents/${encodeURIComponent(rail.oneclawAgentId)}` : "https://1claw.co/agents";

  // Panel lateral derecho, como las pantallas del dock: filas compactas
  // "etiqueta · valor" en tres secciones (Shell, Desk, About). Lo del shell
  // no cambia al cambiar de desk; lo del desk viene del manifiesto y la flota.
  return (
    <div className="settings" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={`settings-dock${hasMore ? " has-more" : ""}`} ref={dockRef} onSubmit={saveModel} aria-label="Settings">
        <header>
          <b>Settings</b>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="sec">Shell</div>
        <div className="srow">
          <span>Account</span>
          <span className="v">
            {perkos.busy ? "Connecting…" : perkos.connected ? "PerkOS session active" : perkos.note || "Not connected"}
            <button type="button" onClick={onReconnectPerkos} disabled={perkos.busy}>{perkos.connected ? "Re-sign" : "Connect"}</button>
            {onLogout ? <button type="button" onClick={onLogout}>Log out</button> : null}
          </span>
        </div>
        {wallet.address ? (
          <>
            <div className="srow rail-row">
              <span>Wallet</span>
              <span className="v">
                {linkLost ? "Signed in, not linked to this window" : walletKind || "Connected"} · {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                {linkLost ? <button type="button" onClick={onLogout ?? wallet.reconnect}>Sign in again</button> : <em className={`linkdot${wallet.canSign ? " on" : ""}`}>{wallet.canSign ? "linked" : "…"}</em>}
              </span>
            </div>
            <p className="hint-line">{linkLost ? "Your session is alive but the link to your wallet dropped. Nothing can be signed until you sign in again (More options, WalletConnect, scan the QR)."
              : wallet.signWhere === "phone" ? `Approvals and claims show up in ${wallet.walletName || "your wallet app"} on your phone. Keep the app open and unlocked when you hold to approve.`
              : wallet.signWhere === "embedded" ? "This wallet was created for you at sign in. It signs here, with no phone. Fund it with USDC and a little ETH on Base to trade."
              : "Approvals open in your wallet."}</p>
          </>
        ) : null}
        {perkos.fundingUrl ? (
          <div className="srow"><span>Infrastructure</span><span className="v"><a href={perkos.fundingUrl} target="_blank" rel="noreferrer">Activate PerkOS infrastructure ↗</a></span></div>
        ) : null}
        <div className="srow">
          <span>LLM</span>
          <span className="v">
            {llm ? `${LABELS[llm.provider] ?? llm.provider} · ${llm.connected ? "connected" : "not connected"}` : "…"}
            <XaiConnect label={llm?.connected ? "Reconnect" : "Connect"} onConnected={() => void refresh()} />
          </span>
        </div>
        <div className="srow">
          <span>Voice</span>
          <span className="v">
            <select value={voice} onChange={(e) => pickVoice(e.target.value as Voice)} aria-label="Voice">
              {VOICES.map((v) => <option key={v} value={v}>{VOICE_LABEL[v]}</option>)}
            </select>
            <button type="button" onClick={() => void preview()} disabled={previewing || !llm?.connected}>{previewing ? "Playing…" : "Preview"}</button>
          </span>
        </div>
        <div className="srow">
          <span>Model</span>
          <span className="v">
            <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="grok-4.6" aria-label="Model" />
            <button type="submit">Save</button>
            {saved ? <em>Saved</em> : null}
          </span>
        </div>
        <div className="srow">
          <span>Debug dock</span>
          <span className="v">
            <label className="check">
              <input type="checkbox" checked={debug} onChange={(e) => onDebug(e.target.checked)} />
              Show <span className="kbd">⌘⇧D</span>
            </label>
          </span>
        </div>
        <p className="hint-line">Stored in ~/.perkos-xyz. Never git. Never the vault.</p>

        {desk ? (
          <>
            <div className="sec">Desk · {desk.name}</div>
            <div className="srow"><span>Chain</span><span className="v">{desk.chain} · {desk.builtOn}</span></div>
            <div className="srow"><span>Team</span><span className="v">{desk.agents.join(", ")} · template r{desk.revision}{desk.fleetStatus ? ` · ${desk.fleetStatus}` : ""}</span></div>
            {(() => {
              const phase = grokBotPhase(guest);
              const name = guest?.agentName || "your Grok Bot";
              const setup = (
                <details className="gb-reveal">
                  <summary>Show setup</summary>
                  <textarea className="invite-prompt" readOnly value={guest?.prompt ?? ""} aria-label="Grok Bot setup" />
                  <p className="hint-line">This carries a key for {name}. Treat it like a password: it goes into your Grok Bot and nowhere else.</p>
                </details>
              );
              return (
                <div className="gb-card" aria-live="polite">
                  <div className="gb-head">
                    <span className="gb-title">Grok Bot</span>
                    <span className="gb-headright">
                      {guest !== null && phase !== "none" ? <em className={`gb-pill gb-${phase}`} title={GB_PILL[phase].title}>{GB_PILL[phase].label}</em> : null}
                      <button type="button" className={`gb-refresh${refreshing ? " spin" : ""}`} onClick={() => void refreshGuest()} disabled={refreshing || guest === null} aria-label="Refresh Grok Bot status" title="Refresh status">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
                      </button>
                    </span>
                  </div>
                  <p className="hint-line">Drafts with your team from outside. Never spends, never signs.</p>

                  {phase === "none" ? (
                    <>
                      <button type="button" className="gb-go" onClick={() => void mintGuest()} disabled={guestBusy || !perkos.connected} title={!perkos.connected ? "Connect your PerkOS account first" : undefined}>{guestBusy ? "Inviting…" : "Invite my Grok Bot"}</button>
                      <p className="hint-line">One paste in your bot and it takes the fifth seat on this desk.</p>
                    </>
                  ) : null}

                  {phase === "incomplete" ? (
                    <>
                      <p className="hint-line err">This setup is missing the key or the agent id, so a bot cannot connect with it. Get a fresh one and paste that instead.</p>
                      <button type="button" className="gb-go" onClick={() => void mintGuest()} disabled={guestBusy}>{guestBusy ? "Inviting…" : "Get a new invite"}</button>
                    </>
                  ) : null}

                  {phase === "waiting" ? (
                    <>
                      <p className="hint-line">Invited as {name}. Paste the setup once into your Grok Bot. It connects out to PerkOS and this seat lights up on its own.</p>
                      <button type="button" className="gb-go" onClick={() => void copyGuest()}>{copied ? "Copied" : "Copy setup"}</button>
                      {setup}
                      <p className="hint-line">The bot installs <a href="https://github.com/PerkOS-xyz/PerkOS-Grok-Plugin" target="_blank" rel="noreferrer">the PerkOS plugin</a> and checks this desk on a schedule.</p>
                    </>
                  ) : null}

                  {phase === "lost" ? (
                    <>
                      <p className="hint-line err">Lost touch with {name}. Usually the bot stopped or its connection dropped. The setup you already pasted is still good, no need to invite again.</p>
                      <button type="button" className="gb-go" onClick={() => void refreshGuest()} disabled={refreshing}>{refreshing ? "Checking…" : "Check again"}</button>
                      {setup}
                    </>
                  ) : null}

                  {phase === "ready" ? (
                    <>
                      <p className="hint-line ok">{name} is on the desk. Its drafts land with the rest of the team, and nothing it writes moves until you approve it.</p>
                      {/* Still reachable once connected: a second bot, a reinstall
                          or a machine swap all need the same setup again. */}
                      <button type="button" className="gb-go" onClick={() => void copyGuest()}>{copied ? "Copied" : "Copy setup"}</button>
                      {setup}
                    </>
                  ) : null}
                </div>
              );
            })()}
            {railText ? (
              <div className="srow rail-row">
                <span><img className="rail-mark" src="/1claw.svg" alt="" />1Claw</span>
                <span className="v">
                  {railText}
                  {rail?.status === "linked" ? <a className="pill" href={railUrl} target="_blank" rel="noreferrer" title="Chains, allowlists, per-trade and daily caps, approval policy. Opens your 1Claw account in the browser.">Edit rails ↗</a> : null}
                  {rail && rail.status !== "linked" && rail.status !== "not_configured" && onLinkRail ? <button type="button" onClick={onLinkRail}>Link 1Claw</button> : null}
                </span>
              </div>
            ) : null}
            {rail?.status === "linked" && rail.lockUsd ? <p className="hint-line">The Trader spends only through 1Claw. Above ${rail.lockUsd} every spend waits for you.</p> : null}
            <div className="srow rail-row">
              <span>Bankr</span>
              <span className="v">
                {bankr === null ? "…" : !bankr.configured ? "No key on this install · add BANKR_API_KEY with Token Launch enabled" : bankr.wallet ? `${bankr.wallet.evm.slice(0, 6)}…${bankr.wallet.evm.slice(-4)} · ${bankr.wallet.ethBase.toFixed(4)} ETH on Base${bankr.wallet.club ? " · Bankr Club" : ""} · ${bankr.last24h ?? 0}/3 launches today` : "Key set · wallet not reachable"}
                {bankr?.configured ? <a className="pill" href="https://bankr.bot/api-keys" target="_blank" rel="noreferrer" title="Token Launch API and read-write must be enabled on the key. Opens your Bankr keys in the browser.">Keys ↗</a> : null}
              </span>
            </div>
            <p className="hint-line">Second quote, token launches paired with tokenized stocks, and automations (DCA, stop, limit). Launch fees pay to the wallet connected here.</p>
            <div className="srow"><span>Knowledge</span><span className="v">Bundled notes · PerkOS Knowledge · local vault</span></div>
          </>
        ) : null}

        <div className="sec">About</div>
        <div className="srow"><span>PerkOS</span><span className="v">{ver.version || "…"}{ver.build ? ` (${ver.build})` : ""} · {desk?.builtOn ?? "Built on Base"} · They draft. You approve.</span></div>
      </form>
    </div>
  );
}

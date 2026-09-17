"use client";

import { useEffect, useState } from "react";
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

  const refresh = () =>
    Promise.all([
      fetch("/api/llm/status").then((r) => r.json()).then((s: Llm) => { setLlm(s); setModel(s.model); }),
      fetch("/api/settings").then((r) => r.json()).then((s: { voice?: Voice; version?: string; build?: string }) => { if (s.voice && (VOICES as readonly string[]).includes(s.voice)) setVoice(s.voice); setVer({ version: s.version ?? "", build: s.build ?? "" }); }).catch(() => undefined),
      fetch("/api/launch/quotes").then((r) => r.json()).then((j: { configured?: boolean; wallet?: { evm: string; ethBase: number; club: boolean; x?: string } | null; last24h?: number }) => setBankr({ configured: j.configured === true, wallet: j.wallet ?? null, last24h: j.last24h ?? 0 })).catch(() => setBankr({ configured: false }))
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

  useEffect(() => { void refresh(); }, []);

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
      <form className="settings-dock" onSubmit={saveModel} aria-label="Settings">
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
                {linkLost ? <button type="button" onClick={wallet.reconnect}>Reconnect wallet</button> : <em className={`linkdot${wallet.canSign ? " on" : ""}`}>{wallet.canSign ? "linked" : "…"}</em>}
              </span>
            </div>
            <p className="hint-line">{linkLost ? "Your session is alive but the link to your wallet dropped. Nothing can be signed until you reconnect; you stay signed in."
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

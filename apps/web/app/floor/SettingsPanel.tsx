"use client";

import { useEffect, useState } from "react";
import XaiConnect from "./XaiConnect";

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
// tope diario, aprobacion) viven en 1Claw y los edita la persona en su cuenta;
// Floor solo enlaza. Sin flota con rail no se muestra.
type RailState = { status: string; oneclawAgentId?: string; vaultId?: string; linkedRoles?: string[]; hasRail: boolean };

export default function SettingsPanel({ onClose, debug, onDebug, perkos, onReconnectPerkos, rail, onLinkRail, desk }: {
  onClose: () => void;
  /** Desk activo: lo que cambia al cambiar de desk (cadena, equipo, revision). */
  desk?: { name: string; chain: string; builtOn: string; agents: string[]; revision: number; fleetStatus?: string };
  debug: boolean;
  onDebug: (v: boolean) => void;
  perkos: PerkosState;
  onReconnectPerkos: () => void;
  rail?: RailState;
  onLinkRail?: () => void;
}) {
  const [llm, setLlm] = useState<Llm | null>(null);
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);

  const refresh = () =>
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then((s: Llm) => { setLlm(s); setModel(s.model); });

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
          </span>
        </div>
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
        <p className="hint-line">Stored in ~/.perkos-floor. Never git. Never the vault.</p>

        {desk ? (
          <>
            <div className="sec">Desk · {desk.name}</div>
            <div className="srow"><span>Chain</span><span className="v">{desk.chain} · {desk.builtOn}</span></div>
            <div className="srow"><span>Team</span><span className="v">{desk.agents.join(", ")} · template r{desk.revision}{desk.fleetStatus ? ` · ${desk.fleetStatus}` : ""}</span></div>
            {railText ? (
              <div className="srow">
                <span>Spend rail</span>
                <span className="v">
                  {railText}
                  {rail?.status === "linked" && rail.oneclawAgentId ? <a href={`https://1claw.co/agents/${encodeURIComponent(rail.oneclawAgentId)}`} target="_blank" rel="noreferrer" title="Chains, allowlists, per-trade and daily caps, approval policy">Edit limits at 1Claw ↗</a> : null}
                  {rail && rail.status !== "linked" && rail.status !== "not_configured" && onLinkRail ? <button type="button" onClick={onLinkRail}>Link 1Claw</button> : null}
                </span>
              </div>
            ) : null}
            <div className="srow"><span>Second quote</span><span className="v">Bankr · read only</span></div>
            <div className="srow"><span>Knowledge</span><span className="v">Bundled notes · PerkOS Knowledge · local vault</span></div>
          </>
        ) : null}

        <div className="sec">About</div>
        <div className="srow"><span>PerkOS Floor</span><span className="v">0.1.0 · {desk?.builtOn ?? "Built on Base"} · They draft. You approve.</span></div>
      </form>
    </div>
  );
}

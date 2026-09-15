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

export default function SettingsPanel({ onClose, debug, onDebug, perkos, onReconnectPerkos, rail, onLinkRail }: {
  onClose: () => void;
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

  return (
    <div className="settings">
      <form className="settings-card" onSubmit={saveModel}>
        <div className="k">SETTINGS</div>
        <b>LLM</b>
        <p className="hint-line">
          {llm ? `${LABELS[llm.provider] ?? llm.provider} · ${llm.connected ? "connected" : "not connected"}` : "…"}
        </p>
        <XaiConnect label={llm?.connected ? "Reconnect LLM" : "Connect LLM"} onConnected={() => void refresh()} />
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder="grok-4.6" />
        </label>
        <p className="hint-line">Stored in ~/.perkos-floor. Never git. Never the vault.</p>
        <b>PerkOS</b>
        <p className="hint-line">
          {perkos.busy ? "Connecting…" : perkos.connected ? "Session active · your team runs on PerkOS infra" : perkos.note || "Not connected"}
        </p>
        {perkos.fundingUrl ? (
          <p className="hint-line">
            <a href={perkos.fundingUrl} target="_blank" rel="noreferrer">Activate PerkOS infrastructure ↗</a>
          </p>
        ) : null}
        <div className="row">
          <button type="button" onClick={onReconnectPerkos} disabled={perkos.busy}>{perkos.connected ? "Re-sign PerkOS" : "Connect PerkOS"}</button>
        </div>
        {rail?.hasRail ? (
          <>
            <b>Spend rail · 1Claw</b>
            <p className="hint-line">
              {rail.status === "linked"
                ? `Linked · ${(rail.linkedRoles ?? ["trader"]).map((r) => r[0].toUpperCase() + r.slice(1)).join(", ")} carry the credential${rail.vaultId ? ` · vault ${rail.vaultId.slice(0, 8)}` : ""}`
                : rail.status === "claim_pending"
                  ? "Claim pending at 1Claw"
                  : rail.status === "not_configured"
                    ? "Not enabled on this PerkOS yet"
                    : "Not linked · the Trader drafts only"}
            </p>
            {rail.status === "linked" && rail.oneclawAgentId ? (
              <p className="hint-line">
                <a href={`https://1claw.co/agents/${encodeURIComponent(rail.oneclawAgentId)}`} target="_blank" rel="noreferrer">Edit limits at 1Claw ↗</a>
                {" "}· chains, allowlists, per-trade and daily caps, approval policy
              </p>
            ) : null}
            {rail.status !== "linked" && rail.status !== "not_configured" && onLinkRail ? (
              <div className="row">
                <button type="button" onClick={onLinkRail}>Link 1Claw</button>
              </div>
            ) : null}
          </>
        ) : null}
        <b>Debug</b>
        <label className="check">
          <input type="checkbox" checked={debug} onChange={(e) => onDebug(e.target.checked)} />
          Show debug panel <span className="kbd">⌘⇧D</span>
        </label>
        <div className="row">
          <button type="submit" className="cta">Save</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {saved ? <p className="hint-line">Saved.</p> : null}
      </form>
    </div>
  );
}

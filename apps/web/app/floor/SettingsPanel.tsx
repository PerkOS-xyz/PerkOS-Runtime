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

export default function SettingsPanel({ onClose, debug, onDebug, perkos, onReconnectPerkos }: {
  onClose: () => void;
  debug: boolean;
  onDebug: (v: boolean) => void;
  perkos: PerkosState;
  onReconnectPerkos: () => void;
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

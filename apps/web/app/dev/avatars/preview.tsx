"use client";

import AgentAvatar, { AGENT_ROLES, type AgentAvatarState } from "../../floor/AgentAvatar";

const FLOOR = ["scout", "risk", "trader", "auditor"];
const STATES: AgentAvatarState[] = ["idle", "listening", "thinking", "working", "waiting", "success", "warning", "error", "offline"];

export default function AvatarsPreview() {
  const h: React.CSSProperties = { font: "500 10px/1 ui-monospace, Menlo, monospace", letterSpacing: "0.14em", textTransform: "uppercase", color: "#7f8aa3", margin: "26px 0 12px" };
  const cap: React.CSSProperties = { font: "11px/1.3 ui-monospace, Menlo, monospace", color: "#9aabc8", textAlign: "center", marginTop: 6 };
  return (
    <main style={{ minHeight: "100vh", padding: "28px 32px 60px", background: "radial-gradient(900px 500px at 50% 0%, #1a1440 0%, #070914 60%)", color: "#e6ecff", overflow: "auto", position: "absolute", inset: 0 }}>
      <h1 style={{ font: "600 18px/1.2 system-ui", margin: 0 }}>PerkOS agent avatars · Floor Desk</h1>
      <p style={{ font: "12px/1.5 ui-monospace, Menlo, monospace", color: "#9aabc8", maxWidth: 760, margin: "6px 0 0" }}>Same family as Sparky, never competing with it: ceramic helmet, black glass visor, neon eyes. No flame, no pink gradient, no spark, modules instead of Sparky's ear pods. Role = accent halo + symbol. State = eyes + ring.</p>

      <div style={h}>The scene: Sparky coordinates, the desk specializes</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: "10px 0 6px" }}>
        <div style={{ display: "flex", gap: 54, alignItems: "flex-end" }}>
          {FLOOR.map((r, i) => (
            <div key={r}><AgentAvatar role={r} state={(["working", "thinking", "idle", "idle"] as AgentAvatarState[])[i]} size={84} /><div style={cap}>{AGENT_ROLES[r].label}</div></div>
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sparky.png" alt="Sparky" style={{ width: 210, height: "auto", filter: "drop-shadow(0 0 28px rgba(236,27,105,.55))" }} />
      </div>

      <div style={h}>States (identity never changes, the state does)</div>
      {FLOOR.map((r) => (
        <div key={r} style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 10 }}>
          <div style={{ ...cap, width: 64, textAlign: "left", marginTop: 0 }}>{AGENT_ROLES[r].label}</div>
          {STATES.map((st) => <div key={st}><AgentAvatar role={r} state={st} size={72} /><div style={cap}>{st}</div></div>)}
        </div>
      ))}

      <div style={h}>Sizes: 24 · 32 · 48 · 64 · 96 · 160 (symbol and ring drop under 44 px)</div>
      <div style={{ display: "flex", gap: 22, alignItems: "flex-end" }}>
        {[24, 32, 48, 64, 96, 160].map((sz) => <div key={sz}><AgentAvatar role="scout" state="working" size={sz} /><div style={cap}>{sz}</div></div>)}
        {[24, 32, 48, 64, 96].map((sz) => <div key={`r${sz}`}><AgentAvatar role="risk" state="idle" size={sz} /><div style={cap}>{sz}</div></div>)}
      </div>

      <div style={h}>Other desks (asset sheet palette)</div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {["research", "qa", "builder", "analyst", "finance", "ops", "sales", "growth"].map((r) => <div key={r}><AgentAvatar role={r} state="idle" size={80} /><div style={cap}>{AGENT_ROLES[r].label}</div></div>)}
      </div>

      <div style={h}>Same role, different agents (deterministic seed)</div>
      <div style={{ display: "flex", gap: 22 }}>
        {["scout-a", "scout-b", "scout-c"].map((s) => <div key={s}><AgentAvatar role="scout" seed={s} size={80} /><div style={cap}>{s}</div></div>)}
      </div>
    </main>
  );
}

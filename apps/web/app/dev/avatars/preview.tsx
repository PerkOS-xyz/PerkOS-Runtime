"use client";

import { useEffect, useState } from "react";
import AgentAvatar, { type AgentAvatarState } from "../../floor/AgentAvatar";
import {
  AGENT_ROLES, FLOOR_IDENTITIES, HEADS, VISORS, MODULES, PATTERNS, DETAILS, PART_NAMES, STATES, EXPRESSIONS, AVATAR_SIZES,
  generateTestPopulation, shortCode, avatarDistance, type AgentAvatarIdentity
} from "../../floor/avatarIdentity";

// Laboratorio visual (Identity System, secciones 62 y 63): todas las piezas, roles, expresiones,
// estados, tamanos y una poblacion generada de 100 para detectar casi duplicados.

const FLOOR = ["scout", "risk", "trader", "auditor"];
const KIT_ROLES = ["builder", "reviewer", "qa", "support", "research", "analyst", "knowledge", "workflow", "trader", "ops", "concierge", "sales", "growth", "security"];
const BASE: AgentAvatarIdentity = { version: 1, head: "head-01", visor: "visor-02", modules: "module-04", pattern: "pattern-01", secondaryDetail: "detail-04", role: "research", accent: AGENT_ROLES.research.accent };

export default function AvatarsPreview() {
  const h: React.CSSProperties = { font: "500 10px/1 ui-monospace, Menlo, monospace", letterSpacing: "0.14em", textTransform: "uppercase", color: "#7f8aa3", margin: "28px 0 12px" };
  const cap: React.CSSProperties = { font: "11px/1.3 ui-monospace, Menlo, monospace", color: "#9aabc8", textAlign: "center", marginTop: 6 };
  const row: React.CSSProperties = { display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" };
  const pop = generateTestPopulation(100);
  let closest = 99;
  for (let i = 0; i < pop.length; i++) for (let j = i + 1; j < pop.length; j++) closest = Math.min(closest, avatarDistance(pop[i].identity, pop[j].identity));
  const withPart = (patch: Partial<AgentAvatarIdentity>): AgentAvatarIdentity => ({ ...BASE, ...patch });
  // ?big=1: solo el desk a 300 px, para revisar la geometria de cerca.
  const [big, setBig] = useState(false);
  useEffect(() => { setBig(new URLSearchParams(window.location.search).has("big")); }, []);
  if (big) return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#070914", display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start", position: "absolute", inset: 0, overflow: "auto" }}>
      {FLOOR.map((r, i) => <div key={r}><AgentAvatar agent={{ id: r, role: r }} state={(["working", "thinking", "idle", "hibernating"] as AgentAvatarState[])[i]} size={300} /><div style={cap}>{AGENT_ROLES[r].label} {shortCode(FLOOR_IDENTITIES[r])}</div></div>)}
      {HEADS.map((p) => <div key={p}><AgentAvatar identity={withPart({ head: p, visor: "visor-02" })} size={220} /><div style={cap}>{PART_NAMES[p]}</div></div>)}
      {VISORS.map((p) => <div key={p}><AgentAvatar identity={withPart({ visor: p })} size={220} /><div style={cap}>{PART_NAMES[p]}</div></div>)}
      {MODULES.map((p) => <div key={p}><AgentAvatar identity={withPart({ modules: p })} size={220} /><div style={cap}>{PART_NAMES[p]}</div></div>)}
      {PATTERNS.map((p) => <div key={p}><AgentAvatar identity={withPart({ pattern: p, secondaryDetail: "detail-01" })} size={220} /><div style={cap}>{PART_NAMES[p]}</div></div>)}
      {DETAILS.map((p) => <div key={p}><AgentAvatar identity={withPart({ secondaryDetail: p })} size={220} /><div style={cap}>{PART_NAMES[p]}</div></div>)}
      {EXPRESSIONS.map((e) => <div key={e}><AgentAvatar agent={{ id: "trader", role: "trader" }} state="working" expression={e} size={220} /><div style={cap}>{e}</div></div>)}
    </main>
  );
  return (
    <main style={{ minHeight: "100vh", padding: "28px 32px 60px", background: "radial-gradient(900px 500px at 50% 0%, #1a1440 0%, #070914 60%)", color: "#e6ecff", overflow: "auto", position: "absolute", inset: 0 }}>
      <h1 style={{ font: "600 18px/1.2 system-ui", margin: 0 }}>PerkOS agent avatars · construction kit v1</h1>
      <p style={{ font: "12px/1.5 ui-monospace, Menlo, monospace", color: "#9aabc8", maxWidth: 820, margin: "6px 0 0" }}>
        Permanent identity (head + visor + modules + pattern + detail) + role (accent + symbol) + expression (eyes) + runtime state (ring, rim, filter) = visible avatar.
        Same family as Sparky, never competing with it: no flame, no pink gradient, no four point spark. The 1Claw agent carries red accents.
      </p>

      <div style={h}>Floor Desk: Sparky coordinates, the desk specializes (Trader signs with 1Claw)</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: "10px 0 6px" }}>
        <div style={{ display: "flex", gap: 54, alignItems: "flex-end" }}>
          {FLOOR.map((r, i) => (
            <div key={r}><AgentAvatar agent={{ id: r, role: r }} state={(["working", "thinking", "idle", "hibernating"] as AgentAvatarState[])[i]} size={96} /><div style={cap}>{AGENT_ROLES[r].label}<br />{shortCode(FLOOR_IDENTITIES[r])}</div></div>
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sparky.png" alt="Sparky" style={{ width: 210, height: "auto", filter: "drop-shadow(0 0 28px rgba(236,27,105,.55))" }} />
      </div>

      <div style={h}>Runtime states (identity never changes; hibernating is not offline, not error)</div>
      {FLOOR.map((r) => (
        <div key={r} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
          <div style={{ ...cap, width: 60, textAlign: "left", marginTop: 0 }}>{AGENT_ROLES[r].label}</div>
          {STATES.map((st) => <div key={st}><AgentAvatar agent={{ id: r, role: r }} state={st} size={68} /><div style={cap}>{st}</div></div>)}
        </div>
      ))}

      <div style={h}>Expressions (eyes only; the state may suggest one, the app can override it)</div>
      <div style={row}>
        {EXPRESSIONS.map((e) => <div key={e}><AgentAvatar agent={{ id: "trader", role: "trader" }} state="working" expression={e} size={80} /><div style={cap}>{e}</div></div>)}
      </div>

      <div style={h}>Kit parts on one base agent: heads · visors · modules · patterns · details</div>
      <div style={row}>
        {HEADS.map((p) => <div key={p}><AgentAvatar identity={withPart({ head: p, visor: "visor-02" })} size={80} /><div style={cap}>{p.replace("head-", "H")} {PART_NAMES[p]}</div></div>)}
        <div style={{ width: 16 }} />
        {VISORS.map((p) => <div key={p}><AgentAvatar identity={withPart({ visor: p })} size={80} /><div style={cap}>{p.replace("visor-", "V")} {PART_NAMES[p]}</div></div>)}
      </div>
      <div style={{ ...row, marginTop: 14 }}>
        {MODULES.map((p) => <div key={p}><AgentAvatar identity={withPart({ modules: p })} size={80} /><div style={cap}>{p.replace("module-", "M")} {PART_NAMES[p]}</div></div>)}
        <div style={{ width: 16 }} />
        {PATTERNS.map((p) => <div key={p}><AgentAvatar identity={withPart({ pattern: p, secondaryDetail: "detail-01" })} size={80} /><div style={cap}>{p.replace("pattern-", "P")} {PART_NAMES[p]}</div></div>)}
        <div style={{ width: 16 }} />
        {DETAILS.map((p) => <div key={p}><AgentAvatar identity={withPart({ secondaryDetail: p })} size={80} /><div style={cap}>{p.replace("detail-", "D")} {PART_NAMES[p]}</div></div>)}
      </div>

      <div style={h}>The 14 kit roles (accent + symbol), each on its own generated identity</div>
      <div style={row}>
        {KIT_ROLES.map((r) => <div key={r}><AgentAvatar agent={{ id: `kit-${r}`, role: r }} size={80} /><div style={cap}>{AGENT_ROLES[r].label}</div></div>)}
      </div>

      <div style={h}>Semantic sizes with progressive detail: xs 24 · sm 32 · md 48 · lg 64 · xl 96 · profile 160</div>
      <div style={row}>
        {(Object.keys(AVATAR_SIZES) as (keyof typeof AVATAR_SIZES)[]).map((s) => <div key={s}><AgentAvatar agent={{ id: "scout", role: "scout" }} state="working" size={s} /><div style={cap}>{s} {AVATAR_SIZES[s]}</div></div>)}
        <div style={{ width: 16 }} />
        {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => <div key={`t${s}`}><AgentAvatar agent={{ id: "trader", role: "trader" }} state="hibernating" size={s} /><div style={cap}>{s} sleeping</div></div>)}
        <div style={{ width: 16 }} />
        <div><AgentAvatar agent={{ id: "risk", role: "risk" }} state="hibernating" indicator="notification" size="xl" /><div style={cap}>hibernating + notification</div></div>
        <div><AgentAvatar agent={{ id: "auditor", role: "auditor" }} state="idle" indicator="online" size="xl" /><div style={cap}>idle + online</div></div>
      </div>

      <div style={h}>Same role, different agents (deterministic from the agent id, structure first, never only color)</div>
      <div style={row}>
        {["research-a", "research-b", "research-c", "research-d"].map((s) => <div key={s}><AgentAvatar agent={{ id: s, role: "research" }} size={80} /><div style={cap}>{s}</div></div>)}
      </div>

      <div style={h}>Generated population of 100 · unique keys, closest pair distance {closest} (head 4, visor 3, modules 3, pattern 2, detail 1)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 10 }}>
        {pop.map((p, i) => <div key={p.id}><AgentAvatar identity={p.identity} state={STATES[i % STATES.length]} size={64} /><div style={{ ...cap, fontSize: 9 }}>{String(i + 1).padStart(3, "0")} {shortCode(p.identity)}</div></div>)}
      </div>
    </main>
  );
}

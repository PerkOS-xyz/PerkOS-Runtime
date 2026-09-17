"use client";

import { useId } from "react";
import {
  AGENT_STATES, AVATAR_SIZES, resolveIdentity, roleConfig, accentFor,
  type AgentAvatarIdentity, type AgentAvatarState, type AgentAvatarExpression, type AgentSymbol, type AvatarSize,
  type AvatarHead, type AvatarVisor, type AvatarModules, type AvatarPattern, type AvatarDetail
} from "./avatarIdentity";

export type { AgentAvatarState, AgentAvatarExpression, AgentAvatarIdentity } from "./avatarIdentity";
export { AGENT_ROLES } from "./avatarIdentity";

// Avatar de agente PerkOS, en SVG puro. Piezas recreadas de la hoja del kit
// (assets/avatar-system-extra.png) en el sistema de coordenadas del estandar: viewBox 0 0 1000 1000,
// cada capa sin recortar, alineada sola. Estructura de grupos = arquitectura logica del avatar:
// shell, pattern, visor, eyes, modules, role-accent, secondary-detail, role-symbol, state-ring, status.
// Lo que es SOLO de Sparky no existe aqui: llama, degradado rosa/naranja, destello de cuatro puntas,
// orejeras con destello. Sparky nunca usa este componente.
//
// Pipeline (Asset Kit, seccion 25): identidad persistida + rol + expresion + estado -> render.
// La identidad nunca cambia por estado, expresion ni hibernacion.

export type AvatarIndicator = "online" | "working" | "waiting" | "success" | "warning" | "error" | "notification" | "offline" | "hibernating";

export type AgentLike = {
  id: string;
  role: string;
  name?: string;
  avatarIdentity?: AgentAvatarIdentity | null;
  runtimeState?: AgentAvatarState;
  /** El agente que firma con 1Claw lleva acentos rojos. */
  custody?: "1claw" | null;
};

// Anillo de estado: color del ESTADO, no del rol (hoja: STATE RINGS R01-R09).
const RING: Record<AgentAvatarState, { color: string; dash?: string }> = {
  idle: { color: "#f2f4f8" },
  listening: { color: "#3d8bff" },
  thinking: { color: "#a06bff", dash: "200 110" },
  working: { color: "#2fd0e6", dash: "360 125" },
  waiting: { color: "#ffb020", dash: "550 95" },
  success: { color: "#3ddc4a" },
  warning: { color: "#ff8a1f" },
  error: { color: "#ff4a4a", dash: "170 80" },
  offline: { color: "#8b93a3", dash: "62 70" },
  hibernating: { color: "#6b7280", dash: "62 70" }
};
// Overlay de estado: brillo en el borde del casco (hoja: STATE OVERLAYS).
const RIM: Partial<Record<AgentAvatarState, string>> = { listening: "#3d8bff", working: "#2fd0e6", success: "#3ddc4a", warning: "#ff8a1f", error: "#ff4a4a" };
// Indicadores (hoja: STATUS INDICATORS ST01-ST08 + hibernating).
const INDICATOR: Record<AvatarIndicator, string> = {
  online: "#3ddc4a", working: "#3d8bff", waiting: "#ffb020", success: "#3ddc4a", warning: "#ff8a1f", error: "#ff4a4a", notification: "#ff3d81", offline: "#9aa3b2", hibernating: "#6b7280"
};

// ---------- Geometria del kit (viewBox 1000) ----------
const rr4 = (x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) =>
  `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
const rr = (x: number, y: number, w: number, h: number, r: number) => rr4(x, y, w, h, [r, r, r, r]);

type Box = { x: number; y: number; w: number; h: number; rl: number; rr: number };
// Cabezas mas estrechas que el lienzo (175..825) para que los modulos laterales asomen; Wide es la excepcion.
const HEAD: Record<AvatarHead, { d: string; top: number; bottom: number; brow: { x: number; y: number } }> = {
  "head-01": { d: rr(175, 205, 650, 630, 300), top: 205, bottom: 835, brow: { x: 330, y: 285 } },
  "head-02": { d: rr(130, 300, 740, 500, 250), top: 300, bottom: 800, brow: { x: 330, y: 285 } },
  "head-03": { d: "M500 180A335 335 0 1 1 499.9 180Z", top: 180, bottom: 850, brow: { x: 330, y: 285 } },
  "head-04": { d: "M175 560C175 335 315 195 500 195S825 335 825 560V715Q825 825 720 825H280Q175 825 175 715Z", top: 195, bottom: 825, brow: { x: 335, y: 290 } },
  "head-05": { d: rr(175, 210, 650, 615, 160), top: 210, bottom: 825, brow: { x: 330, y: 285 } }
};
const VISOR: Record<AvatarVisor, { d: string; box: Box; eyeScale: number; halo?: string; crown?: string }> = {
  "visor-01": { d: rr(210, 330, 580, 375, 187), box: { x: 210, y: 330, w: 580, h: 375, rl: 187, rr: 187 }, eyeScale: 1 },
  "visor-02": { d: rr(205, 345, 590, 345, 100), box: { x: 205, y: 345, w: 590, h: 345, rl: 100, rr: 100 }, eyeScale: 0.92 },
  "visor-03": {
    d: "M280 330H720Q795 330 787 405L745 630Q730 705 650 705H350Q270 705 255 630L213 405Q205 330 280 330Z",
    box: { x: 205, y: 330, w: 590, h: 375, rl: 90, rr: 90 }, eyeScale: 0.9,
    halo: "M185 440L235 660Q252 733 350 733H650Q748 733 765 660L815 440",
    crown: "M200 520L185 405Q180 302 280 302H720Q820 302 815 405L800 520"
  },
  "visor-04": { d: rr4(210, 330, 580, 375, [200, 110, 200, 110]), box: { x: 210, y: 330, w: 580, h: 375, rl: 110, rr: 200 }, eyeScale: 0.95 }
};
const O = 28; // separacion del acento respecto al visor
function haloPath(b: Box) {
  const left = b.x - O, right = b.x + b.w + O, bottom = b.y + b.h + O, RL = b.rl + O, RR = b.rr + O;
  const ym = Math.min(b.y + b.h * 0.45, bottom - Math.max(RL, RR));
  return `M${left} ${ym}V${bottom - RL}A${RL} ${RL} 0 0 0 ${left + RL} ${bottom}H${right - RR}A${RR} ${RR} 0 0 0 ${right} ${bottom - RR}V${ym}`;
}
function crownPath(b: Box) {
  // En el visor hoja las esquinas superiores van cruzadas respecto a las inferiores.
  const left = b.x - O, right = b.x + b.w + O, top = b.y - O, RL = b.rr + O, RR = b.rl + O;
  const ym = Math.max(b.y + b.h * 0.55, top + Math.max(RL, RR));
  return `M${left} ${ym}V${top + RL}A${RL} ${RL} 0 0 1 ${left + RL} ${top}H${right - RR}A${RR} ${RR} 0 0 1 ${right} ${top + RR}V${ym}`;
}

function Symbol({ kind }: { kind: AgentSymbol }) {
  // Trazo de neon sobre boton oscuro; caben en un circulo de radio 8 centrado en (0,0). Sin destello de cuatro puntas.
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "search") return <g {...p}><circle cx="-1.4" cy="-1.4" r="3.8" /><path d="M1.6 1.6L5.4 5.4" /></g>;
  if (kind === "shield") return <g {...p}><path d="M0 -5.6L4.8 -3.6V0.6C4.8 3.4 2.6 5 0 5.8C-2.6 5 -4.8 3.4 -4.8 0.6V-3.6Z" /></g>;
  if (kind === "chart") return <g fill="currentColor"><rect x="-5.4" y="0.6" width="2.8" height="4.6" rx="0.8" /><rect x="-1.4" y="-2" width="2.8" height="7.2" rx="0.8" /><rect x="2.6" y="-5.2" width="2.8" height="10.4" rx="0.8" /></g>;
  if (kind === "trade") return <g {...p} strokeWidth="2.2"><path d="M-5.6 3.4L-1.6 -0.6L1.2 2.2L5.6 -2.6" /><path d="M2.4 -2.8H5.6V0.4" /></g>;
  if (kind === "check") return <g {...p} strokeWidth="2.4"><path d="M-4.6 0.2L-1.4 3.4L4.8 -3.2" /></g>;
  if (kind === "review") return <g {...p}><path d="M0 -5.8L5.8 0L0 5.8L-5.8 0Z" /><circle cx="0" cy="0" r="1.4" fill="currentColor" stroke="none" /></g>;
  if (kind === "build") return <g fill="currentColor"><rect x="-5" y="0.2" width="4.6" height="4.6" rx="0.9" /><rect x="0.4" y="0.2" width="4.6" height="4.6" rx="0.9" /><rect x="-2.3" y="-5" width="4.6" height="4.6" rx="0.9" /></g>;
  if (kind === "help") return <g {...p}><path d="M-5 1V-1A5 5 0 0 1 5 -1V1" /><rect x="-6" y="0.2" width="2.6" height="4" rx="1.2" fill="currentColor" stroke="none" /><rect x="3.4" y="0.2" width="2.6" height="4" rx="1.2" fill="currentColor" stroke="none" /><path d="M4.6 4.4Q4 6.6 1 6.6" /></g>;
  if (kind === "book") return <g {...p}><path d="M0 -4.2Q-2.6 -5.8 -5.6 -4.6V4.4Q-2.6 3.2 0 4.8Q2.6 3.2 5.6 4.4V-4.6Q2.6 -5.8 0 -4.2Z" /><path d="M0 -4.2V4.8" /></g>;
  if (kind === "flow") return <g {...p}><circle cx="-4" cy="-3.6" r="1.8" /><circle cx="4" cy="-3.6" r="1.8" /><circle cx="0" cy="4" r="1.8" /><path d="M-3 -2L-0.8 2.4M3 -2L0.8 2.4" /></g>;
  if (kind === "gear") return <g {...p}><circle cx="0" cy="0" r="2.1" /><path d="M0 -5.6V-3.8M0 3.8V5.6M-5.6 0H-3.8M3.8 0H5.6M-4 -4L-2.7 -2.7M2.7 2.7L4 4M-4 4L-2.7 2.7M2.7 -2.7L4 -4" /></g>;
  if (kind === "users") return <g fill="currentColor"><circle cx="0" cy="-3" r="2.1" /><path d="M-3.4 4.8V2.6C-3.4 1.2 -2.2 0.4 0 0.4S3.4 1.2 3.4 2.6V4.8Z" /><circle cx="-5" cy="-1.2" r="1.5" opacity="0.8" /><circle cx="5" cy="-1.2" r="1.5" opacity="0.8" /></g>;
  if (kind === "handshake") return <g {...p}><circle cx="-2.4" cy="0" r="3.6" /><circle cx="2.4" cy="0" r="3.6" /></g>;
  if (kind === "megaphone") return <g {...p}><path d="M-5 -1.4H-2.6L3.6 -4.8V4.8L-2.6 1.4H-5Z" /><path d="M-3.2 1.6L-2.2 5" /></g>;
  return <circle cx="0" cy="0" r="2.6" fill="currentColor" />;
}

// Ojo izquierdo en coordenadas locales (origen en el centro del ojo). El derecho es el espejo.
function Eye({ expression, mirror, id }: { expression: AgentAvatarExpression; mirror: boolean; id?: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let el: React.ReactNode;
  switch (expression) {
    case "happy": el = <path d="M-55 40Q0 -60 55 40" {...s} strokeWidth="36" />; break;
    case "curious": el = <ellipse cx="0" cy="0" rx="40" ry="62" {...s} strokeWidth="30" />; break;
    case "surprised": el = <ellipse cx="0" cy="0" rx="52" ry="78" {...s} strokeWidth="34" />; break;
    case "thinking": el = <path d="M-62 -30H62A62 62 0 0 1 -62 -30Z" fill="currentColor" />; break;
    case "focused": el = <path d="M-62 -50Q-55 60 62 45Q22 -35 -62 -50Z" fill="currentColor" />; break;
    case "listening": el = <path d="M20 -85Q-45 0 20 85" {...s} strokeWidth="34" />; break;
    case "determined": el = <path d="M-62 -10L62 -50V0A62 62 0 0 1 -62 0Z" fill="currentColor" />; break;
    case "concerned": el = <path d="M-62 -50L62 -10V0A62 62 0 0 1 -62 0Z" fill="currentColor" />; break;
    case "success": el = <path d="M-58 40L0 -45L58 40" {...s} strokeWidth="38" />; break;
    case "error": el = <path d="M-45 -50L45 50M45 -50L-45 50" {...s} strokeWidth="34" />; break;
    case "sleepy": el = <rect x="-58" y="-14" width="116" height="28" rx="14" fill="currentColor" />; break;
    default: el = <rect x="-39" y="-90" width="78" height="180" rx="39" fill="currentColor" />;
  }
  return <g id={id} className="aa-eye" transform={mirror ? "scale(-1 1)" : undefined}>{el}</g>;
}
function Eyes({ expression, scale, gap, glow = false }: { expression: AgentAvatarExpression; scale: number; gap: number; glow?: boolean }) {
  // La copia de brillo no lleva ids (no duplica ids en el DOM).
  return (
    <g className="aa-eyes">{/* sin transform aqui: la animacion CSS de los ojos pisaria el atributo */}
      <g transform={`translate(500 515) scale(${scale})`}>
        <g transform={`translate(${-gap} 0)`}><Eye expression={expression} mirror={false} id={glow ? undefined : "eye-left"} /></g>
        <g transform={`translate(${gap} 0)`}><Eye expression={expression} mirror id={glow ? undefined : "eye-right"} /></g>
      </g>
    </g>
  );
}

function Module({ kind, shell }: { kind: AvatarModules; shell: string }) {
  const dark = "#11141d";
  const acc = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const };
  if (kind === "module-01") return <><path d={rr(60, 390, 165, 280, 82)} fill={shell} /><path d={rr(88, 430, 80, 200, 40)} fill={dark} /></>;
  if (kind === "module-02") return <><path d={rr(70, 420, 150, 220, 75)} fill={shell} /><ellipse cx="145" cy="530" rx="45" ry="80" fill={dark} /><ellipse cx="145" cy="530" rx="26" ry="52" {...acc} strokeWidth="12" /></>;
  if (kind === "module-03") return <><path d="M230 390C110 400 60 470 68 550C76 630 118 680 230 690Z" fill={shell} /><path d="M225 415C130 440 100 490 108 550C115 605 140 645 225 662Z" fill={dark} /><path d="M215 440C150 470 140 510 146 555C151 590 165 615 210 638" {...acc} strokeWidth="14" /></>;
  if (kind === "module-04") return <><path d={rr(95, 405, 110, 250, 30)} fill={shell} /><path d="M150 445V615" stroke={dark} strokeWidth="12" strokeLinecap="round" fill="none" /></>;
  return <><circle cx="140" cy="530" r="85" fill={shell} /><circle cx="140" cy="530" r="58" fill={dark} /><circle cx="140" cy="530" r="34" {...acc} strokeWidth="11" /><circle cx="140" cy="530" r="16" fill={dark} /></>;
}

function Pattern({ kind, visor, head, clip, clipLow }: { kind: AvatarPattern; visor: AvatarVisor; head: AvatarHead; clip: string; clipLow: string }) {
  const v = VISOR[visor], h = HEAD[head];
  const glow = (d: string, w = 18) => <g fill="none" stroke="currentColor" strokeLinecap="round"><path d={d} strokeWidth={w * 2.6} strokeOpacity="0.2" /><path d={d} strokeWidth={w} /></g>;
  if (kind === "pattern-02") return <g clipPath={`url(#${clip})`}>{glow("M170 600Q500 690 720 880")}{glow("M830 600Q500 690 280 880")}</g>;
  // Menton: el propio contorno del casco, solo su mitad interior y solo abajo.
  if (kind === "pattern-03") return <g clipPath={`url(#${clip})`}><g clipPath={`url(#${clipLow})`}>{glow(h.d, 30)}</g></g>;
  if (kind === "pattern-04") return glow(v.crown ?? crownPath(v.box));
  if (kind === "pattern-05") return <>{glow(`M500 ${h.top + 30}V${v.box.y - 22}`)}{glow(`M500 ${v.box.y + v.box.h + 22}V${h.bottom - 34}`)}</>;
  return glow(v.halo ?? haloPath(v.box));
}

function Detail({ kind, shell, head }: { kind: AvatarDetail; shell: string; head: AvatarHead }) {
  const dark = "#11141d";
  const b = HEAD[head].brow;
  if (kind === "detail-01") return <g id="secondary-detail" className="aa-detail"><path d="M660 340L738 125" stroke={dark} strokeOpacity="0.35" strokeWidth="34" strokeLinecap="round" /><path d="M660 340L738 125" stroke={shell} strokeWidth="24" strokeLinecap="round" /><circle cx="738" cy="125" r="26" fill="currentColor" opacity="0.28" /><circle cx="738" cy="125" r="15" fill="currentColor" /></g>;
  if (kind === "detail-02") return <g id="secondary-detail" className="aa-detail"><path d="M560 340Q600 120 740 130Q700 175 700 340Z" fill={shell} stroke={dark} strokeOpacity="0.3" strokeWidth="8" /></g>;
  if (kind === "detail-03") return <g id="secondary-detail" className="aa-detail" transform={`translate(${b.x} ${b.y}) rotate(-18)`}><rect x="-60" y="-22" width="120" height="44" rx="12" fill={dark} /><rect x="-38" y="-14" width="18" height="28" rx="4" fill="#ffffff" opacity="0.85" /><rect x="-8" y="-14" width="10" height="28" rx="3" fill="currentColor" /></g>;
  return <g id="secondary-detail" className="aa-detail" transform={`translate(${b.x} ${b.y})`}><circle r="32" fill={dark} /><circle r="18" fill="none" stroke="currentColor" strokeWidth="7" /><circle cx="-9" cy="-9" r="5" fill="#ffffff" opacity="0.7" /></g>;
}

export default function AgentAvatar({ agent, identity: identityProp, role, seed, state: stateProp, expression: expressionProp, size = "lg", indicator, label, className = "" }: {
  /** Preferido: el componente resuelve identidad, rol y estado del agente. */
  agent?: AgentLike;
  /** Contextos aislados: identidad explicita. */
  identity?: AgentAvatarIdentity;
  /** Atajo: rol (+ seed = id del agente) cuando no hay objeto agente. */
  role?: string;
  seed?: string;
  state?: AgentAvatarState;
  /** Sobrescribe la expresion por defecto del estado (estado != expresion). */
  expression?: AgentAvatarExpression;
  size?: AvatarSize | number;
  indicator?: AvatarIndicator | null;
  label?: string;
  className?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const id = identityProp ?? (agent ? resolveIdentity(agent) : resolveIdentity({ id: seed ?? role ?? "guest", role: role ?? "guest" }));
  const accent = agent?.custody === "1claw" ? accentFor(id.role, { custody: "1claw" }) : id.accent;
  const cfg = roleConfig(id.role);
  const state: AgentAvatarState = stateProp ?? agent?.runtimeState ?? "idle";
  const st = AGENT_STATES[state];
  const expression = expressionProp ?? st.expression;
  const px = typeof size === "number" ? size : AVATAR_SIZES[size];
  // Detalle progresivo (seccion 55): xs/sm silueta + visor + ojos + acento; md/lg + simbolo, anillo; xl + detalle, brillos.
  const tier = px < 44 ? 0 : px < 80 ? 1 : 2;
  const ring = st.ring ? RING[st.ring] : null;
  const rim = RIM[state];
  const name = label ?? agent?.name ?? cfg.label;
  const head = HEAD[id.head], visor = VISOR[id.visor];
  const shell = `url(#sh-${uid})`, clip = `hc-${uid}`, clipLow = `lc-${uid}`;
  const gap = 100;
  return (
    <span className={`agent-avatar ${className}`} data-role={id.role} data-state={state} data-mode={st.mode} data-expression={expression} role="img" aria-label={`${name}, ${cfg.label} agent, ${state}`} style={{ width: px, height: px, color: accent }}>
      <svg viewBox="0 0 1000 1000" width={px} height={px} aria-hidden>
        <defs>
          <radialGradient id={`sh-${uid}`} cx="36%" cy="22%" r="90%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="52%" stopColor="#e9ecf2" />
            <stop offset="100%" stopColor="#a3abbb" />
          </radialGradient>
          <radialGradient id={`vi-${uid}`} cx="50%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#1a1e2b" />
            <stop offset="100%" stopColor="#030408" />
          </radialGradient>
          <linearGradient id={`gl-${uid}`} x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clip}><path d={head.d} /></clipPath>
          <clipPath id={clipLow}><rect x="0" y="700" width="1000" height="300" /></clipPath>
          {tier > 0 ? (
            <>
              <clipPath id={`vc-${uid}`}><path d={visor.d} /></clipPath>
              {/* Materiales: sombra interior del casco, especular, reflejo del vidrio, sombra ambiente. Solo gradientes. */}
              <linearGradient id={`ao-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="68%" stopColor="#3a3f4d" stopOpacity="0" />
                <stop offset="100%" stopColor="#2a2e3a" stopOpacity="0.32" />
              </linearGradient>
              <radialGradient id={`sp-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`rf-${uid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
                <stop offset="38%" stopColor="#ffffff" stopOpacity="0.05" />
                <stop offset="42%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <radialGradient id={`sh2-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#000000" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
            </>
          ) : null}
          {tier > 1 ? <filter id={`bl-${uid}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16" /></filter> : null}
        </defs>
        {tier > 0 ? <ellipse cx="500" cy="880" rx="330" ry="48" fill={`url(#sh2-${uid})`} /> : null}

        {ring && tier > 0 ? (
          <g id="state-ring" className="aa-ring" style={{ color: ring.color }}>
            {tier > 1 ? <circle cx="500" cy="500" r="470" fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="18" strokeDasharray={ring.dash} filter={`url(#bl-${uid})`} /> : null}
            <circle cx="500" cy="500" r="470" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="38" />
            <circle cx="500" cy="500" r="470" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeDasharray={ring.dash} />
          </g>
        ) : null}

        {tier > 1 && (id.secondaryDetail === "detail-01" || id.secondaryDetail === "detail-02") ? <Detail kind={id.secondaryDetail} shell={shell} head={id.head} /> : null}

        <g id="modules" className="aa-modules">
          {tier > 1 && (id.modules === "module-02" || id.modules === "module-03" || id.modules === "module-05") ? (
            <g className="aa-module-glow" opacity="0.6" filter={`url(#bl-${uid})`} fill="none" stroke="currentColor" strokeWidth="18">
              {id.modules === "module-02" ? <><ellipse cx="145" cy="530" rx="26" ry="52" /><ellipse cx="855" cy="530" rx="26" ry="52" /></> : null}
              {id.modules === "module-05" ? <><circle cx="140" cy="530" r="34" /><circle cx="860" cy="530" r="34" /></> : null}
              {id.modules === "module-03" ? <><path d="M215 440C150 470 140 510 146 555C151 590 165 615 210 638" /><path d="M785 440C850 470 860 510 854 555C849 590 835 615 790 638" /></> : null}
            </g>
          ) : null}
          <g id="module-left" className="aa-module"><Module kind={id.modules} shell={shell} /></g>
          <g id="module-right" className="aa-module" transform="translate(1000 0) scale(-1 1)"><Module kind={id.modules} shell={shell} /></g>
        </g>

        {rim ? <g id="state-rim" className="aa-rim" style={{ color: rim }}>{tier > 1 ? <path d={head.d} fill="none" stroke="currentColor" strokeWidth="40" strokeOpacity="0.75" filter={`url(#bl-${uid})`} /> : <path d={head.d} fill="none" stroke="currentColor" strokeWidth="70" strokeOpacity="0.14" />}<path d={head.d} fill="none" stroke="currentColor" strokeWidth="26" strokeOpacity="0.4" /></g> : null}
        <g id="shell">
          <path d={head.d} fill={shell} />
          {tier > 0 ? (
            <g clipPath={`url(#${clip})`}>
              <rect x="0" y="0" width="1000" height="1000" fill={`url(#ao-${uid})`} />
              <ellipse cx="410" cy="255" rx="190" ry="62" fill={`url(#sp-${uid})`} transform="rotate(-8 410 255)" />
              <path d={head.d} fill="none" stroke={`url(#rim-${uid})`} strokeWidth="14" />
            </g>
          ) : null}
          <path d={head.d} fill="none" stroke="#0b0e16" strokeOpacity="0.32" strokeWidth="8" />
        </g>

        <g id="role-accent" className="aa-accent">
          {tier > 1 ? <g className="aa-accent-glow" opacity="0.7" filter={`url(#bl-${uid})`}><Pattern kind={id.pattern} visor={id.visor} head={id.head} clip={clip} clipLow={clipLow} /></g> : null}
          <Pattern kind={id.pattern} visor={id.visor} head={id.head} clip={clip} clipLow={clipLow} />
        </g>
        {tier > 1 && (id.secondaryDetail === "detail-03" || id.secondaryDetail === "detail-04") ? <Detail kind={id.secondaryDetail} shell={shell} head={id.head} /> : null}

        <g id="visor">
          <path d={visor.d} fill="#0a0c12" />
          <g transform="translate(500 517) scale(0.965) translate(-500 -517)"><path d={visor.d} fill={`url(#vi-${uid})`} /></g>
          {tier > 0 ? (
            <g clipPath={`url(#vc-${uid})`}>
              <rect x="0" y="0" width="1000" height="1000" fill={`url(#rf-${uid})`} />
              <ellipse cx="500" cy="700" rx="230" ry="60" fill="currentColor" opacity="0.10" />
              <path d={visor.d} fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="6" />
            </g>
          ) : null}
        </g>

        {tier > 1 ? <g className="aa-eyes-glow" opacity="0.55" filter={`url(#bl-${uid})`}><Eyes expression={expression} scale={visor.eyeScale * 1.06} gap={gap} glow /></g> : null}
        <Eyes expression={expression} scale={visor.eyeScale} gap={gap} />

        {tier > 0 ? (
          <g id="role-symbol" className="aa-symbol">
            {/* El glow va fuera del grupo escalado: el desenfoque se mide en unidades del lienzo. */}
            {tier > 1 ? <circle cx="800" cy="800" r="92" fill="currentColor" opacity="0.4" filter={`url(#bl-${uid})`} /> : null}
            <g transform="translate(800 800) scale(7.6)">
            <circle r="12.5" fill="#080a10" />
            <circle r="12.5" fill="none" stroke="#ffffff" strokeOpacity="0.16" />
            <circle r="10.2" fill="#10131c" />
            <Symbol kind={cfg.symbol} />
            </g>
          </g>
        ) : null}

        {indicator ? (
          <g id="status-indicator" className="aa-status" transform="translate(815 190)">
            {tier > 1 ? <circle r="44" fill={INDICATOR[indicator]} opacity="0.6" filter={`url(#bl-${uid})`} /> : null}
            <circle r="58" fill="#080a10" />
            <circle r="40" fill={INDICATOR[indicator]} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

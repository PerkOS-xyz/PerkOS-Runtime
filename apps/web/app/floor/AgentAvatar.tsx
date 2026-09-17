"use client";

import { useId } from "react";

// Avatar de agente PerkOS. Fuentes: vault PerkOS-Avatars/ (estandar + sistema de
// composicion) y assets/avatar-system.png (hoja de piezas). Misma familia que
// Sparky sin competir con el: casco de ceramica, visor ovalado de vidrio negro,
// ojos de neon. Lo que es SOLO de Sparky no aparece aqui: la llama, el degradado
// rosa/naranja, el destello de cuatro puntas y las orejeras redondas (los agentes
// llevan MODULOS, las aletas de la hoja). IDENTIDAD = halo de acento alrededor del
// visor + simbolo del rol (persisten). ESTADO = ojos, anillo y animacion (cambian).
// SVG puro con grupos nombrados, animable por CSS con [data-state].
// Sparky nunca usa este componente: es identidad de sistema, no un rol.

export type AgentAvatarState = "idle" | "listening" | "thinking" | "working" | "waiting" | "success" | "warning" | "error" | "offline";
export type AgentSymbol = "search" | "shield" | "chart" | "check" | "build" | "coins" | "gear" | "users" | "bullhorn" | "dot";

// Registro central de roles: acento y simbolo. El casco sigue neutro.
export const AGENT_ROLES: Record<string, { accent: string; symbol: AgentSymbol; label: string }> = {
  // PerkOS Floor Desk (colores que ya tenia cada agente en la escena)
  scout: { accent: "#3d8bff", symbol: "search", label: "Scout" },
  risk: { accent: "#ffb020", symbol: "shield", label: "Risk" },
  trader: { accent: "#a45cff", symbol: "chart", label: "Trader" },
  auditor: { accent: "#22d3c5", symbol: "check", label: "Auditor" },
  // Hoja de assets (otros desks)
  research: { accent: "#3d8bff", symbol: "search", label: "Research" },
  qa: { accent: "#3ddc4a", symbol: "check", label: "QA" },
  builder: { accent: "#ff8a1f", symbol: "build", label: "Builder" },
  analyst: { accent: "#a45cff", symbol: "chart", label: "Analyst" },
  finance: { accent: "#22d3c5", symbol: "coins", label: "Finance" },
  ops: { accent: "#ffc21a", symbol: "gear", label: "Ops" },
  sales: { accent: "#5b6cff", symbol: "users", label: "Sales" },
  growth: { accent: "#f03ab7", symbol: "bullhorn", label: "Growth" },
  guest: { accent: "#9aabc8", symbol: "dot", label: "Guest" }
};

// Anillo de estado: el color es del ESTADO, no del rol (hoja de assets).
const RING: Record<AgentAvatarState, { color: string; dash?: string }> = {
  idle: { color: "#f2f4f8" },
  listening: { color: "#3d8bff" },
  thinking: { color: "#2fd0e6", dash: "26 14" },
  working: { color: "#2fd0e6", dash: "46 16" },
  waiting: { color: "#ffb020", dash: "70 12" },
  success: { color: "#3ddc4a" },
  warning: { color: "#ffb020" },
  error: { color: "#ff4a4a", dash: "22 10" },
  offline: { color: "#8b93a3", dash: "8 9" }
};

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function Symbol({ kind }: { kind: AgentSymbol }) {
  // Trazo de neon sobre boton oscuro; caben en un circulo de radio 8 centrado en (0,0).
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "search") return <g {...p}><circle cx="-1.4" cy="-1.4" r="3.8" /><path d="M1.6 1.6L5.4 5.4" /></g>;
  if (kind === "shield") return <g {...p}><path d="M0 -5.6L4.8 -3.6V0.6C4.8 3.4 2.6 5 0 5.8C-2.6 5 -4.8 3.4 -4.8 0.6V-3.6Z" /></g>;
  if (kind === "chart") return <g fill="currentColor"><rect x="-5.4" y="0.6" width="2.8" height="4.6" rx="0.8" /><rect x="-1.4" y="-2" width="2.8" height="7.2" rx="0.8" /><rect x="2.6" y="-5.2" width="2.8" height="10.4" rx="0.8" /></g>;
  if (kind === "check") return <g {...p} strokeWidth="2.4"><path d="M-4.6 0.2L-1.4 3.4L4.8 -3.2" /></g>;
  if (kind === "build") return <g fill="currentColor"><rect x="-5" y="0.2" width="4.6" height="4.6" rx="0.9" /><rect x="0.4" y="0.2" width="4.6" height="4.6" rx="0.9" /><rect x="-2.3" y="-5" width="4.6" height="4.6" rx="0.9" /></g>;
  if (kind === "coins") return <g {...p}><ellipse cx="0" cy="-3" rx="4.6" ry="1.9" /><path d="M-4.6 -3V0.2C-4.6 1.3 -2.5 2.1 0 2.1S4.6 1.3 4.6 0.2V-3" /><path d="M-4.6 0.2V3.4C-4.6 4.5 -2.5 5.3 0 5.3S4.6 4.5 4.6 3.4V0.2" /></g>;
  if (kind === "gear") return <g {...p}><circle cx="0" cy="0" r="2.1" /><path d="M0 -5.6V-3.8M0 3.8V5.6M-5.6 0H-3.8M3.8 0H5.6M-4 -4L-2.7 -2.7M2.7 2.7L4 4M-4 4L-2.7 2.7M2.7 -2.7L4 -4" /></g>;
  if (kind === "users") return <g fill="currentColor"><circle cx="0" cy="-3" r="2.1" /><path d="M-3.4 4.8V2.6C-3.4 1.2 -2.2 0.4 0 0.4S3.4 1.2 3.4 2.6V4.8Z" /><circle cx="-5" cy="-1.2" r="1.5" opacity="0.8" /><circle cx="5" cy="-1.2" r="1.5" opacity="0.8" /></g>;
  if (kind === "bullhorn") return <g {...p}><path d="M-5 -1.4H-2.6L3.6 -4.8V4.8L-2.6 1.4H-5Z" /><path d="M-3.2 1.6L-2.2 5" /></g>;
  return <circle cx="0" cy="0" r="2.6" fill="currentColor" />;
}

function Eyes({ state, gap, glow = false }: { state: AgentAvatarState; gap: number; glow?: boolean }) {
  // La copia de brillo no lleva ids (no se anima por separado ni duplica ids en el DOM).
  const idL = glow ? undefined : "eye-left", idR = glow ? undefined : "eye-right";
  // Formas de la hoja de assets. El color es el acento del rol; la forma dice el estado.
  const L = 64 - gap, R = 64 + gap; // centros de cada ojo
  const pill = (cx: number, w: number, hh: number, id: string | undefined, rot = 0) => <rect id={id} className="aa-eye" x={cx - w / 2} y={66 - hh / 2} width={w} height={hh} rx={w / 2} transform={rot ? `rotate(${rot} ${cx} 66)` : undefined} />;
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 4.6, strokeLinecap: "round" as const };
  if (state === "success") return <g className="aa-eyes" {...stroke}><path id={idL} className="aa-eye" d={`M${L - 7} 71Q${L} 58 ${L + 7} 71`} /><path id={idR} className="aa-eye" d={`M${R - 7} 71Q${R} 58 ${R + 7} 71`} /></g>;
  if (state === "error") return <g className="aa-eyes" {...stroke} strokeWidth="4"><path id={idL} className="aa-eye" d={`M${L - 5.5} 60.5L${L + 5.5} 71.5M${L + 5.5} 60.5L${L - 5.5} 71.5`} /><path id={idR} className="aa-eye" d={`M${R - 5.5} 60.5L${R + 5.5} 71.5M${R + 5.5} 60.5L${R - 5.5} 71.5`} /></g>;
  if (state === "offline") return <g className="aa-eyes" fill="currentColor"><rect id={idL} className="aa-eye" x={L - 7} y="64.4" width="14" height="3.4" rx="1.7" /><rect id={idR} className="aa-eye" x={R - 7} y="64.4" width="14" height="3.4" rx="1.7" /></g>;
  // thinking: medias lunas de tapa plana (EYES - THINKING)
  if (state === "thinking") return <g className="aa-eyes" fill="currentColor"><path id={idL} className="aa-eye" d={`M${L - 8} 62H${L + 8}A8 8 0 0 1 ${L - 8} 62Z`} /><path id={idR} className="aa-eye" d={`M${R - 8} 62H${R + 8}A8 8 0 0 1 ${R - 8} 62Z`} /></g>;
  // working: cunas inclinadas hacia el centro (EYES - FOCUSED)
  if (state === "working") return <g className="aa-eyes" fill="currentColor"><path id={idL} className="aa-eye" d={`M${L - 8} 60Q${L - 7} 74 ${L + 8} 72Q${L + 3} 62 ${L - 8} 60Z`} /><path id={idR} className="aa-eye" d={`M${R + 8} 60Q${R + 7} 74 ${R - 8} 72Q${R - 3} 62 ${R + 8} 60Z`} /></g>;
  // listening: medias lunas (EYES - LISTENING)
  if (state === "listening") return <g className="aa-eyes" fill="currentColor"><path id={idL} className="aa-eye" d={`M${L + 4} 55A11.5 11.5 0 1 0 ${L + 4} 77A8 9 0 1 1 ${L + 4} 55Z`} /><path id={idR} className="aa-eye" d={`M${R + 4} 55A11.5 11.5 0 1 0 ${R + 4} 77A8 9 0 1 1 ${R + 4} 55Z`} /></g>;
  if (state === "warning") return <g className="aa-eyes" fill="currentColor">{pill(L, 11, 27, idL)}{pill(R, 11, 27, idR)}</g>;
  if (state === "waiting") return <g className="aa-eyes" fill="currentColor">{pill(L, 10, 20, idL, -12)}{pill(R, 10, 20, idR, 12)}</g>;
  return <g className="aa-eyes" fill="currentColor">{pill(L, 10, 23, idL)}{pill(R, 10, 23, idR)}</g>;
}

export default function AgentAvatar({ role, state = "idle", size = 64, seed, label, className = "" }: {
  role: string;
  state?: AgentAvatarState;
  size?: number;
  /** Id del agente: variaciones minimas y deterministas dentro del mismo rol. */
  seed?: string;
  label?: string;
  className?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const cfg = AGENT_ROLES[role] ?? AGENT_ROLES.guest;
  const h = hash(seed ?? role);
  const gap = 13 + ((h % 3) - 1);       // separacion de ojos: 12, 13 o 14
  const small = size < 44;              // a 24-32 px: sin simbolo ni anillo (estandar, seccion 16)
  const ring = RING[state];
  const name = label ?? cfg.label;
  return (
    <span className={`agent-avatar ${className}`} data-role={role} data-state={state} role="img" aria-label={`${name} agent, ${state}`} style={{ width: size, height: size, color: cfg.accent }}>
      <svg viewBox="0 0 128 128" width={size} height={size} aria-hidden>
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
        </defs>

        {!small ? (
          <g id="state-ring" className="aa-ring" style={{ color: ring.color }}>
            <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="5" />
            <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={ring.dash} />
          </g>
        ) : null}

        {/* Modulos laterales (aletas): los agentes no llevan las orejeras con destello de Sparky. */}
        <g id="module-left" className="aa-module"><path d="M22 50C12 52 8 60 9 70C10 80 15 86 23 87Z" fill={`url(#sh-${uid})`} /><path d="M22 53C15 56 12 62 13 70C14 77 17 82 23 84Z" fill="#11141d" /><path d="M21.6 56C17.4 60 16.4 66 17.2 71.6C17.8 75.8 19.4 79 22.6 81.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></g>
        <g id="module-right" className="aa-module"><path d="M106 50C116 52 120 60 119 70C118 80 113 86 105 87Z" fill={`url(#sh-${uid})`} /><path d="M106 53C113 56 116 62 115 70C114 77 111 82 105 84Z" fill="#11141d" /><path d="M106.4 56C110.6 60 111.6 66 110.8 71.6C110.2 75.8 108.6 79 105.4 81.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></g>

        <g id="shell"><rect x="19" y="27" width="90" height="80" rx="40" fill={`url(#sh-${uid})`} /><rect x="19" y="27" width="90" height="80" rx="40" fill="none" stroke="#0b0e16" strokeOpacity="0.3" /></g>

        <g id="visor"><rect x="27" y="42" width="74" height="48" rx="24" fill="#0a0c12" /><rect x="29" y="44" width="70" height="44" rx="22" fill={`url(#vi-${uid})`} /><rect x="29" y="44" width="70" height="44" rx="22" fill={`url(#gl-${uid})`} /></g>

        {/* Acento del rol: halo de neon que abraza el visor por debajo (dos trazos hacen el brillo, sin filtros). */}
        <g id="role-accent" className="aa-accent" fill="none" stroke="currentColor" strokeLinecap="round"><path d="M25.5 63C25.5 84 40 93.5 64 93.5S102.5 84 102.5 63" strokeWidth="6" strokeOpacity="0.22" /><path d="M25.5 63C25.5 84 40 93.5 64 93.5S102.5 84 102.5 63" strokeWidth="2.2" /></g>

        <g className="aa-eyes-glow" opacity="0.28" transform="translate(64 66) scale(1.22) translate(-64 -66)"><Eyes state={state} gap={gap} glow /></g>
        <Eyes state={state} gap={gap} />

        {!small ? (
          <g id="role-symbol" className="aa-symbol" transform="translate(64 108)">
            <circle r="12.5" fill="#080a10" />
            <circle r="12.5" fill="none" stroke="#ffffff" strokeOpacity="0.16" />
            <circle r="10.2" fill="#10131c" />
            <Symbol kind={cfg.symbol} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

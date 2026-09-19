// Identidad de avatar de agente PerkOS: logica pura, sin React.
// Fuentes: vault PerkOS-Avatars/PerkOS-Agent-Identity-System.md y
// PerkOS-Avatar-Asset-Kit-Usage.md (v0.2) + assets/avatar-system-extra.png (hoja del kit).
// Modelo: IDENTIDAD PERMANENTE + ROL + EXPRESION + ESTADO = avatar visible. Cuatro dimensiones separadas:
//   IDENTIDAD  (cabeza, visor, modulos, patron, detalle): del agente, persiste, nunca cambia.
//   ROL        (acento, simbolo): persiste pero no es la identidad; dos Research se distinguen por la estructura.
//   EXPRESION  (ojos): cambia sin tocar la identidad.
//   ESTADO     (anillo, brillo, animacion): runtime, nunca se guarda en la identidad.
// Sparky queda fuera del generador: es el sistema, no un rol.

export const AVATAR_KIT_VERSION = 1;

export const HEADS = ["head-01", "head-02", "head-03", "head-04", "head-05"] as const;
export const VISORS = ["visor-01", "visor-02", "visor-03", "visor-04"] as const;
export const MODULES = ["module-01", "module-02", "module-03", "module-04", "module-05"] as const;
export const PATTERNS = ["pattern-01", "pattern-02", "pattern-03", "pattern-04", "pattern-05"] as const;
export const DETAILS = ["detail-01", "detail-02", "detail-03", "detail-04"] as const;

export type AvatarHead = (typeof HEADS)[number];
export type AvatarVisor = (typeof VISORS)[number];
export type AvatarModules = (typeof MODULES)[number];
export type AvatarPattern = (typeof PATTERNS)[number];
export type AvatarDetail = (typeof DETAILS)[number];

export const PART_NAMES: Record<string, string> = {
  "head-01": "Classic", "head-02": "Wide", "head-03": "Sphere", "head-04": "Dome", "head-05": "Squircle",
  "visor-01": "Oval", "visor-02": "Panel", "visor-03": "Trapeze", "visor-04": "Leaf",
  "module-01": "Pod", "module-02": "Light pod", "module-03": "Fin", "module-04": "Plate", "module-05": "Ring",
  "pattern-01": "Halo", "pattern-02": "Cross", "pattern-03": "Chin", "pattern-04": "Crown", "pattern-05": "Stripe",
  "detail-01": "Antenna", "detail-02": "Crest", "detail-03": "Badge plate", "detail-04": "Lens"
};

/** Codigo corto como en la hoja: H04 V02 M05 P03 D02. */
export const shortCode = (id: { head: string; visor: string; modules: string; pattern: string; secondaryDetail: string }) =>
  [id.head, id.visor, id.modules, id.pattern, id.secondaryDetail].map((p) => p[0].toUpperCase() + p.slice(p.indexOf("-") + 1)).join(" ");

/** Lo que se persiste con el agente. Nada transitorio (thinking, happy, error, hibernating) vive aqui. */
export type AgentAvatarIdentity = {
  version: number;
  head: AvatarHead;
  visor: AvatarVisor;
  modules: AvatarModules;
  pattern: AvatarPattern;
  secondaryDetail: AvatarDetail;
  role: string;
  accent: string;
};

export type AgentAvatarState = "idle" | "listening" | "thinking" | "working" | "waiting" | "success" | "warning" | "error" | "offline" | "hibernating";
export type AgentAvatarExpression = "idle" | "happy" | "curious" | "thinking" | "focused" | "listening" | "surprised" | "determined" | "concerned" | "success" | "error" | "sleepy";
export type AgentAvatarMode = "active" | "offline" | "hibernating";

export const STATES: AgentAvatarState[] = ["idle", "listening", "thinking", "working", "waiting", "success", "warning", "error", "offline", "hibernating"];
export const EXPRESSIONS: AgentAvatarExpression[] = ["idle", "happy", "curious", "thinking", "focused", "listening", "surprised", "determined", "concerned", "success", "error", "sleepy"];

/**
 * Presentacion por defecto de cada estado (Asset Kit, secciones 24 y 52). La app puede pasar otra
 * expresion: estado != expresion. Hibernar NO es estar offline ni en error: el agente existe,
 * conserva su identidad y esta dormido, listo para despertar.
 */
export const AGENT_STATES: Record<AgentAvatarState, { expression: AgentAvatarExpression; ring: AgentAvatarState | null; mode: AgentAvatarMode }> = {
  idle: { expression: "idle", ring: "idle", mode: "active" },
  listening: { expression: "listening", ring: "listening", mode: "active" },
  thinking: { expression: "thinking", ring: "thinking", mode: "active" },
  working: { expression: "focused", ring: "working", mode: "active" },
  waiting: { expression: "curious", ring: "waiting", mode: "active" },
  success: { expression: "success", ring: "success", mode: "active" },
  warning: { expression: "concerned", ring: "warning", mode: "active" },
  error: { expression: "error", ring: "error", mode: "active" },
  offline: { expression: "idle", ring: "offline", mode: "offline" },
  hibernating: { expression: "sleepy", ring: null, mode: "hibernating" }
};

/** Tamanos semanticos (seccion 54). */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "profile";
export const AVATAR_SIZES: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 48, lg: 64, xl: 96, profile: 160 };

export type AgentSymbol = "build" | "review" | "check" | "help" | "search" | "chart" | "book" | "flow" | "trade" | "gear" | "users" | "handshake" | "megaphone" | "shield" | "dot";

/**
 * Rojo de marca de 1Claw (assets/1claw-round-dark.svg) y su version de neon para el visor oscuro.
 * El agente que opera con 1Claw lleva acentos rojos: plano, nunca en degradado (el degradado es de Sparky).
 */
export const ONECLAW_RED = "#DF171A";
export const ONECLAW_ACCENT = "#f0262a";

// Registro central de roles (seccion 50): acento y simbolo, separado de la estructura. El casco sigue neutro.
export const AGENT_ROLES: Record<string, { accent: string; symbol: AgentSymbol; label: string }> = {
  // Los 14 roles de la hoja del kit
  builder: { accent: "#ff8a1f", symbol: "build", label: "Builder" },
  reviewer: { accent: "#a45cff", symbol: "review", label: "Reviewer" },
  qa: { accent: "#3ddc4a", symbol: "check", label: "QA" },
  support: { accent: "#ff6a4d", symbol: "help", label: "Support" },
  research: { accent: "#3d8bff", symbol: "search", label: "Research" },
  analyst: { accent: "#8f6bff", symbol: "chart", label: "Analyst" },
  knowledge: { accent: "#ffb020", symbol: "book", label: "Knowledge" },
  workflow: { accent: "#22d3ee", symbol: "flow", label: "Workflow" },
  trader: { accent: "#35e08a", symbol: "trade", label: "Trader" },
  ops: { accent: "#ffc21a", symbol: "gear", label: "Ops" },
  concierge: { accent: "#b9a5ff", symbol: "users", label: "Concierge" },
  sales: { accent: "#5b6cff", symbol: "handshake", label: "Sales" },
  growth: { accent: "#f03ab7", symbol: "megaphone", label: "Growth" },
  security: { accent: "#22d3c5", symbol: "shield", label: "Security" },
  // PerkOS Floor Desk
  scout: { accent: "#3d8bff", symbol: "search", label: "Scout" },
  risk: { accent: "#ffb020", symbol: "shield", label: "Risk" },
  auditor: { accent: "#22d3c5", symbol: "check", label: "Auditor" },
  // El invitado no es de la casa y tiene que verse: acento del bot que lo trae
  // (Grok) en vez del gris neutro, para que en la mesa se lea de un vistazo
  // quien es plantilla y quien viene de fuera.
  guest: { accent: "#ff4d8d", symbol: "dot", label: "Guest" }
};
/** La hoja dice Marketing; en PerkOS ese rol se llama Growth. */
export const ROLE_ALIASES: Record<string, string> = { marketing: "growth" };
export const roleConfig = (role: string) => AGENT_ROLES[ROLE_ALIASES[role] ?? role] ?? AGENT_ROLES.guest;

/** Acento de un agente: el de su rol, salvo que opere con 1Claw (rojo 1Claw). */
export function accentFor(role: string, opts: { custody?: "1claw" | null } = {}): string {
  return opts.custody === "1claw" ? ONECLAW_ACCENT : roleConfig(role).accent;
}

// --- Compatibilidad: la calidad visual manda sobre el numero de combinaciones (seccion 53).
export const AVATAR_COMPATIBILITY: Record<AvatarHead, { visors: AvatarVisor[]; modules: AvatarModules[]; details: AvatarDetail[] }> = {
  "head-01": { visors: ["visor-01", "visor-02", "visor-03", "visor-04"], modules: ["module-01", "module-02", "module-03", "module-04", "module-05"], details: ["detail-01", "detail-02", "detail-03", "detail-04"] },
  // Wide: cabeza baja y ancha. El trapecio alto se come la frente; no hay frente para placa ni lente.
  "head-02": { visors: ["visor-01", "visor-02", "visor-04"], modules: ["module-01", "module-02", "module-03", "module-04", "module-05"], details: ["detail-01", "detail-02"] },
  // Sphere: el panel recto toca el borde de la esfera.
  "head-03": { visors: ["visor-01", "visor-03", "visor-04"], modules: ["module-01", "module-02", "module-03", "module-05"], details: ["detail-01", "detail-02", "detail-03", "detail-04"] },
  "head-04": { visors: ["visor-01", "visor-02", "visor-03", "visor-04"], modules: ["module-01", "module-02", "module-03", "module-04"], details: ["detail-01", "detail-02", "detail-03", "detail-04"] },
  "head-05": { visors: ["visor-02", "visor-03", "visor-04"], modules: ["module-02", "module-03", "module-04", "module-05"], details: ["detail-01", "detail-02", "detail-03", "detail-04"] }
};

type Partial5 = Partial<Pick<AgentAvatarIdentity, "head" | "visor" | "modules" | "pattern" | "secondaryDetail">>;

/** Exclusiones explicitas: piezas que se pisan o se leen mal en pequeno (seccion 54). */
export const FORBIDDEN_COMBINATIONS: Partial5[] = [
  { pattern: "pattern-04", secondaryDetail: "detail-03" }, // la corona pasa por la frente y pisa la placa
  { pattern: "pattern-04", secondaryDetail: "detail-04" }, // la corona pisa el lente
  { head: "head-02", pattern: "pattern-04" },              // cabeza baja: la corona no cabe sobre el visor
  { modules: "module-03", secondaryDetail: "detail-02" }   // aletas laterales + cresta: demasiadas puntas
];

// --- Proteccion de Sparky (secciones 9, 10, 50, 51). Sparky es dueno de: la llama, el degradado
// #EC1B69 -> #F56A57, el destello de cuatro puntas, las orejeras redondas con destello y su silueta
// (cabeza redonda + visor ovalado + orejeras redondas). Reglas:
//   1. Ningun acento puede caer en el rosa de Sparky.
//   2. Cabeza redonda + visor ovalado + pods redondos queda reservado para cualquier color.
//   3. Un agente de acento calido (rojo, rosa, naranja) nunca lleva cabeza redonda + visor ovalado
//      ni la cresta superior (podria leerse como llama).
//   4. El acento siempre es plano: los degradados son de Sparky.
//   5. Ningun simbolo usa el destello de cuatro puntas (el "Review" de la hoja se dibuja como rombo).
export const SPARKY_PINK = "#EC1B69";
export const SPARKY_CORAL = "#F56A57";

export function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Acento reservado: demasiado cerca del rosa de Sparky. */
export function accentReserved(accent: string): boolean {
  const a = hsl(accent);
  return a.s > 0.45 && hueGap(a.h, hsl(SPARKY_PINK).h) < 12;
}
/** Acento calido: rojo, rosa, magenta o naranja. */
export function accentWarm(accent: string): boolean {
  const a = hsl(accent);
  return a.s > 0.35 && (a.h >= 300 || a.h <= 40);
}

export const RESERVED_IDENTITIES: Partial5[] = [
  { head: "head-01", visor: "visor-01", modules: "module-01" },
  { head: "head-01", visor: "visor-01", modules: "module-05" },
  { head: "head-03", visor: "visor-01", modules: "module-01" },
  { head: "head-03", visor: "visor-01", modules: "module-05" }
];

const matches = (id: Partial5, rule: Partial5) => (Object.keys(rule) as (keyof Partial5)[]).every((k) => id[k] === rule[k]);

export function isForbidden(id: Partial5): boolean { return FORBIDDEN_COMBINATIONS.some((r) => matches(id, r)); }
export function isReserved(id: Partial5 & { accent?: string }): boolean {
  if (RESERVED_IDENTITIES.some((r) => matches(id, r))) return true;
  if (id.accent && accentReserved(id.accent)) return true;
  if (id.accent && accentWarm(id.accent)) {
    if ((id.head === "head-01" || id.head === "head-03") && id.visor === "visor-01") return true;
    if (id.secondaryDetail === "detail-02") return true;
  }
  return false;
}
export function isCompatible(id: Partial5): boolean {
  if (!id.head) return true;
  const c = AVATAR_COMPATIBILITY[id.head];
  return (!id.visor || c.visors.includes(id.visor)) && (!id.modules || c.modules.includes(id.modules)) && (!id.secondaryDetail || c.details.includes(id.secondaryDetail));
}
export function isValidIdentity(id: AgentAvatarIdentity): boolean { return isCompatible(id) && !isForbidden(id) && !isReserved(id); }

/** Clave canonica de la estructura (seccion 41). El color no entra: no crea identidad por si solo. */
export function identityKey(id: AgentAvatarIdentity): string {
  return [id.version, id.head, id.visor, id.modules, id.pattern, id.secondaryDetail].join(":");
}

/** Distancia visual ponderada (seccion 42). El color del rol no suma (seccion 43). */
export function avatarDistance(a: AgentAvatarIdentity, b: AgentAvatarIdentity): number {
  let d = 0;
  if (a.head !== b.head) d += 4;
  if (a.visor !== b.visor) d += 3;
  if (a.modules !== b.modules) d += 3;
  if (a.pattern !== b.pattern) d += 2;
  if (a.secondaryDetail !== b.secondaryDetail) d += 1;
  return d;
}

export const hashId = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Candidato determinista: mismo seed + intento + rol = misma estructura. */
export function generateCandidate({ seed, attempt, role, accent }: { seed: number; attempt: number; role: string; accent?: string }): AgentAvatarIdentity {
  const r = rng((seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0);
  const head = pick(r, HEADS);
  const c = AVATAR_COMPATIBILITY[head];
  return {
    version: AVATAR_KIT_VERSION, head, visor: pick(r, c.visors), modules: pick(r, c.modules),
    pattern: pick(r, PATTERNS), secondaryDetail: pick(r, c.details), role, accent: accent ?? roleConfig(role).accent
  };
}

export const MAX_ATTEMPTS = 96;

/**
 * Generador (seccion 40): determinista, consciente de colisiones, con distancia visual,
 * consciente del rol, versionado. `existing` son los agentes que se ven al lado
 * (mismo equipo primero). Se llama UNA vez al crear el agente; despues manda lo persistido.
 */
export function generateAvatarIdentity(agentId: string, role: string, existing: AgentAvatarIdentity[] = [], opts: { minDistance?: number; accent?: string } = {}): AgentAvatarIdentity {
  const seed = hashId(agentId);
  const want = opts.minDistance ?? 4;
  const keys = new Set(existing.map(identityKey));
  // Se relaja la distancia antes de aceptar un duplicado exacto.
  for (let min = want; min >= 0; min--) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const c = generateCandidate({ seed, attempt, role, accent: opts.accent });
      if (!isValidIdentity(c) || keys.has(identityKey(c))) continue;
      if (existing.every((e) => avatarDistance(c, e) >= min)) return c;
    }
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS * 4; attempt++) {
    const c = generateCandidate({ seed, attempt, role, accent: opts.accent });
    if (isValidIdentity(c)) return c;
  }
  return { version: AVATAR_KIT_VERSION, head: "head-02", visor: "visor-02", modules: "module-04", pattern: "pattern-01", secondaryDetail: "detail-01", role, accent: opts.accent ?? roleConfig(role).accent };
}

/** Equipo que se ve junto (escena, mapa, conversacion): distancia mas exigente entre ellos. */
export function generateTeam(agents: { id: string; role: string }[], minDistance = 7): AgentAvatarIdentity[] {
  const out: AgentAvatarIdentity[] = [];
  for (const a of agents) out.push(generateAvatarIdentity(a.id, a.role, out, { minDistance }));
  return out;
}

/** Poblacion de prueba para el laboratorio visual (seccion 63). */
export function generateTestPopulation(n: number): { id: string; identity: AgentAvatarIdentity }[] {
  const roles = ["builder", "reviewer", "qa", "support", "research", "analyst", "knowledge", "workflow", "trader", "ops", "concierge", "sales", "growth", "security"];
  const out: { id: string; identity: AgentAvatarIdentity }[] = [];
  for (let i = 0; i < n; i++) {
    const id = `agent-${String(i + 1).padStart(3, "0")}`;
    out.push({ id, identity: generateAvatarIdentity(id, roles[i % roles.length], out.map((o) => o.identity), { minDistance: 3 }) });
  }
  return out;
}

// --- PerkOS Floor Desk: identidades fijadas a mano (equivale a "persistidas", version 1).
// Cuatro cabezas, cuatro visores, cuatro patrones distintos: distancia >= 9 entre cualquier par.
const fixed = (role: string, accent: string, head: AvatarHead, visor: AvatarVisor, modules: AvatarModules, pattern: AvatarPattern, secondaryDetail: AvatarDetail): AgentAvatarIdentity =>
  ({ version: AVATAR_KIT_VERSION, head, visor, modules, pattern, secondaryDetail, role, accent });

export const FLOOR_IDENTITIES: Record<string, AgentAvatarIdentity> = {
  scout: fixed("scout", accentFor("scout"), "head-04", "visor-02", "module-02", "pattern-04", "detail-01"),   // cupula + antena + pods con luz: el que escanea
  risk: fixed("risk", accentFor("risk"), "head-03", "visor-03", "module-03", "pattern-03", "detail-01"),       // esfera + trapecio + aletas: el esceptico
  // El Trader firma con 1Claw: acentos en rojo 1Claw. Cabeza cuadrada + placas + franja + placa: la boveda.
  trader: fixed("trader", accentFor("trader", { custody: "1claw" }), "head-05", "visor-04", "module-04", "pattern-05", "detail-03"),
  auditor: fixed("auditor", accentFor("auditor"), "head-01", "visor-01", "module-04", "pattern-01", "detail-04") // clasico limpio + lente: el que verifica
};

/** Identidad de un agente: la persistida si existe, la de Floor si es del desk, si no se genera. */
export function resolveIdentity(agent: { id: string; role: string; avatarIdentity?: AgentAvatarIdentity | null }): AgentAvatarIdentity {
  if (agent.avatarIdentity) return agent.avatarIdentity;
  if (FLOOR_IDENTITIES[agent.id]) return FLOOR_IDENTITIES[agent.id];
  return generateAvatarIdentity(agent.id, agent.role);
}

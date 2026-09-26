/**
 * Who a desk agent looks like, as pure data (no React).
 *
 * An avatar is four separate things: a permanent identity (head, visor,
 * modules, pattern, detail) that never changes; a role (accent and symbol);
 * an expression (the eyes); and a state (ring, glow, motion) that only lives
 * at runtime. Sparky is not part of this kit: the flame and the pink to orange
 * gradient are his alone.
 */

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

/** What is kept with the agent. Nothing that passes (thinking, hibernating) lives here. */
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

/**
 * How each state shows by default. A screen can pass another expression: the
 * state is not the expression. Hibernating is neither offline nor an error:
 * the agent exists, keeps its identity and sleeps, ready to wake.
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

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "profile";
export const AVATAR_SIZES: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 48, lg: 64, xl: 96, profile: 160 };

export type AgentSymbol = "search" | "shield" | "trade" | "check" | "chart" | "dot";

/** Each role's flat accent and symbol. The helmet stays neutral; gradients belong to Sparky. */
export const AGENT_ROLES: Record<string, { accent: string; symbol: AgentSymbol; label: string }> = {
  scout: { accent: "#3d8bff", symbol: "search", label: "Scout" },
  risk: { accent: "#ffb020", symbol: "shield", label: "Risk" },
  trader: { accent: "#35e08a", symbol: "trade", label: "Trader" },
  auditor: { accent: "#22d3c5", symbol: "check", label: "Auditor" },
  analyst: { accent: "#8f6bff", symbol: "chart", label: "Analyst" },
  agent: { accent: "#9aa3b2", symbol: "dot", label: "Agent" }
};
/** A role the house does not know keeps the plain accent and shows its own name: "launch-hook" reads "Launch Hook". */
export function roleConfig(role: string): { accent: string; symbol: AgentSymbol; label: string } {
  const known = AGENT_ROLES[role];
  if (known) return known;
  const words = role.split(/[-_\s]+/).filter(Boolean);
  const label = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return { ...AGENT_ROLES.agent!, label: label || AGENT_ROLES.agent!.label };
}

const fixed = (role: string, head: AvatarHead, visor: AvatarVisor, modules: AvatarModules, pattern: AvatarPattern, secondaryDetail: AvatarDetail): AgentAvatarIdentity => ({
  version: AVATAR_KIT_VERSION,
  head,
  visor,
  modules,
  pattern,
  secondaryDetail,
  role,
  accent: roleConfig(role).accent
});

/**
 * The house team of a desk, fixed by hand. Four heads, four visors and four
 * patterns, so any two of them differ at a glance, and none of them has the
 * round head with the oval visor that reads as Sparky.
 */
export const DESK_IDENTITIES: Record<string, AgentAvatarIdentity> = {
  // Dome, antenna and lit pods: the one who scans.
  scout: fixed("scout", "head-04", "visor-02", "module-02", "pattern-04", "detail-01"),
  // Sphere, trapeze visor and fins: the skeptic.
  risk: fixed("risk", "head-03", "visor-03", "module-03", "pattern-03", "detail-01"),
  // Square head, plates, stripe and badge plate: the vault.
  trader: fixed("trader", "head-05", "visor-04", "module-04", "pattern-05", "detail-03"),
  // Clean classic with a lens: the one who checks.
  auditor: fixed("auditor", "head-01", "visor-01", "module-04", "pattern-01", "detail-04")
};

/**
 * A look picked from the role's name, the same on every screen and every
 * launch, so two roles the house does not know still tell apart. Never
 * Sparky's round head with the oval visor.
 */
function derived(role: string): AgentAvatarIdentity {
  let h = 2166136261;
  for (let i = 0; i < role.length; i++) h = Math.imul(h ^ role.charCodeAt(i), 16777619) >>> 0;
  const pick = <T>(list: readonly T[], shift: number): T => list[(h >>> shift) % list.length]!;
  const head = pick(HEADS, 0);
  const visor = pick(VISORS, 5);
  const sparky = (head === "head-01" || head === "head-03") && visor === "visor-01";
  return fixed(role, head, visor, sparky ? "module-04" : pick(MODULES, 10), pick(PATTERNS, 15), pick(DETAILS, 20));
}

/** An agent's identity: the one it keeps, else the house one for its role, else one derived from its role, in its role's accent. */
export function resolveIdentity(agent: { role: string; avatarIdentity?: AgentAvatarIdentity | null }): AgentAvatarIdentity {
  if (agent.avatarIdentity) return agent.avatarIdentity;
  return DESK_IDENTITIES[agent.role] ?? derived(agent.role);
}

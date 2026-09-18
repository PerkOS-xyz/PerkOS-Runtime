import { getPerkosIdToken, perkosRequest, PerkosApiError } from "./perkosApi";

// Flota de Floor en PerkOS infra: el template `floor-desk` (project_templates,
// kind fleet) vive en la API y lo publica Admin; los souls ya no viajan en el
// app. La API orquesta la flota bajo la wallet del usuario:
//   GET  /project-templates/:id            que es el desk (card)
//   GET  /project-templates/:id/instance   estado de mis agentes (no lanza)
//   POST /project-templates/:id/instantiate crea los que faltan, despierta los
//                                          dormidos (402 antes de lanzar nada)
//   GET  /agents · POST /agents/:id/hibernate · POST /agents/:id/task  (por rol)
// Nombres: `<prefix>-<role>-<wallet8>`, los mismos que calcula la API.

export const FLEET_TEMPLATE_ID = (process.env.PERKOS_FLEET_TEMPLATE || "floor-desk").trim();

export type FleetRole = "scout" | "risk" | "trader" | "auditor";
export const FLEET_ROLES: FleetRole[] = ["scout", "risk", "trader", "auditor"];

export type AgentState = "planned" | "provisioning" | "waking" | "ready" | "hibernated" | "failed";
export type FleetRail = { provider: "1claw"; enforcement: "required-before-spend"; lockUsd: number };
export type FleetAgent = { role: FleetRole; name: string; agentId?: string; state: AgentState; detail?: string; rail?: FleetRail; railLinked?: boolean };
export type FleetStatus = "none" | "provisioning" | "waking" | "ready" | "partial" | "hibernated";
export type Fleet = { status: FleetStatus; agents: FleetAgent[]; imageTag?: string; wallet: string; projectId?: string; templateId?: string };

/** Lo que Floor muestra en la card del template (sin souls). */
export type DeskTemplate = {
  id: string;
  revision: number;
  name: string;
  description: string;
  idleMinutes: number;
  agents: Array<{ role: string; name: string; duty: string }>;
  /** Lo que el desk declara de si mismo en PerkOS; todo opcional. Si falta, manda su modulo
      (ver `floor/deskManifest.ts`): asi un desk nuevo se publica sin tocar el app. */
  module?: string;
  chain?: string;
  tagline?: string;
  venues?: string;
  screens?: string[];
};

type Localized = { en: string; es: string; [k: string]: string };
type ApiTemplate = {
  revision: number;
  activation: string;
  template: {
    id: string;
    kind: string;
    name: Localized;
    description: Localized;
    namePrefix: string;
    idleMinutes: number;
    agents: Array<{ role: string; name: Localized; duty: Localized }>;
    /** Campos del desk. PerkOS puede mandarlos sueltos o dentro de `desk`; los dos valen. */
    module?: string;
    chain?: string;
    tagline?: Localized | string;
    venues?: Localized | string;
    screens?: string[];
    desk?: { module?: string; chain?: string; tagline?: Localized | string; venues?: Localized | string; screens?: string[] };
  };
};

/** Un texto que puede venir plano o localizado. */
function maybeText(v: Localized | string | undefined, lang: string): string | undefined {
  if (typeof v === "string") return v || undefined;
  return v ? text(v, lang) || undefined : undefined;
}

/** Lo que el desk declara de si mismo, sea suelto o bajo `desk`. Nada obligatorio. */
function deskFields(t: ApiTemplate["template"], lang: string): Pick<DeskTemplate, "module" | "chain" | "tagline" | "venues" | "screens"> {
  const d = t.desk ?? {};
  return {
    module: d.module ?? t.module,
    chain: d.chain ?? t.chain,
    tagline: maybeText(d.tagline ?? t.tagline, lang),
    venues: maybeText(d.venues ?? t.venues, lang),
    screens: Array.isArray(d.screens ?? t.screens) ? (d.screens ?? t.screens) : undefined
  };
}
type ApiInstance = {
  templateId: string;
  revision: number;
  projectId: string;
  wallet: string;
  status: FleetStatus;
  imageTag?: string;
  agents: Array<{ role: string; name: string; agentId?: string; state: AgentState; detail?: string; rail?: FleetRail; railLinked?: boolean }>;
};
type ApiAgent = { id: string; name: string; runtime: "Hermes" | "OpenClaw" | string; status: "provisioning" | "ready" | "failed" | "unknown" | string };

export function fleetName(role: FleetRole, wallet: string, prefix = "floor"): string {
  return `${prefix}-${role}-${wallet.toLowerCase().replace(/^0x/, "").slice(-8)}`;
}

async function token(wallet: string): Promise<string> {
  const t = await getPerkosIdToken(wallet);
  if (!t) throw new PerkosApiError(401, "PERKOS_SESSION", "Sign in to PerkOS first");
  return t.idToken;
}

function text(l: Localized | undefined, lang = "en"): string {
  return l?.[lang] ?? l?.en ?? "";
}

function fromInstance(i: ApiInstance): Fleet {
  return {
    status: i.status,
    wallet: i.wallet,
    imageTag: i.imageTag,
    projectId: i.projectId,
    templateId: i.templateId,
    agents: i.agents
      .filter((a): a is ApiInstance["agents"][number] & { role: FleetRole } => (FLEET_ROLES as string[]).includes(a.role))
      .map((a) => ({ role: a.role, name: a.name, agentId: a.agentId, state: a.state, detail: a.detail, rail: a.rail, railLinked: a.railLinked }))
  };
}

/** Card: un template publicado. 404 si Admin aun no lo publico. */
export async function deskTemplate(wallet: string, lang = "en", templateId = FLEET_TEMPLATE_ID): Promise<DeskTemplate> {
  const idToken = await token(wallet);
  const r = await perkosRequest<ApiTemplate>(`/project-templates/${encodeURIComponent(templateId)}`, { idToken, timeoutMs: 15_000 });
  const t = r.template;
  return {
    id: t.id,
    revision: r.revision,
    name: text(t.name, lang),
    description: text(t.description, lang),
    idleMinutes: t.idleMinutes,
    agents: t.agents.map((a) => ({ role: a.role, name: text(a.name, lang), duty: text(a.duty, lang) })),
    ...deskFields(t, lang)
  };
}

/** Un desk mio, tal como PerkOS lo guarda: un proyecto de la wallet. La flota escribe
    `wallets/{wallet}/projects/fleet-<templateId>`, asi que un desk ya es un proyecto. */
export type DeskProject = { projectId: string; templateId: string; name: string; goal: string; status: string; agents: number; updatedAt?: string };

export async function listProjects(wallet: string): Promise<DeskProject[]> {
  const idToken = await token(wallet);
  const r = await perkosRequest<{ projects?: Array<Record<string, unknown>> }>("/projects", { idToken, timeoutMs: 20_000 });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return (r.projects ?? []).map((p) => {
    const projectId = str(p.id) || str(p.projectId);
    return {
      projectId,
      // Los desks son los proyectos que nacieron de un template fleet.
      templateId: projectId.startsWith("fleet-") ? projectId.slice("fleet-".length) : "",
      name: str(p.name) || projectId,
      goal: str(p.goal),
      status: str(p.status) || "Active",
      agents: Number.isFinite(Number(p.agents)) ? Number(p.agents) : 0,
      updatedAt: str(p.updatedAt) || undefined
    };
  });
}

/** Todas las cards: los templates fleet publicados (hoy uno; el wizard muestra una card por cada uno). */
export async function listDeskTemplates(wallet: string, lang = "en"): Promise<DeskTemplate[]> {
  const idToken = await token(wallet);
  const r = await perkosRequest<{ templates: Array<{ id: string; kind?: string; activation?: string }> }>("/project-templates", { idToken, timeoutMs: 15_000 });
  const ids = r.templates.filter((t) => t.kind === "fleet" || t.activation === "fleet").map((t) => t.id);
  const all = await Promise.all(ids.map((id) => deskTemplate(wallet, lang, id).catch(() => null)));
  const desks = all.filter((d): d is DeskTemplate => d !== null);
  // El desk por defecto primero.
  return desks.sort((a, b) => (a.id === FLEET_TEMPLATE_ID ? -1 : b.id === FLEET_TEMPLATE_ID ? 1 : a.name.localeCompare(b.name)));
}

// Rail de gasto (1Claw) del Trader. La API enrola con su app partner de 1Claw
// y le pasa la credencial al Trader; la persona reclama su vault en el browser
// (claimUrl). Floor solo ve el estado, nunca la key.
export type RailState = {
  status: "not_configured" | "not_connected" | "claim_pending" | "linked";
  role?: string;
  connectionId?: string;
  oneclawAgentId?: string;
  vaultId?: string;
  claimedAt?: string;
  claimUrl?: string;
  expiresIn?: number;
  authorizeUrl?: string;
  walletAddress?: string;
};

export async function railStatus(wallet: string, templateId = FLEET_TEMPLATE_ID): Promise<RailState> {
  const idToken = await token(wallet);
  return perkosRequest<RailState>(`/project-templates/${encodeURIComponent(templateId)}/rail`, { idToken, timeoutMs: 20_000 });
}

/** "Link 1Claw": idempotente; devuelve claimUrl mientras falte el claim. */
export async function enrolRail(wallet: string, email: string, templateId = FLEET_TEMPLATE_ID): Promise<RailState> {
  const idToken = await token(wallet);
  return perkosRequest<RailState>(`/project-templates/${encodeURIComponent(templateId)}/rail`, {
    idToken, method: "POST", body: JSON.stringify({ email }), timeoutMs: 60_000
  });
}

/** Estado de las orbs; no lanza ni despierta nada. */
export async function fleetStatus(wallet: string, templateId = FLEET_TEMPLATE_ID): Promise<Fleet> {
  const idToken = await token(wallet);
  const i = await perkosRequest<ApiInstance>(`/project-templates/${encodeURIComponent(templateId)}/instance`, { idToken, timeoutMs: 30_000 });
  return fromInstance(i);
}

/** "Deploy / Wake the team": la API crea los que falten y despierta los dormidos. */
export async function wakeFleet(wallet: string, templateId = FLEET_TEMPLATE_ID): Promise<Fleet> {
  const idToken = await token(wallet);
  const i = await perkosRequest<ApiInstance>(`/project-templates/${encodeURIComponent(templateId)}/instantiate`, {
    idToken, method: "POST", body: "{}", timeoutMs: 90_000
  });
  return fromInstance(i);
}

async function listMine(idToken: string, wallet: string): Promise<Map<FleetRole, ApiAgent>> {
  const r = await perkosRequest<{ agents: ApiAgent[] }>("/agents", { idToken });
  const byName = new Map(r.agents.map((a) => [a.name, a]));
  const out = new Map<FleetRole, ApiAgent>();
  for (const role of FLEET_ROLES) {
    const a = byName.get(fleetName(role, wallet));
    if (a) out.set(role, a);
  }
  return out;
}

function summarize(agents: FleetAgent[], wallet: string): Fleet {
  const status: FleetStatus =
    agents.every((a) => a.state === "planned") ? "none"
    : agents.every((a) => a.state === "ready") ? "ready"
    : agents.every((a) => a.state === "hibernated" || a.state === "planned") ? "hibernated"
    : agents.some((a) => a.state === "failed") ? "partial"
    : agents.some((a) => a.state === "provisioning") ? "provisioning"
    : "waking";
  return { status, agents, wallet };
}

/** "Stop": hiberna los que esten despiertos. */
export async function hibernateFleet(wallet: string): Promise<Fleet> {
  const idToken = await token(wallet);
  const mine = await listMine(idToken, wallet);
  const agents = await Promise.all(
    FLEET_ROLES.map(async (role): Promise<FleetAgent> => {
      const name = fleetName(role, wallet);
      const cur = mine.get(role);
      if (!cur) return { role, name, state: "planned" };
      if (cur.status !== "ready") return { role, name, agentId: cur.id, state: cur.status === "failed" ? "failed" : "provisioning" };
      try {
        await perkosRequest(`/agents/${encodeURIComponent(cur.id)}/hibernate`, { idToken, method: "POST", body: "{}", timeoutMs: 20_000 });
        return { role, name, agentId: cur.id, state: "hibernated" };
      } catch (e) {
        return { role, name, agentId: cur.id, state: "ready", detail: (e as Error).message };
      }
    })
  );
  return summarize(agents, wallet);
}

export type FleetReply = { role: FleetRole; ok: boolean; reply: string; detail?: string; ms: number };

/** Un solo agente, un prompt. Base del turno de mesa secuencial (desk). */
export async function askOne(wallet: string, role: FleetRole, prompt: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<FleetReply> {
  const idToken = await token(wallet);
  const mine = await listMine(idToken, wallet);
  const t0 = Date.now();
  const cur = mine.get(role);
  if (!cur || cur.status !== "ready") return { role, ok: false, reply: "", detail: cur ? `agent ${cur.status}` : "no agent", ms: 0 };
  try {
    const r = await perkosRequest<{ ok?: boolean; reply?: string; detail?: string }>(`/agents/${encodeURIComponent(cur.id)}/task`, {
      idToken,
      method: "POST",
      body: JSON.stringify({ prompt, timeoutMs }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5_000)]) : AbortSignal.timeout(timeoutMs + 5_000)
    });
    const reply = String(r.reply ?? "").trim();
    // Una tarea es actividad: si no, el curator hiberna la flota 15 min despues
    // del ultimo wake aunque la mesa este trabajando.
    void perkosRequest(`/agents/${encodeURIComponent(cur.id)}/activity`, { idToken, method: "POST", body: "{}", timeoutMs: 8_000 }).catch(() => undefined);
    return { role, ok: Boolean(r.ok ?? reply), reply, detail: r.detail, ms: Date.now() - t0 };
  } catch (e) {
    return { role, ok: false, reply: "", detail: (e as Error).message, ms: Date.now() - t0 };
  }
}

/** Pregunta a los agentes listos (en paralelo). Cada uno responde como handoff corto. */
export async function askFleet(wallet: string, prompt: string, roles: FleetRole[] = FLEET_ROLES, timeoutMs = 45_000, signal?: AbortSignal): Promise<FleetReply[]> {
  const idToken = await token(wallet);
  const mine = await listMine(idToken, wallet);
  return Promise.all(
    roles.map(async (role): Promise<FleetReply> => {
      const t0 = Date.now();
      const cur = mine.get(role);
      if (!cur || cur.status !== "ready") return { role, ok: false, reply: "", detail: cur ? `agent ${cur.status}` : "no agent", ms: 0 };
      try {
        const r = await perkosRequest<{ ok?: boolean; reply?: string; detail?: string }>(`/agents/${encodeURIComponent(cur.id)}/task`, {
          idToken,
          method: "POST",
          body: JSON.stringify({ prompt, timeoutMs }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5_000)]) : AbortSignal.timeout(timeoutMs + 5_000)
        });
        const reply = String(r.reply ?? "").trim();
        return { role, ok: Boolean(r.ok ?? reply), reply, detail: r.detail, ms: Date.now() - t0 };
      } catch (e) {
        return { role, ok: false, reply: "", detail: (e as Error).message, ms: Date.now() - t0 };
      }
    })
  );
}

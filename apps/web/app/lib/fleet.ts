import { getPerkosIdToken, perkosRequest, PerkosApiError } from "./perkosApi";

// Flota de Floor en PerkOS infra, como EQLTY (API/src/perkos-fleet.ts) pero
// propia: cuatro Hermes por usuario (floor-scout/risk/trader/auditor-<wallet>),
// sin ENS/Durin ni 1Claw. La API de PerkOS hace el trabajo pesado:
//   GET  /runtimes                      imagen Hermes publica
//   GET  /agents                        los del usuario
//   POST /agents/launch                 crear (perkos-managed; 402 sin creditos)
//   GET  /agents/:id/hibernation        estado
//   POST /agents/:id/ensure-awake       despertar
//   POST /agents/:id/activity           extiende la ventana de idle
//   POST /agents/:id/hibernate          dormir
//   POST /agents/:id/task {prompt}      hablar con el agente

export type FleetRole = "scout" | "risk" | "trader" | "auditor";
export const FLEET_ROLES: FleetRole[] = ["scout", "risk", "trader", "auditor"];

export type AgentState = "planned" | "provisioning" | "waking" | "ready" | "hibernated" | "failed";
export type FleetAgent = { role: FleetRole; name: string; agentId?: string; state: AgentState; detail?: string };
export type FleetStatus = "none" | "provisioning" | "waking" | "ready" | "partial" | "hibernated";
export type Fleet = { status: FleetStatus; agents: FleetAgent[]; imageTag?: string; wallet: string };

type ApiAgent = { id: string; name: string; runtime: "Hermes" | "OpenClaw" | string; status: "provisioning" | "ready" | "failed" | "unknown" | string };
type Hibernation = { state: "active" | "hibernating" | "hibernated" | "waking"; desiredCount: number; runningCount: number; pendingCount: number };
type EnsureAwake = { finalState?: Hibernation["state"]; online?: boolean; triggeredWake?: boolean };
type Launch = { launchId: string; result?: { status?: string; jobId?: string | null; agent?: ApiAgent } };

export function fleetName(role: FleetRole, wallet: string): string {
  return `floor-${role}-${wallet.toLowerCase().replace(/^0x/, "").slice(-8)}`;
}

const DUTY: Record<FleetRole, string> = {
  scout: "Find opportunities: markets, tokens, projects and signals on Base. Cite what you saw and how fresh it is.",
  risk: "Size and limit. Check liquidity, freshness, policy and exposure before anything is drafted. You can block.",
  trader: "Draft orders and routes only. You never execute or move funds; the human approves every draft.",
  auditor: "Reconcile: what was asked, what was drafted, what evidence supports it, what is missing. Keep the record."
};

export function roleSoul(role: FleetRole, wallet: string): string {
  return [
    `# PerkOS Floor · ${role}`,
    "",
    `You are the ${role} teammate on the PerkOS Floor desk of ${wallet}. The desk runs on PerkOS infrastructure on Base.`,
    "",
    DUTY[role],
    "",
    "You draft; the human approves. Never spend, sign or move funds. Never claim evidence a tool did not return.",
    "Reply in plain text, under 120 words, in the language of the request, as a short handoff to the desk."
  ].join("\n");
}

async function token(wallet: string): Promise<string> {
  const t = await getPerkosIdToken(wallet);
  if (!t) throw new PerkosApiError(401, "PERKOS_SESSION", "Sign in to PerkOS first");
  return t.idToken;
}

async function latestHermesImage(): Promise<string> {
  const r = await perkosRequest<{ runtimes: Array<{ runtime: string; primaryTag?: string; channel?: string }> }>("/runtimes");
  const img = r.runtimes.find((x) => x.runtime === "Hermes" && x.channel === "public" && x.primaryTag);
  if (!img?.primaryTag) throw new Error("PerkOS has no public Hermes runtime image");
  return img.primaryTag;
}

function summarize(agents: FleetAgent[], wallet: string, imageTag?: string): Fleet {
  const status: FleetStatus =
    agents.every((a) => a.state === "planned") ? "none"
    : agents.every((a) => a.state === "ready") ? "ready"
    : agents.every((a) => a.state === "hibernated" || a.state === "planned") ? "hibernated"
    : agents.some((a) => a.state === "failed") ? "partial"
    : agents.some((a) => a.state === "provisioning") ? "provisioning"
    : "waking";
  return { status, agents, imageTag, wallet };
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

/** Estado sin tocar nada (para las orbs). */
export async function fleetStatus(wallet: string): Promise<Fleet> {
  const idToken = await token(wallet);
  const mine = await listMine(idToken, wallet);
  const agents = await Promise.all(
    FLEET_ROLES.map(async (role): Promise<FleetAgent> => {
      const name = fleetName(role, wallet);
      const cur = mine.get(role);
      if (!cur) return { role, name, state: "planned" };
      if (cur.status !== "ready") return { role, name, agentId: cur.id, state: cur.status === "failed" ? "failed" : "provisioning" };
      try {
        const h = await perkosRequest<Hibernation>(`/agents/${encodeURIComponent(cur.id)}/hibernation`, { idToken, timeoutMs: 10_000 });
        if (h.state === "active" && h.runningCount > 0) return { role, name, agentId: cur.id, state: "ready" };
        if (h.state === "waking" || (h.desiredCount > 0 && h.runningCount === 0)) return { role, name, agentId: cur.id, state: "waking" };
        return { role, name, agentId: cur.id, state: "hibernated" };
      } catch (e) {
        return { role, name, agentId: cur.id, state: "ready", detail: (e as Error).message };
      }
    })
  );
  return summarize(agents, wallet);
}

/** "Wake the team": crea los que falten, despierta los dormidos. */
export async function wakeFleet(wallet: string): Promise<Fleet> {
  const idToken = await token(wallet);
  const mine = await listMine(idToken, wallet);
  const missing = FLEET_ROLES.filter((r) => !mine.has(r));
  const imageTag = missing.length ? await latestHermesImage() : undefined;
  const agents = await Promise.all(
    FLEET_ROLES.map(async (role): Promise<FleetAgent> => {
      const name = fleetName(role, wallet);
      const cur = mine.get(role);
      if (!cur) {
        const launch = await perkosRequest<Launch>("/agents/launch", {
          idToken,
          method: "POST",
          timeoutMs: 30_000,
          body: JSON.stringify({
            walletAddress: wallet.toLowerCase(),
            runtime: "Hermes",
            name,
            plugins: [],
            skills: [],
            deployMode: "perkos-managed",
            imageTag,
            soul: roleSoul(role, wallet),
            disabledTools: ["code-execution"]
          })
        });
        return { role, name, agentId: launch.result?.agent?.id, state: launch.result?.status === "ready" ? "ready" : "provisioning" };
      }
      if (cur.status !== "ready") return { role, name, agentId: cur.id, state: cur.status === "failed" ? "failed" : "provisioning" };
      const h = await perkosRequest<Hibernation>(`/agents/${encodeURIComponent(cur.id)}/hibernation`, { idToken, timeoutMs: 10_000 });
      if (h.state === "active" && h.runningCount > 0) {
        void touch(cur.id, idToken);
        return { role, name, agentId: cur.id, state: "ready" };
      }
      if (h.state === "waking" || (h.desiredCount > 0 && h.runningCount === 0)) {
        void touch(cur.id, idToken);
        return { role, name, agentId: cur.id, state: "waking" };
      }
      const awake = await perkosRequest<EnsureAwake>(`/agents/${encodeURIComponent(cur.id)}/ensure-awake`, {
        idToken, method: "POST", timeoutMs: 30_000, body: JSON.stringify({ waitForRunning: false })
      });
      void touch(cur.id, idToken);
      return { role, name, agentId: cur.id, state: awake.online || awake.finalState === "active" ? "ready" : "waking" };
    })
  );
  return summarize(agents, wallet, imageTag);
}

async function touch(agentId: string, idToken: string): Promise<void> {
  try { await perkosRequest(`/agents/${encodeURIComponent(agentId)}/activity`, { idToken, method: "POST", body: "{}", timeoutMs: 10_000 }); } catch {}
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

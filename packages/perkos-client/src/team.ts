/**
 * A desk's team on PerkOS: the agents a published desk template runs under the
 * person's wallet. Asking where they stand launches nothing; waking them
 * creates the missing ones and wakes the sleeping ones, billed to the
 * person's desk time while they are awake.
 */

import { PerkosApiError, type PerkosClient } from "./client.ts";

export type TeamAgentState = "planned" | "provisioning" | "waking" | "ready" | "hibernated" | "failed";
export type TeamStatus = "none" | "provisioning" | "waking" | "ready" | "partial" | "hibernated";

export interface TeamAgent {
  role: string;
  name: string;
  /** How PerkOS addresses the agent when it is asked something. Absent while the agent does not exist yet. */
  agentId?: string;
  state: TeamAgentState;
  detail?: string;
}

export interface DeskTeam {
  templateId: string;
  status: TeamStatus;
  agents: TeamAgent[];
}

const STATES: readonly string[] = ["planned", "provisioning", "waking", "ready", "hibernated", "failed"];
const STATUSES: readonly string[] = ["none", "provisioning", "waking", "ready", "partial", "hibernated"];

/** Reading where the team stands asks PerkOS about each agent; waking may also start them. */
const STATUS_TIMEOUT_MS = 30_000;
const WAKE_TIMEOUT_MS = 90_000;

export interface TeamCallOptions {
  signal?: AbortSignal;
}

function toTeam(body: Record<string, unknown>, templateId: string): DeskTeam {
  const status = typeof body.status === "string" && STATUSES.includes(body.status) ? (body.status as TeamStatus) : null;
  const rows = Array.isArray(body.agents) ? (body.agents as Array<Record<string, unknown>>) : null;
  if (!status || !rows) throw new PerkosApiError("PerkOS answered a team this version cannot read", 502, "TEAM_SHAPE");
  const agents = rows.flatMap((a): TeamAgent[] => {
    if (typeof a.role !== "string" || typeof a.name !== "string" || typeof a.state !== "string" || !STATES.includes(a.state)) return [];
    return [
      {
        role: a.role,
        name: a.name,
        ...(typeof a.agentId === "string" && a.agentId ? { agentId: a.agentId } : {}),
        state: a.state as TeamAgentState,
        ...(typeof a.detail === "string" ? { detail: a.detail } : {}),
      },
    ];
  });
  return { templateId, status, agents };
}

export class Team {
  constructor(private readonly client: PerkosClient) {}

  /** Where the desk's team stands for this wallet. Launches nothing. */
  async status(templateId: string, options: TeamCallOptions = {}): Promise<DeskTeam> {
    const body = await this.client.request<Record<string, unknown>>(`/project-templates/${encodeURIComponent(templateId)}/instance`, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return toTeam(body, templateId);
  }

  /** Creates the agents that are missing and wakes the sleeping ones. PerkOS answers 402 without desk time. */
  async wake(templateId: string, options: TeamCallOptions = {}): Promise<DeskTeam> {
    const body = await this.client.request<Record<string, unknown>>(`/project-templates/${encodeURIComponent(templateId)}/instantiate`, {
      method: "POST",
      body: {},
      timeoutMs: WAKE_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return toTeam(body, templateId);
  }
}

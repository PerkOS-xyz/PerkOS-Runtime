import { PerkosApiError, type PerkosClient } from "./client.ts";

export type WorldProvider = "idkit" | "oidc";
export type WorldRequestState = "preparing" | "pending" | "verifying" | "enrolled" | "approved" | "consumed" | "cancelled" | "denied" | "expired" | "failed" | "stale";
export interface WorldStatus {
  enabled: boolean;
  environment: "sandbox";
  providers: Record<WorldProvider, boolean>;
  enrolled: Record<WorldProvider, boolean>;
}
export interface WorldRpContext { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string }
/** Public protocol material only. Tokens, device codes and PKCE verifiers never cross this boundary. */
export interface WorldRequest {
  id: string;
  status: WorldRequestState;
  provider: WorldProvider;
  purpose: string;
  expiresAt: number;
  verificationUrl?: string;
  appId?: `app_${string}`;
  rpContext?: WorldRpContext;
  signal?: string;
  sessionId?: `session_${string}`;
}
const STATES: WorldRequestState[] = ["preparing", "pending", "verifying", "enrolled", "approved", "consumed", "cancelled", "denied", "expired", "failed", "stale"];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 8192): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const shape = () => new PerkosApiError("PerkOS returned an unreadable World response", 502, "WORLD_SHAPE");
export const worldRequestId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export const worldTerminal = (status: WorldRequestState) => !["preparing", "pending", "verifying"].includes(status);

export function readWorldStatus(v: unknown): WorldStatus {
  if (!object(v) || typeof v.enabled !== "boolean" || v.environment !== "sandbox" || !object(v.providers) || !object(v.enrolled) ||
      ![v.providers.idkit, v.providers.oidc, v.enrolled.idkit, v.enrolled.oidc].every((x) => typeof x === "boolean")) throw shape();
  return { enabled: v.enabled, environment: "sandbox", providers: { idkit: v.providers.idkit as boolean, oidc: v.providers.oidc as boolean },
    enrolled: { idkit: v.enrolled.idkit as boolean, oidc: v.enrolled.oidc as boolean } };
}

export function readWorldRequest(v: unknown): WorldRequest {
  if (!object(v) || !worldRequestId(v.id) || !STATES.includes(v.status as WorldRequestState) || !["idkit", "oidc"].includes(String(v.provider)) ||
      !text(v.purpose, 80) || !Number.isSafeInteger(v.expiresAt) || (v.expiresAt as number) <= 0) throw shape();
  const out: WorldRequest = { id: v.id, status: v.status as WorldRequestState, provider: v.provider as WorldProvider, purpose: v.purpose, expiresAt: v.expiresAt as number };
  if (v.verificationUrl !== undefined) {
    if (!text(v.verificationUrl)) throw shape();
    let url: URL;
    try { url = new URL(v.verificationUrl); } catch { throw shape(); }
    if (url.protocol !== "https:" || url.username || url.password || !["sandbox.auth.world.org", "auth.world.org"].includes(url.hostname)) throw shape();
    out.verificationUrl = v.verificationUrl;
  }
  if (v.appId !== undefined) {
    if (!text(v.appId, 160) || !/^app_[a-zA-Z0-9]+$/.test(v.appId)) throw shape();
    out.appId = v.appId as `app_${string}`;
  }
  if (v.rpContext !== undefined) {
    const r = v.rpContext;
    if (!object(r) || !text(r.rp_id, 160) || !/^rp_[a-zA-Z0-9]+$/.test(r.rp_id) || !text(r.nonce, 256) || !text(r.signature, 1024) ||
        !Number.isSafeInteger(r.created_at) || !Number.isSafeInteger(r.expires_at) || (r.expires_at as number) <= (r.created_at as number)) throw shape();
    out.rpContext = { rp_id: r.rp_id, nonce: r.nonce, signature: r.signature, created_at: r.created_at as number, expires_at: r.expires_at as number };
  }
  if (v.signal !== undefined) { if (!text(v.signal, 8192)) throw shape(); out.signal = v.signal; }
  if (v.sessionId !== undefined) { if (!text(v.sessionId, 160) || !/^session_[a-fA-F0-9]{128}$/.test(v.sessionId)) throw shape(); out.sessionId = v.sessionId as `session_${string}`; }
  return out;
}

export class World {
  constructor(private readonly client: PerkosClient) {}
  async status(signal?: AbortSignal): Promise<WorldStatus> {
    return readWorldStatus(await this.client.request("/world/status", { ...(signal ? { signal } : {}) }));
  }
  async enroll(provider: WorldProvider, signal?: AbortSignal): Promise<WorldRequest> {
    return readWorldRequest(await this.client.request("/world/requests", { method: "POST", body: { provider, purpose: "enroll", ...(provider === "oidc" ? { mode: "authorization_code" } : {}) }, ...(signal ? { signal } : {}) }));
  }
  private path(id: string) { if (!worldRequestId(id)) throw new PerkosApiError("Invalid World request", 400, "WORLD_REQUEST_ID"); return `/world/requests/${encodeURIComponent(id)}`; }
  async request(id: string, signal?: AbortSignal): Promise<WorldRequest> {
    return readWorldRequest(await this.client.request(this.path(id), { ...(signal ? { signal } : {}) }));
  }
  async poll(id: string, signal?: AbortSignal): Promise<WorldRequest> {
    return readWorldRequest(await this.client.request(`${this.path(id)}/poll`, { method: "POST", body: {}, ...(signal ? { signal } : {}) }));
  }
  async cancel(id: string): Promise<WorldRequest> {
    return readWorldRequest(await this.client.request(`${this.path(id)}/cancel`, { method: "POST", body: {} }));
  }
  async proof(id: string, result: unknown, signal?: AbortSignal): Promise<WorldRequest> {
    return readWorldRequest(await this.client.request(`${this.path(id)}/proof`, { method: "POST", body: { result }, timeoutMs: 45_000, ...(signal ? { signal } : {}) }));
  }
}

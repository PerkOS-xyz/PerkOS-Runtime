/**
 * Sign-in with a Grok (xAI) subscription, by OAuth device code.
 *
 *   start: request a device code; the person opens x.ai and enters the user code.
 *   poll:  exchange the device code once they approve.
 *
 * Tokens live in <home>/xai-oauth.json (0600). The device code stays on the
 * server (<home>/xai-pending.json), so the window never handles it.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureHome, homeDir } from "./home";

export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TIMEOUT_MS = 30_000;
const PENDING_TTL_MS = 30 * 60_000;
const REFRESH_SKEW_MS = 60_000;

export interface XaiTokens {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
}

export interface XaiDeviceStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

export type XaiPoll = { status: "pending"; intervalMs: number } | { status: "ok" } | { status: "denied" } | { status: "expired" };

type Endpoints = { device: string; token: string };
type Pending = { deviceCode: string; at: number; intervalMs: number };

const file = (name: string) => join(homeDir(), name);

function trusted(url: unknown, what: string): string {
  if (typeof url !== "string") throw new Error(`xAI ${what} is missing`);
  const u = new URL(url);
  if (u.protocol !== "https:" || !(u.hostname === "x.ai" || u.hostname.endsWith(".x.ai"))) {
    throw new Error(`xAI ${what} is not on an x.ai host: ${u.hostname}`);
  }
  return url;
}

const seconds = (v: unknown, fallbackMs: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n * 1000) : fallbackMs;
};

const form = (body: Record<string, string>) => new URLSearchParams(body).toString();

const UNREACHABLE = "Could not reach x.ai. Try again.";

export class XaiAuth {
  private endpoints: Endpoints | null = null;

  constructor(
    private readonly http: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  private async discover(): Promise<Endpoints> {
    if (this.endpoints) return this.endpoints;
    const res = await this.http(DISCOVERY_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
      throw new Error(UNREACHABLE);
    });
    if (!res.ok) throw new Error(`xAI discovery failed: ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    this.endpoints = {
      device: trusted(j.device_authorization_endpoint, "device endpoint"),
      token: trusted(j.token_endpoint, "token endpoint"),
    };
    return this.endpoints;
  }

  private async post(url: string, body: Record<string, string>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await this.http(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {
      throw new Error(UNREACHABLE);
    });
    return { ok: res.ok, status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  }

  private tokens(j: Record<string, unknown>, previous?: XaiTokens): XaiTokens {
    if (typeof j.access_token !== "string" || !j.access_token) throw new Error("xAI token response has no access_token");
    const refresh = typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : (previous?.refreshToken ?? "");
    if (!refresh) throw new Error("xAI token response has no refresh_token");
    return { accessToken: j.access_token, refreshToken: refresh, expiresAt: this.now() + seconds(j.expires_in, 3_600_000) };
  }

  async start(): Promise<XaiDeviceStart> {
    const { device } = await this.discover();
    const r = await this.post(device, { client_id: XAI_CLIENT_ID, scope: XAI_SCOPE });
    if (!r.ok || typeof r.json.device_code !== "string" || typeof r.json.user_code !== "string") {
      throw new Error(`xAI device code request failed: ${r.status}`);
    }
    const intervalMs = seconds(r.json.interval, 5_000);
    await this.savePending({ deviceCode: r.json.device_code, at: this.now(), intervalMs });
    const complete = r.json.verification_uri_complete;
    return {
      userCode: r.json.user_code,
      verificationUri: trusted(r.json.verification_uri, "verification URI"),
      ...(typeof complete === "string" && complete ? { verificationUriComplete: trusted(complete, "verification URI") } : {}),
      expiresAt: this.now() + seconds(r.json.expires_in, 600_000),
      intervalMs,
    };
  }

  /** One exchange attempt for the pending device code. */
  async poll(): Promise<XaiPoll> {
    const pending = await this.loadPending();
    if (!pending) return { status: "expired" };
    const { token } = await this.discover();
    const r = await this.post(token, { grant_type: DEVICE_GRANT, client_id: XAI_CLIENT_ID, device_code: pending.deviceCode });
    if (r.ok) {
      await this.saveTokens(this.tokens(r.json));
      await rm(file("xai-pending.json"), { force: true });
      return { status: "ok" };
    }
    const error = typeof r.json.error === "string" ? r.json.error : "";
    if (error === "authorization_pending") return { status: "pending", intervalMs: pending.intervalMs };
    if (error === "slow_down") {
      const intervalMs = pending.intervalMs + 5_000;
      await this.savePending({ ...pending, intervalMs });
      return { status: "pending", intervalMs };
    }
    await rm(file("xai-pending.json"), { force: true });
    if (error === "access_denied" || error === "authorization_denied") return { status: "denied" };
    return { status: "expired" };
  }

  /** A valid access token, refreshed and saved when close to expiry. Null when signed out. */
  async accessToken(): Promise<string | null> {
    const current = await this.loadTokens();
    if (!current) return null;
    if (current.expiresAt - REFRESH_SKEW_MS > this.now()) return current.accessToken;
    const { token } = await this.discover();
    const r = await this.post(token, { grant_type: "refresh_token", client_id: XAI_CLIENT_ID, refresh_token: current.refreshToken });
    if (!r.ok) return null;
    // xAI rotates the refresh token, so the new one is always saved.
    const next = this.tokens(r.json, current);
    await this.saveTokens(next);
    return next.accessToken;
  }

  async signedIn(): Promise<boolean> {
    return (await this.loadTokens()) !== null;
  }

  async signOut(): Promise<void> {
    await rm(file("xai-oauth.json"), { force: true });
    await rm(file("xai-pending.json"), { force: true });
  }

  async loadTokens(): Promise<XaiTokens | null> {
    try {
      const t = JSON.parse(await readFile(file("xai-oauth.json"), "utf8")) as Partial<XaiTokens>;
      if (typeof t.accessToken !== "string" || typeof t.refreshToken !== "string") return null;
      return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: typeof t.expiresAt === "number" ? t.expiresAt : 0 };
    } catch {
      return null;
    }
  }

  private async saveTokens(tokens: XaiTokens): Promise<void> {
    await ensureHome();
    await writeFile(file("xai-oauth.json"), JSON.stringify(tokens), { mode: 0o600 });
  }

  private async loadPending(): Promise<Pending | null> {
    try {
      const p = JSON.parse(await readFile(file("xai-pending.json"), "utf8")) as Pending;
      return typeof p.deviceCode === "string" && this.now() - p.at < PENDING_TTL_MS ? p : null;
    } catch {
      return null;
    }
  }

  private async savePending(pending: Pending): Promise<void> {
    await ensureHome();
    await writeFile(file("xai-pending.json"), JSON.stringify(pending), { mode: 0o600 });
  }
}

export const xaiAuth = new XaiAuth();

/**
 * Sign-in with a ChatGPT subscription, by the OpenAI device flow.
 *
 *   start: request a user code; the person opens auth.openai.com/codex/device and enters it.
 *   poll:  once approved, OpenAI returns an authorization code and PKCE verifier,
 *          exchanged at the token endpoint for access and refresh tokens.
 *
 * Tokens live in <home>/chatgpt-oauth.json (0600). The device ids stay on the
 * server (<home>/chatgpt-pending.json), so the window never handles them.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureHome, homeDir } from "./home";

const ISSUER = "https://auth.openai.com";
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_VERIFICATION_URI = `${ISSUER}/codex/device`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const TIMEOUT_MS = 30_000;
const PENDING_TTL_MS = 15 * 60_000;
const REFRESH_SKEW_MS = 120_000;
const UNREACHABLE = "Could not reach OpenAI. Try again.";

export interface ChatgptTokens {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
}

export interface ChatgptDeviceStart {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export type ChatgptPoll = { status: "pending"; intervalMs: number } | { status: "ok" } | { status: "expired" };

type Pending = { deviceAuthId: string; userCode: string; at: number; intervalMs: number };

const file = (name: string) => join(homeDir(), name);

/** Expiry from the JWT `exp` claim, else from `expires_in`, else one hour. */
function expiryOf(token: string, expiresIn: unknown, now: number): number {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof claims.exp === "number") return claims.exp * 1000;
  } catch {
    // Not a JWT: fall through.
  }
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  return now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3_600_000);
}

export class ChatgptAuth {
  constructor(
    private readonly http: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  private async send(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await this.http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
      throw new Error(UNREACHABLE);
    });
    return { ok: res.ok, status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  }

  async start(): Promise<ChatgptDeviceStart> {
    const r = await this.send(`${ISSUER}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
    });
    if (r.status === 429) throw new Error("OpenAI is limiting sign-in requests. Wait a minute and try again.");
    const userCode = r.json.user_code;
    const deviceAuthId = r.json.device_auth_id;
    if (!r.ok || typeof userCode !== "string" || typeof deviceAuthId !== "string") {
      throw new Error(`OpenAI did not start the sign-in (${r.status}).`);
    }
    const interval = Number(r.json.interval);
    const intervalMs = Math.max(3, Number.isFinite(interval) ? interval : 5) * 1000;
    await this.savePending({ deviceAuthId, userCode, at: this.now(), intervalMs });
    return { userCode, verificationUri: CHATGPT_VERIFICATION_URI, expiresAt: this.now() + PENDING_TTL_MS, intervalMs };
  }

  /** One check of the pending sign-in; exchanges the code once it is approved. */
  async poll(): Promise<ChatgptPoll> {
    const pending = await this.loadPending();
    if (!pending) return { status: "expired" };
    const r = await this.send(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ device_auth_id: pending.deviceAuthId, user_code: pending.userCode }),
    });
    // 403 and 404 mean the person has not approved yet.
    if (r.status === 403 || r.status === 404) return { status: "pending", intervalMs: pending.intervalMs };
    if (r.status === 429) return { status: "pending", intervalMs: pending.intervalMs * 2 };
    const code = r.json.authorization_code;
    const verifier = r.json.code_verifier;
    if (!r.ok || typeof code !== "string" || typeof verifier !== "string") {
      await rm(file("chatgpt-pending.json"), { force: true });
      return { status: "expired" };
    }
    const t = await this.send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${ISSUER}/deviceauth/callback`,
        client_id: CHATGPT_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    });
    await rm(file("chatgpt-pending.json"), { force: true });
    const access = t.json.access_token;
    const refresh = t.json.refresh_token;
    if (!t.ok || typeof access !== "string" || typeof refresh !== "string") throw new Error(`OpenAI did not issue tokens (${t.status}).`);
    await this.saveTokens({ accessToken: access, refreshToken: refresh, expiresAt: expiryOf(access, t.json.expires_in, this.now()) });
    return { status: "ok" };
  }

  /** A valid access token, refreshed and saved when close to expiry. Null when signed out. */
  async accessToken(): Promise<string | null> {
    const current = await this.loadTokens();
    if (!current) return null;
    if (current.expiresAt - REFRESH_SKEW_MS > this.now()) return current.accessToken;
    const r = await this.send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: CHATGPT_CLIENT_ID }).toString(),
    });
    const access = r.json.access_token;
    if (!r.ok || typeof access !== "string") return null;
    // The refresh token may rotate; keep the new one when OpenAI sends it.
    const refresh = typeof r.json.refresh_token === "string" && r.json.refresh_token ? r.json.refresh_token : current.refreshToken;
    await this.saveTokens({ accessToken: access, refreshToken: refresh, expiresAt: expiryOf(access, r.json.expires_in, this.now()) });
    return access;
  }

  async signedIn(): Promise<boolean> {
    return (await this.loadTokens()) !== null;
  }

  async signOut(): Promise<void> {
    await rm(file("chatgpt-oauth.json"), { force: true });
    await rm(file("chatgpt-pending.json"), { force: true });
  }

  async loadTokens(): Promise<ChatgptTokens | null> {
    try {
      const t = JSON.parse(await readFile(file("chatgpt-oauth.json"), "utf8")) as Partial<ChatgptTokens>;
      if (typeof t.accessToken !== "string" || typeof t.refreshToken !== "string") return null;
      return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: typeof t.expiresAt === "number" ? t.expiresAt : 0 };
    } catch {
      return null;
    }
  }

  private async saveTokens(tokens: ChatgptTokens): Promise<void> {
    await ensureHome();
    await writeFile(file("chatgpt-oauth.json"), JSON.stringify(tokens), { mode: 0o600 });
  }

  private async loadPending(): Promise<Pending | null> {
    try {
      const p = JSON.parse(await readFile(file("chatgpt-pending.json"), "utf8")) as Pending;
      return typeof p.deviceAuthId === "string" && this.now() - p.at < PENDING_TTL_MS ? p : null;
    } catch {
      return null;
    }
  }

  private async savePending(pending: Pending): Promise<void> {
    await ensureHome();
    await writeFile(file("chatgpt-pending.json"), JSON.stringify(pending), { mode: 0o600 });
  }
}

export const chatgptAuth = new ChatgptAuth();

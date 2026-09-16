import { join } from "node:path";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { ensureHome, HOME_DIR } from "./home";

// Sesion PerkOS del usuario via PerkOS-OAuth (oauth.perkos.xyz), la fachada
// OAuth 2.0 sobre el login por firma de wallet que PerkOS ya corre:
//   GET  {PERKOS_API}/auth/nonce?address=0x..      -> { nonce, message, expiresAt }
//   (el usuario firma `message` con su wallet Privy)
//   POST {OAUTH}/oauth2/token wallet-signature      -> { access_token (15 min), refresh_token (30 d) }
//   POST {OAUTH}/oauth2/token refresh_token         -> access nuevo sin volver a firmar
//   Bearer access_token en PerkOS API (/agents, /agents/:id/task, ...).
// Floor no lleva ninguna key: solo URLs publicas. La firma la hace el usuario;
// la decision de acceso (allowlist, saldo de infra) la toma PerkOS API en cada
// request. La sesion vive en ~/.perkos-xyz/perkos-session.json (0600).

export const PERKOS_API_URL = (process.env.PERKOS_API_URL || "https://api.perkos.xyz").replace(/\/$/, "");
export const PERKOS_OAUTH_URL = (process.env.PERKOS_OAUTH_URL || "https://oauth.perkos.xyz").replace(/\/$/, "");
const OAUTH_SCOPE = "board:read board:write agent:read";
const WALLET_GRANT = "urn:perkos:oauth:grant-type:wallet-signature";

const dir = HOME_DIR;
const file = join(dir, "perkos-session.json");

export type PerkosSession = {
  wallet: string;        // lowercase
  role?: string;
  scope?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;         // ms epoch del access token
  refreshExpiresAt: number;  // ms epoch del refresh token
  signedAt: number;
};

export class PerkosApiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string, readonly body?: unknown) {
    super(message);
  }
}

export function perkosConfigured(): boolean {
  return true; // solo URLs publicas; nada que configurar en el cliente
}

export async function loadPerkosSession(): Promise<PerkosSession | null> {
  ensureHome();
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PerkosSession>;
    if (typeof raw.wallet !== "string" || typeof raw.accessToken !== "string" || typeof raw.refreshToken !== "string") return null;
    return {
      wallet: raw.wallet.toLowerCase(),
      role: typeof raw.role === "string" ? raw.role : undefined,
      scope: typeof raw.scope === "string" ? raw.scope : undefined,
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      expiresAt: Number(raw.expiresAt) || 0,
      refreshExpiresAt: Number(raw.refreshExpiresAt) || 0,
      signedAt: Number(raw.signedAt) || 0
    };
  } catch {
    return null;
  }
}

export async function savePerkosSession(s: PerkosSession): Promise<void> {
  ensureHome();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(s)}\n`, { mode: 0o600 });
}

export async function clearPerkosSession(): Promise<void> {
  ensureHome();
  try { await unlink(file); } catch {}
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function errorOf(body: unknown, fallback: string): { message: string; code?: string } {
  if (!isRecord(body)) return { message: fallback };
  const nested = isRecord(body.error) ? body.error : undefined;
  const message =
    typeof body.message === "string" ? body.message
    : typeof body.error === "string" ? body.error
    : nested && typeof nested.message === "string" ? nested.message
    : fallback;
  const code = nested && typeof nested.code === "string" ? nested.code : typeof body.code === "string" ? body.code : undefined;
  return { message, code };
}

/** Request crudo a PerkOS API (con o sin Bearer). */
export async function perkosRequest<T>(path: string, init: RequestInit & { idToken?: string; timeoutMs?: number } = {}): Promise<T> {
  const { idToken, timeoutMs = 20_000, ...rest } = init;
  const res = await fetch(`${PERKOS_API_URL}/${path.replace(/^\//, "")}`, {
    ...rest,
    headers: {
      accept: "application/json",
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      ...(rest.headers as Record<string, string> | undefined)
    },
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs)
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = errorOf(body, `PerkOS API ${res.status}`);
    throw new PerkosApiError(res.status, e.code, e.message, body);
  }
  return body as T;
}

// ---------- login ----------

export async function perkosNonce(address: string): Promise<{ nonce: string; message: string; expiresAt: number | string }> {
  return perkosRequest(`/auth/nonce?address=${encodeURIComponent(address.toLowerCase())}`, { timeoutMs: 15_000 });
}

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
  payment?: unknown;
};

async function oauthToken(body: Record<string, unknown>): Promise<TokenResponse> {
  const res = await fetch(`${PERKOS_OAUTH_URL}/oauth2/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const j = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !j.access_token) {
    throw new PerkosApiError(res.status, j.error, j.error_description || j.error || `PerkOS OAuth ${res.status}`, j);
  }
  return j;
}

function decodeRole(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")) as { role?: string };
    return typeof payload.role === "string" ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

function sessionFrom(wallet: string, t: TokenResponse, prev?: PerkosSession): PerkosSession {
  const now = Date.now();
  return {
    wallet: wallet.toLowerCase(),
    role: decodeRole(t.access_token!) ?? prev?.role,
    scope: t.scope ?? prev?.scope,
    accessToken: t.access_token!,
    refreshToken: t.refresh_token || prev?.refreshToken || "",
    expiresAt: now + (Number(t.expires_in) || 900) * 1000,
    refreshExpiresAt: t.refresh_token ? now + (Number(t.refresh_expires_in) || 30 * 86400) * 1000 : prev?.refreshExpiresAt ?? 0,
    signedAt: prev?.signedAt ?? now
  };
}

/**
 * Canje de firma -> sesion. 402 = la wallet no tiene infra PerkOS activa
 * (PerkOS-OAuth reenvia `payment`); se propaga como PerkosApiError(402).
 */
export async function perkosSignIn(input: { address: string; nonce: string; signature: string; chainId?: number }): Promise<PerkosSession> {
  const address = input.address.toLowerCase();
  const t = await oauthToken({
    grant_type: WALLET_GRANT,
    address,
    nonce: input.nonce,
    signature: input.signature,
    scope: OAUTH_SCOPE
  });
  const s = sessionFrom(address, t);
  s.signedAt = Date.now();
  await savePerkosSession(s);
  return s;
}

/** Access token vigente para `wallet` (refresca si vence en < 60 s). null si toca firmar. */
export async function getPerkosIdToken(wallet?: string): Promise<{ idToken: string; session: PerkosSession } | null> {
  const s = await loadPerkosSession();
  if (!s) return null;
  if (wallet && s.wallet !== wallet.toLowerCase()) return null;
  if (s.expiresAt - Date.now() > 60_000) return { idToken: s.accessToken, session: s };
  if (!s.refreshToken || (s.refreshExpiresAt && s.refreshExpiresAt <= Date.now())) return null;
  try {
    const t = await oauthToken({ grant_type: "refresh_token", refresh_token: s.refreshToken });
    const next = sessionFrom(s.wallet, t, s);
    await savePerkosSession(next);
    return { idToken: next.accessToken, session: next };
  } catch {
    return null; // refresh rechazado: toca firmar de nuevo
  }
}

export function publicPerkosSession(s: PerkosSession | null, wallet?: string) {
  const match = Boolean(s && (!wallet || s.wallet === wallet.toLowerCase()));
  return {
    configured: perkosConfigured(),
    connected: match,
    wallet: match && s ? s.wallet : "",
    role: match && s ? s.role ?? null : null,
    signedAt: match && s ? s.signedAt : 0,
    scope: match && s ? s.scope ?? "" : "",
    apiUrl: PERKOS_API_URL,
    oauthUrl: PERKOS_OAUTH_URL
  };
}

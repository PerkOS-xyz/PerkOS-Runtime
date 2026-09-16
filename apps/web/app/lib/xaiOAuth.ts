// Login con la suscripcion de Grok (xAI) por device code, siguiendo la ruta
// de Hermes (hermes_cli/auth_xai.py + auth_constants.py): proveedor
// "xai-oauth", inferencia por Responses API contra api.x.ai/v1.
//
// El bearer de suscripcion sirve para chat, pero NO para endpoints medidos por
// API (TTS/STT devuelven 403; Hermes lo documenta en tools/xai_http.py).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HOME_DIR } from "./home";

export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
// Hermes: DEFAULT_XAI_OAUTH_BASE_URL, override por XAI_BASE_URL.
export const XAI_OAUTH_BASE_URL = (process.env.XAI_BASE_URL?.trim().replace(/\/+$/, "") || "https://api.x.ai/v1");
export const XAI_DEFAULT_MODEL = "grok-4.6";
export const XAI_USER_AGENT = `PerkOS/${process.env.PERKOS_APP_VERSION?.trim() || "dev"}`;
// Originator registrado con el client id en xAI: se queda aunque el app ya no se llame Floor.
export const XAI_ORIGINATOR = "perkos-floor";

const DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const USER_AGENT = XAI_USER_AGENT;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;
const REFRESH_SKEW_MS = 60_000;

export type XaiTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  idToken?: string;
};

export type XaiDeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
};

type Discovery = { deviceAuthorizationEndpoint: string; tokenEndpoint: string };

let discoveryCache: Discovery | null = null;

function trusted(url: string, what: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:" || !(u.hostname === "auth.x.ai" || u.hostname.endsWith(".x.ai"))) {
    throw new Error(`xAI OAuth ${what} is not on a trusted host: ${u.hostname}`);
  }
  return url;
}

async function discover(): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(DISCOVERY_URL, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`xAI OAuth discovery failed: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const dev = json.device_authorization_endpoint;
  const tok = json.token_endpoint;
  if (typeof dev !== "string" || typeof tok !== "string") {
    throw new Error("xAI OAuth discovery response is missing device code endpoints");
  }
  discoveryCache = {
    deviceAuthorizationEndpoint: trusted(dev, "device authorization endpoint"),
    tokenEndpoint: trusted(tok, "token endpoint")
  };
  return discoveryCache;
}

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

function secondsToMs(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n * 1000) : undefined;
}

function parseTokens(body: unknown, requireRefresh: boolean): XaiTokens {
  const j = (body ?? {}) as Record<string, unknown>;
  const accessToken = typeof j.access_token === "string" ? j.access_token : "";
  const refreshToken = typeof j.refresh_token === "string" ? j.refresh_token : "";
  if (!accessToken) throw new Error("xAI OAuth token response is missing access_token");
  if (requireRefresh && !refreshToken) {
    throw new Error(
      "xAI OAuth token response is missing refresh_token. Re-run the login; if it persists the offline_access scope was rejected."
    );
  }
  const expiresInMs = secondsToMs(j.expires_in) ?? 3600_000;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresInMs,
    idToken: typeof j.id_token === "string" ? j.id_token : undefined
  };
}

/** Paso 1: pide un device code. Devuelve el codigo para mostrar y la URL a abrir. */
export async function startXaiDeviceLogin(): Promise<XaiDeviceStart> {
  const { deviceAuthorizationEndpoint } = await discover();
  const res = await fetch(deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: form({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`xAI device code request failed: HTTP ${res.status} ${JSON.stringify(j)}`);
  const deviceCode = j.device_code;
  const userCode = j.user_code;
  const verificationUri = j.verification_uri;
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUri !== "string") {
    throw new Error("xAI device code response is missing device_code, user_code, or verification_uri");
  }
  const complete = j.verification_uri_complete;
  return {
    deviceCode,
    userCode,
    verificationUri: trusted(verificationUri, "device verification URI"),
    verificationUriComplete:
      typeof complete === "string" && complete ? trusted(complete, "complete device verification URI") : undefined,
    expiresAt: Date.now() + (secondsToMs(j.expires_in) ?? 600_000),
    intervalMs: secondsToMs(j.interval) ?? DEFAULT_INTERVAL_MS
  };
}

export type XaiPollResult =
  | { status: "pending"; intervalMs: number }
  | { status: "ok"; tokens: XaiTokens }
  | { status: "denied" }
  | { status: "expired" };

/** Paso 2: un intento de canje. El cliente llama esto cada `intervalMs`. */
export async function pollXaiDeviceLogin(deviceCode: string, intervalMs: number): Promise<XaiPollResult> {
  const { tokenEndpoint } = await discover();
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: form({ grant_type: DEVICE_GRANT, client_id: XAI_OAUTH_CLIENT_ID, device_code: deviceCode }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const body = await res.json().catch(() => null);
  if (res.ok) return { status: "ok", tokens: parseTokens(body, true) };
  const error = typeof (body as { error?: unknown })?.error === "string" ? (body as { error: string }).error : "";
  if (error === "authorization_pending") return { status: "pending", intervalMs: Math.max(intervalMs, MIN_INTERVAL_MS) };
  if (error === "slow_down") return { status: "pending", intervalMs: intervalMs + SLOW_DOWN_INCREMENT_MS };
  if (error === "access_denied" || error === "authorization_denied") return { status: "denied" };
  if (error === "expired_token") return { status: "expired" };
  throw new Error(`xAI device token exchange failed: HTTP ${res.status} ${JSON.stringify(body)}`);
}

/** Refresh. xAI rota el refresh_token: hay que persistir el nuevo siempre. */
export async function refreshXaiTokens(tokens: XaiTokens): Promise<XaiTokens> {
  const { tokenEndpoint } = await discover();
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: form({ grant_type: "refresh_token", client_id: XAI_OAUTH_CLIENT_ID, refresh_token: tokens.refreshToken }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`xAI OAuth refresh failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  const next = parseTokens(body, false);
  // Si el servidor no devolvio refresh nuevo, conservamos el anterior.
  return { ...next, refreshToken: next.refreshToken || tokens.refreshToken };
}

// --- persistencia: ~/.perkos-xyz/xai-oauth.json (0600) ---------------------

const dir = HOME_DIR;
const file = join(dir, "xai-oauth.json");

export async function loadXaiTokens(): Promise<XaiTokens | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<XaiTokens>;
    if (typeof raw.accessToken !== "string" || typeof raw.refreshToken !== "string") return null;
    return {
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
      idToken: typeof raw.idToken === "string" ? raw.idToken : undefined
    };
  } catch {
    return null;
  }
}

export async function saveXaiTokens(tokens: XaiTokens | null): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(tokens ?? {})}\n`, { mode: 0o600 });
}

/** Como Hermes (_xai_jwt_exp): el exp real vive en el JWT del access token. */
function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function isXaiConnected(): Promise<boolean> {
  return (await loadXaiTokens()) !== null;
}

/** Devuelve un access token vigente, refrescando (y persistiendo) si hace falta. */
export async function getXaiAccessToken(): Promise<string | null> {
  const tokens = await loadXaiTokens();
  if (!tokens) return null;
  const exp = jwtExpMs(tokens.accessToken) ?? tokens.expiresAt;
  if (exp - REFRESH_SKEW_MS > Date.now()) return tokens.accessToken;
  const next = await refreshXaiTokens(tokens);
  await saveXaiTokens(next);
  return next.accessToken;
}

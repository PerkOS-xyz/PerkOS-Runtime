/**
 * Wallet sign-in to PerkOS.
 *
 *   GET  {api}/auth/nonce?address=0x..   -> { nonce, message, expiresAt }
 *   (the wallet signs `message`)
 *   POST {oauth}/oauth2/token            -> access token (short) + refresh token (long)
 *
 * The access token is sent as a Bearer token to the PerkOS API. No keys are
 * held here; access decisions are made by PerkOS on each request.
 */

import { PerkosApiError } from "./client.js";

export const WALLET_GRANT = "urn:perkos:oauth:grant-type:wallet-signature";
export const DEFAULT_SCOPE = "board:read board:write agent:read";

export interface PerkosSession {
  /** Lowercase address. */
  wallet: string;
  accessToken: string;
  refreshToken: string;
  /** Access token expiry, ms since epoch. */
  expiresAt: number;
  /** Refresh token expiry, ms since epoch; 0 when there is none. */
  refreshExpiresAt: number;
  scope?: string;
}

export interface SignInChallenge {
  nonce: string;
  message: string;
}

export interface PerkosAuthOptions {
  apiUrl?: string;
  oauthUrl?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class PerkosAuth {
  private readonly apiUrl: string;
  private readonly oauthUrl: string;
  private readonly scope: string;
  private readonly http: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: PerkosAuthOptions = {}) {
    this.apiUrl = (options.apiUrl ?? "https://api.perkos.xyz").replace(/\/+$/, "");
    this.oauthUrl = (options.oauthUrl ?? "https://oauth.perkos.xyz").replace(/\/+$/, "");
    this.scope = options.scope ?? DEFAULT_SCOPE;
    this.http = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** Message for the wallet to sign. */
  async challenge(address: string): Promise<SignInChallenge> {
    if (!ADDRESS.test(address)) throw new PerkosApiError("Not a wallet address", 400, "PERKOS_ADDRESS");
    const body = await this.call(`${this.apiUrl}/auth/nonce?address=${address.toLowerCase()}`);
    if (typeof body.nonce !== "string" || typeof body.message !== "string") {
      throw new PerkosApiError("Unexpected nonce response", 502, "PERKOS_API");
    }
    return { nonce: body.nonce, message: body.message };
  }

  /** Exchanges the signed challenge for a session. */
  async signIn(input: { address: string; nonce: string; signature: string }): Promise<PerkosSession> {
    const wallet = input.address.toLowerCase();
    const token = await this.token({
      grant_type: WALLET_GRANT,
      address: wallet,
      nonce: input.nonce,
      signature: input.signature,
      scope: this.scope,
    });
    return this.session(wallet, token);
  }

  /** New access token from the refresh token. */
  async refresh(session: PerkosSession): Promise<PerkosSession> {
    const token = await this.token({ grant_type: "refresh_token", refresh_token: session.refreshToken });
    return this.session(session.wallet, token, session);
  }

  /**
   * A session valid for at least `marginMs`, refreshing it when needed.
   * Returns null when the wallet has to sign again.
   */
  async fresh(session: PerkosSession, marginMs = 60_000): Promise<PerkosSession | null> {
    const now = this.now();
    if (session.expiresAt - now > marginMs) return session;
    if (!session.refreshToken || (session.refreshExpiresAt && session.refreshExpiresAt <= now)) return null;
    try {
      return await this.refresh(session);
    } catch (err) {
      if (err instanceof PerkosApiError && err.code === "PERKOS_UNREACHABLE") throw err;
      return null;
    }
  }

  private session(wallet: string, t: TokenResponse, prev?: PerkosSession): PerkosSession {
    const now = this.now();
    const out: PerkosSession = {
      wallet,
      accessToken: t.access_token ?? "",
      refreshToken: t.refresh_token || prev?.refreshToken || "",
      expiresAt: now + (Number(t.expires_in) || 900) * 1000,
      refreshExpiresAt: t.refresh_token
        ? now + (Number(t.refresh_expires_in) || 30 * 86_400) * 1000
        : (prev?.refreshExpiresAt ?? 0),
    };
    const scope = t.scope ?? prev?.scope;
    if (scope) out.scope = scope;
    return out;
  }

  private async token(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.call(`${this.oauthUrl}/oauth2/token`, body);
    const t = res as TokenResponse;
    if (!t.access_token) throw new PerkosApiError("No access token in response", 502, "PERKOS_SIGNIN");
    return t;
  }

  private async call(url: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.http(url, {
        method: body ? "POST" : "GET",
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new PerkosApiError(`PerkOS did not answer: ${(err as Error).message}`, 0, "PERKOS_UNREACHABLE");
    }
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return payload;
    if (res.status === 402) {
      throw new PerkosApiError("This wallet has no active PerkOS infrastructure", 402, "INFRA_PAYMENT_REQUIRED");
    }
    const description = typeof payload.error_description === "string" ? payload.error_description : undefined;
    const message = description ?? (typeof payload.message === "string" ? payload.message : `PerkOS answered ${res.status}`);
    const code = typeof payload.error === "string" ? payload.error : typeof payload.code === "string" ? payload.code : "PERKOS_SIGNIN";
    throw new PerkosApiError(message, res.status, code);
  }
}

/**
 * One way in to the PerkOS services.
 *
 * Every client of Runtime talks to the same API: the desktop app today, a web
 * one later. Writing the calls once, typed, is what keeps the two from
 * drifting into two slightly different ideas of the same platform.
 *
 * The session token is read on each call rather than captured, because it is
 * refreshed while the app is open and a captured one goes stale in the middle
 * of a desk turn.
 */

export interface PerkosClientOptions {
  /** Defaults to production. */
  baseUrl?: string;
  /** The current session token, or undefined while signed out. */
  token?: () => string | undefined;
  /** Swappable for tests. */
  fetchImpl?: typeof fetch;
  /** Cut a call off after this long. A desk turn is waiting behind it. */
  timeoutMs?: number;
}

export class PerkosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "PERKOS_API",
  ) {
    super(message);
    this.name = "PerkosApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** A call that is fine to make signed out, such as a public catalogue. */
  anonymous?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class PerkosClient {
  readonly baseUrl: string;
  private readonly token: () => string | undefined;
  private readonly http: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PerkosClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.perkos.xyz").replace(/\/+$/, "");
    this.token = options.token ?? (() => undefined);
    this.http = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    const token = options.anonymous ? undefined : this.token();
    if (!token && !options.anonymous) {
      throw new PerkosApiError("Sign in to PerkOS first", 401, "PERKOS_SESSION");
    }
    let res: Response;
    try {
      res = await this.http(url.toString(), {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      throw new PerkosApiError(`PerkOS did not answer: ${(err as Error).message}`, 0, "PERKOS_UNREACHABLE");
    }
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // PerkOS nests the reason under `error` ({ error: { message, code } }); a few routes still answer it flat.
      const nested = typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>) : {};
      const message =
        typeof nested.message === "string" ? nested.message : typeof payload.message === "string" ? payload.message : `PerkOS answered ${res.status}`;
      const code = typeof nested.code === "string" ? nested.code : typeof payload.code === "string" ? payload.code : "PERKOS_API";
      throw new PerkosApiError(message, res.status, code);
    }
    return payload as T;
  }
}

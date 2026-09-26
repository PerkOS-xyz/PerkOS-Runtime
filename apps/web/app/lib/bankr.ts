/**
 * Bankr's API, as this app calls it: a GET or a POST, with the person's key
 * when the call needs one, a deadline on every call, and Bankr's refusals read
 * into one shape the routes can pass on.
 *
 * The key travels in the X-API-Key header and nowhere else: never in a URL,
 * an answer to the window, an error or a log line.
 */

export const BANKR_API = "https://api.bankr.bot";

export type Http = (input: string, init?: RequestInit) => Promise<Response>;

/** Global fetch, read at call time so a test can stand in for it. */
export const defaultHttp: Http = (input, init) => fetch(input, init);

/** Why Bankr did not do what was asked. */
export interface BankrRefusal {
  /** Bankr's HTTP status; 0 when it did not answer at all. */
  status: number;
  /** Bankr's own code when it gives one ("TOKEN_LAUNCH_NOT_AVAILABLE"), or BANKR_<status>, BANKR_TIMEOUT, BANKR_UNREACHABLE. */
  code: string;
  message: string;
  /** Seconds Bankr asks to wait before trying again (Retry-After). */
  retryAfter?: number;
}

export type BankrAnswer<T> = { ok: true; status: number; data: T } | ({ ok: false } & BankrRefusal);

export interface BankrCallOptions {
  key?: string | null;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  http?: Http;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** A key never comes back in a message, whatever Bankr echoes. */
const redact = (message: string, key?: string | null): string => (key && message.includes(key) ? message.split(key).join("[key]") : message);

/** Retry-After in seconds, from a number of seconds or an HTTP date. */
function retryAfter(res: Response, now = Date.now()): number | undefined {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined;
}

const FALLBACK: Record<number, string> = {
  400: "Bankr refused the request.",
  401: "Bankr did not accept the key.",
  403: "Bankr refused this for the key's wallet.",
  404: "Bankr has no such thing.",
  429: "Bankr's limit for this wallet is reached for now.",
  503: "Bankr could not check this right now.",
};

/** What a refusal says, from Bankr's answer: { error, message, code } in any of the shapes it uses. */
export function refusalOf(res: Response, json: Record<string, unknown>, key?: string | null): BankrRefusal {
  const nested = typeof json.error === "object" && json.error !== null ? (json.error as Record<string, unknown>) : {};
  const error = text(json.error);
  const code = [text(json.code), text(nested.code), error].find((c) => CODE.test(c)) ?? `BANKR_${res.status}`;
  const said = [text(json.message), text(nested.message), text(json.detail), CODE.test(error) ? "" : error].find(Boolean);
  const message = redact((said ?? FALLBACK[res.status] ?? `Bankr answered ${res.status}.`).slice(0, 300), key);
  const wait = retryAfter(res);
  return { status: res.status, code, message, ...(wait !== undefined ? { retryAfter: wait } : {}) };
}

export async function bankrCall<T = Record<string, unknown>>(path: string, options: BankrCallOptions = {}): Promise<BankrAnswer<T>> {
  const { key, method = "GET", body, timeoutMs = 15_000, http = defaultHttp } = options;
  let res: Response;
  try {
    res = await http(`${BANKR_API}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "x-api-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = (err as Error | undefined)?.name === "TimeoutError";
    return timeout
      ? { ok: false, status: 0, code: "BANKR_TIMEOUT", message: "Bankr did not answer in time." }
      : { ok: false, status: 0, code: "BANKR_UNREACHABLE", message: "Could not reach Bankr." };
  }
  const json = (await res.json().catch(() => ({}))) as unknown;
  const obj = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  if (!res.ok || obj.success === false) return { ok: false, ...refusalOf(res, obj, key) };
  return { ok: true, status: res.status, data: json as T };
}

/** The Bankr wallet behind a key: where launches go out from and who pays their gas. */
export interface BankrMe {
  /** Lowercase EVM address. */
  address: string;
  club: boolean;
  /** Linked sign-ins, such as "twitter" or "farcaster". */
  socials: string[];
}

/** GET /wallet/me, which any valid key may call. */
export async function bankrMe(key: string, http: Http = defaultHttp): Promise<BankrAnswer<BankrMe>> {
  const r = await bankrCall<Record<string, unknown>>("/wallet/me", { key, http });
  if (!r.ok) return r;
  const wallets = Array.isArray(r.data.wallets) ? (r.data.wallets as Array<Record<string, unknown>>) : [];
  const evm = wallets.find((w) => w?.chain === "evm" && typeof w.address === "string" && ADDRESS.test(w.address))?.address as string | undefined;
  if (!evm) return { ok: false, status: 502, code: "BANKR_NO_WALLET", message: "Bankr did not name an EVM wallet for this key." };
  const socials = (Array.isArray(r.data.socialAccounts) ? (r.data.socialAccounts as Array<Record<string, unknown>>) : [])
    .map((s) => text(s?.platform).toLowerCase())
    .filter(Boolean);
  const club = typeof r.data.bankrClub === "object" && r.data.bankrClub !== null && (r.data.bankrClub as Record<string, unknown>).active === true;
  return { ok: true, status: r.status, data: { address: evm.toLowerCase(), club, socials } };
}

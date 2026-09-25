/**
 * Access check for the local API.
 *
 * The server listens on 127.0.0.1 without its own session. Without this check,
 * any page open on the machine could call /api/* (cross-site POST with a
 * text/plain body, or DNS rebinding). Checks:
 *
 *   1. Host: loopback only.
 *   2. Sec-Fetch-Site: same-origin or none.
 *   3. Per-launch token (PERKOS_API_TOKEN), when the server is started with one.
 */

const TOKEN = process.env.PERKOS_API_TOKEN?.trim() || "";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function deny(reason: string): Response {
  return Response.json({ error: "forbidden", reason }, { status: 403 });
}

// Constant-time compare without node:crypto: the proxy may run outside Node.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function guard(req: Request): Response | null {
  const h = req.headers;
  const host = (h.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  if (host && !LOOPBACK.has(host)) return deny("host");
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return deny("origin");
  if (req.method !== "GET" && req.method !== "HEAD") {
    const ct = (h.get("content-type") || "").toLowerCase();
    if (ct.startsWith("text/plain") || ct.startsWith("application/x-www-form-urlencoded")) return deny("content-type");
  }
  if (TOKEN) {
    const got = h.get("x-perkos-token") || new URL(req.url).searchParams.get("t") || "";
    if (!same(got, TOKEN)) return deny("token");
  }
  return null;
}

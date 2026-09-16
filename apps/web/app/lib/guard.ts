// Puerta de la API local. El servidor escucha en 127.0.0.1 sin sesion: sin
// esto cualquier pagina abierta en la Mac puede llamar a /api/* (CSRF con un
// cuerpo text/plain, o DNS rebinding para leer respuestas). Tres capas:
//  1. Host: solo loopback (el rebinding llega con el host del atacante).
//  2. Sec-Fetch-Site: los navegadores marcan las peticiones cross-site.
//  3. Token por arranque (PERKOS_API_TOKEN): el shell (apps/desktop) lo pasa al
//     servidor por env y a la ventana en la URL de carga; la ventana lo manda en
//     x-perkos-token. Sin shell (next dev a secas) no hay token y se omite.
// Se aplica a todo /api en proxy.ts y ademas a mano en las rutas con efectos.
const TOKEN = process.env.PERKOS_API_TOKEN?.trim() || "";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function deny(reason: string): Response {
  return Response.json({ error: "forbidden", reason }, { status: 403 });
}

// Comparacion en tiempo constante sin node:crypto (proxy.ts puede correr fuera de Node).
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasApiToken(): boolean { return TOKEN.length > 0; }

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

"use client";

// Token de la API local. El shell (apps/desktop) lo pone en la URL de carga
// (?t=...); aqui se guarda en sessionStorage, se quita de la URL y se anade a
// cada fetch a /api como x-perkos-token. Sin shell no hay token y no pasa nada.
// Se importa una vez desde FloorApp: el parche a window.fetch cubre todo.
const KEY = "perkos.apiToken";

function readToken(): string {
  try {
    const u = new URL(window.location.href);
    const t = u.searchParams.get("t");
    if (t) {
      sessionStorage.setItem(KEY, t);
      u.searchParams.delete("t");
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      return t;
    }
    return sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

declare global { interface Window { __perkosFetchPatched?: boolean } }

if (typeof window !== "undefined" && !window.__perkosFetchPatched) {
  const token = readToken();
  if (token) {
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const local = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
      if (!local) return orig(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-perkos-token", token);
      return orig(input, { ...init, headers });
    };
  }
  window.__perkosFetchPatched = true;
}

export {};

"use client";

// Log de debug de la app. Cualquier componente hace flog("info", "...") y el
// ErrorDock (barra inferior) lo muestra. Los "error" abren el dock solos.
// Tambien se espeja a apps/web/.floor-debug.log, PERO en lotes: un POST por
// linea saturaba las 6 conexiones por host de Chromium y dejaba al chat y al
// TTS esperando detras del long-poll (medido: 53 s por una sintesis).
export type LogLevel = "info" | "warn" | "error";

type Row = { level: LogLevel; msg: string; at: number };
let batch: Row[] = [];
let timer = 0;

function flush() {
  timer = 0;
  if (!batch.length) return;
  const rows = batch;
  batch = [];
  try {
    void fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
      keepalive: true
    }).catch(() => undefined);
  } catch {}
}

export function flog(level: LogLevel, msg: string) {
  if (typeof window === "undefined") return;
  const at = Date.now();
  window.dispatchEvent(new CustomEvent("floor:log", { detail: { level, msg, at } }));
  const line = `[floor] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  batch.push({ level, msg, at });
  if (!timer) timer = window.setTimeout(flush, 1500);
}

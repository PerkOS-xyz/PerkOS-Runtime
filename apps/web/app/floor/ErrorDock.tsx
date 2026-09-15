"use client";

import { useEffect, useRef, useState } from "react";
import type { LogLevel } from "./log";

type Row = { id: number; level: LogLevel; msg: string; at: string };

// Panel de debug lateral (derecha). Oculto por defecto; se activa en Settings
// (Show debug panel) o con Cmd/Ctrl+Shift+D, y se abre solo ante un error.
// Recibe flog() de toda la app mas window.error / unhandledrejection.
// Siempre montado (aunque oculto) para no perder el log.
export default function ErrorDock({ open, onOpen }: { open: boolean; onOpen: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const errors = rows.filter((r) => r.level === "error").length;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const add = (level: LogLevel, raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim().slice(0, 600);
      if (!text) return;
      setRows((r) => [{ id: Date.now() + Math.random(), level, msg: text, at: new Date().toLocaleTimeString() }, ...r].slice(0, 80));
      if (level === "error") onOpenRef.current(true);
    };
    const onLog = (e: Event) => {
      const d = (e as CustomEvent<{ level: LogLevel; msg: string }>).detail;
      add(d.level, d.msg);
    };
    const onErr = (e: ErrorEvent) => add("error", e.message || String(e.error ?? "error"));
    const onRej = (e: PromiseRejectionEvent) => {
      const x = e.reason;
      add("error", x instanceof Error ? `${x.name}: ${x.message}` : String(x));
    };
    window.addEventListener("floor:log", onLog);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    add("info", "Floor ready");
    return () => {
      window.removeEventListener("floor:log", onLog);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  if (!open) return null;
  return (
    <aside className={`debug-dock${errors ? " has-err" : ""}`} aria-label="Debug log">
      <div className="debug-bar">
        <span>Debug · {rows.length}{errors ? ` · ${errors} err` : ""}</span>
        <span className="debug-actions">
          <button type="button" onClick={() => setRows([])}>Clear</button>
          <button type="button" onClick={() => onOpen(false)} aria-label="Hide debug panel">Hide</button>
        </span>
      </div>
      <div className="debug-rows">
        {rows.map((r) => (
          <p key={r.id} className={`lv-${r.level}`}>
            <small>{r.at}</small> {r.msg}
          </p>
        ))}
      </div>
    </aside>
  );
}

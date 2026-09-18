"use client";

import { useEffect, useRef, useState } from "react";
import type { LogLevel } from "./log";

type Row = { id: number; level: LogLevel; msg: string; at: string };

// Ruido conocido (WalletConnect, Privy, red, navegador). Orden: primero lo mas especifico.
const KNOWN_NOISE: Array<{ test: RegExp; level: LogLevel; msg: string; drop?: boolean }> = [
  { test: /ResizeObserver loop/i, level: "info", msg: "", drop: true },
  { test: /proposal expired/i, level: "info", msg: "walletconnect: an unscanned QR from an earlier login expired" },
  { test: /pairing.*(expired|deleted)|(expired|deleted).*pairing/i, level: "info", msg: "walletconnect: an old pairing expired" },
  { test: /session.*(expired|deleted|disconnected)|no matching key|missing or invalid.*session/i, level: "warn", msg: "walletconnect: the phone session ended; sign in again if you need to sign" },
  { test: /relay|websocket|socket hang up|ws error|closed before/i, level: "info", msg: "walletconnect: relay connection dropped, it reconnects on its own" },
  // Privy, al conectar una wallet de WalletConnect, fija la cadena por defecto antes de que
  // el proveedor del telefono exista. Las dos promesas revientan y la conexion sigue bien.
  { test: /reading 'setDefaultChain'|reading "setDefaultChain"/i, level: "info", msg: "privy: the default chain was set before the phone wallet answered; the wallet connected anyway" },
  { test: /reading 'request'|reading "request"/i, level: "info", msg: "privy: a call reached the wallet provider before it was ready; it retries on its own" },
  { test: /wallet timeout/i, level: "info", msg: "walletconnect: the phone took its time to answer" },
  { test: /user rejected|user denied|user cancel|4001/i, level: "info", msg: "wallet: you declined in the wallet" },
  { test: /abort(ed|error)|operation was aborted/i, level: "info", msg: "request cancelled" },
  { test: /failed to fetch|networkerror|network request failed|load failed|err_network|err_internet_disconnected/i, level: "warn", msg: "network: a request did not reach its server; it retries on the next action" },
  { test: /privy|iframe|postMessage|cross-origin|origin mismatch/i, level: "info", msg: "privy: a message between the login iframe and the window was dropped" },
  { test: /chunkloaderror|loading chunk|dynamically imported module/i, level: "warn", msg: "app: a code chunk did not load; reload the window if something looks stale" }
];

// Panel de debug lateral (derecha). Oculto por defecto; se activa en Settings
// (Show debug panel) o con Cmd/Ctrl+Shift+D, y se abre solo ante un error.
// Recibe flog() de toda la app mas window.error / unhandledrejection.
// Siempre montado (aunque oculto) para no perder el log.
export default function ErrorDock({ open, onOpen }: { open: boolean; onOpen: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const errors = rows.filter((r) => r.level === "error").length;
  const onOpenRef = useRef(onOpen);
  // Clave secuencial: varias lineas en el mismo milisegundo chocaban con Date.now() + Math.random().
  const seq = useRef(0);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const add = (level: LogLevel, raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim().slice(0, 600);
      if (!text) return;
      setRows((r) => [{ id: ++seq.current, level, msg: text, at: new Date().toLocaleTimeString() }, ...r].slice(0, 80));
      if (level === "error") onOpenRef.current(true);
    };
    const onLog = (e: Event) => {
      const d = (e as CustomEvent<{ level: LogLevel; msg: string }>).detail;
      add(d.level, d.msg);
    };
    // Ruido conocido de librerias de terceros: se registra en nuestras palabras, en info o
    // warn, sin abrir el panel ni pintar de rojo. El rojo queda para fallos nuestros
    // (firma, orden, claim, launch, fleet). Revision del 2026-09-17.
    const classify = (raw: string): { level: LogLevel; msg: string } | "drop" | null => {
      for (const n of KNOWN_NOISE) if (n.test.test(raw)) return n.drop ? "drop" : { level: n.level, msg: n.msg };
      return null;
    };
    const fromThird = (raw: string, fallback: string) => {
      const k = classify(raw);
      if (k === "drop") return;
      if (k) { add(k.level, k.msg); return; }
      add("error", fallback);
    };
    const onErr = (e: ErrorEvent) => { const raw = e.message || String(e.error ?? "error"); if (classify(raw)) e.preventDefault(); fromThird(raw, raw); };
    const onRej = (e: PromiseRejectionEvent) => {
      const x = e.reason;
      const raw = x instanceof Error ? `${x.name}: ${x.message}` : String(x);
      if (classify(raw)) e.preventDefault();
      fromThird(raw, raw);
    };
    window.addEventListener("floor:log", onLog);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    add("info", "Sparky ready");
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

"use client";

import { useEffect, useRef, useState } from "react";
import { flog } from "./log";

// Login de xAI por suscripcion (device code), igual que Hermes/grok-cli:
// pedimos un codigo, abrimos auth.x.ai en el browser del sistema, y hacemos
// polling hasta que el usuario autoriza. Los tokens quedan en la maquina.

type Start = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
};

type Phase = "idle" | "starting" | "waiting" | "done" | "error";

export default function XaiConnect({ onConnected, label = "Sign in with your Grok subscription" }: {
  onConnected: () => void;
  label?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState("");
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; }, []);

  async function begin() {
    setError("");
    setPhase("starting");
    stop.current = false;
    let s: Start;
    try {
      const res = await fetch("/api/auth/xai/start", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      s = j as Start;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return;
    }
    flog("info", `xai auth: code ${s.userCode} -> ${s.verificationUri}`);
    setStart(s);
    setPhase("waiting");
    // main.cjs manda window.open al browser del sistema (sesion de X/Grok).
    window.open(s.verificationUriComplete || s.verificationUri, "_blank", "noopener");

    let interval = s.intervalMs || 5000;
    while (!stop.current && Date.now() < s.expiresAt) {
      await new Promise((r) => setTimeout(r, interval));
      if (stop.current) return;
      let r: { status?: string; intervalMs?: number; error?: string };
      try {
        const res = await fetch("/api/auth/xai/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: s.deviceCode, intervalMs: interval })
        });
        r = await res.json();
        if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
      } catch (e) {
        flog("error", `xai auth poll: ${e instanceof Error ? e.message : String(e)}`);
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        return;
      }
      if (r.status === "ok") { flog("info", "xai auth: connected"); setPhase("done"); onConnected(); return; }
      if (r.status === "pending") { interval = r.intervalMs || interval; continue; }
      flog("warn", `xai auth: ${r.status}`);
      setError(r.status === "denied" ? "Authorization was denied in the browser." : "The code expired. Try again.");
      setPhase("error");
      return;
    }
    if (!stop.current) { setError("The code expired. Try again."); setPhase("error"); }
  }

  if (phase === "waiting" && start) {
    return (
      <div className="xai-connect">
        <p className="hint-line">Enter this code at {start.verificationUri.replace(/^https?:\/\//, "")}</p>
        <div className="device-code">{start.userCode}</div>
        <p className="hint-line">Waiting for you to approve in the browser…</p>
        <div className="row">
          <button type="button" onClick={() => window.open(start.verificationUriComplete || start.verificationUri, "_blank", "noopener")}>
            Open browser again
          </button>
          <button type="button" onClick={() => { stop.current = true; setPhase("idle"); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="xai-connect">
      <button type="button" className="cta" disabled={phase === "starting"} onClick={() => void begin()}>
        {phase === "starting" ? "Contacting xAI…" : label}
      </button>
      {phase === "error" ? <p className="hint-line err">{error}</p> : null}
    </div>
  );
}

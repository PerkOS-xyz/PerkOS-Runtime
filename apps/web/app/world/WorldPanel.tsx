"use client";

import { useEffect, useRef, useState } from "react";
import { worldTerminal, type WorldProvider, type WorldRequest, type WorldStatus } from "@perkos/client";
import { bounded, createWorldBridge, requireEnrollmentCompletion, waitForIdkit, waitForWorld, worldMessage, worldRequest, worldStatus, WorldFlowError } from "./flow";
import styles from "./WorldPanel.module.css";

const LABELS: Record<WorldProvider, string> = { idkit: "IDKit · facial presence", oidc: "World ID · browser" };
const PHASES: Record<string, string> = {
  waiting_for_connection: "Scan this QR using the phone with World ID sandbox.",
  awaiting_confirmation: "Complete the presence check and approval on your phone.",
  confirmed: "Proof received. PerkOS is verifying it with World…",
  failed: "World could not complete the request.",
};

/** Mount only while Settings is visible. Closing stops polling and cancels the pending enrollment. */
export function WorldPanel() {
  const [status, setStatus] = useState<WorldStatus | null>(null);
  const [request, setRequest] = useState<WorldRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<string | null>(null);
  const pendingView = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (qr || link) pendingView.current?.scrollIntoView({ block: "nearest" }); }, [qr, link]);

  async function refresh(signal?: AbortSignal) {
    const next = await worldStatus(signal);
    if (!signal?.aborted) setStatus(next);
    return next;
  }
  useEffect(() => {
    const initial = new AbortController();
    void refresh(initial.signal).catch((e: unknown) => {
      if (!initial.signal.aborted && !(e instanceof WorldFlowError && ["WORLD_UNAVAILABLE", "WORLD_INPUT"].includes(e.code))) setError(worldMessage(e));
    });
    return () => {
      initial.abort(); generation.current++; abort.current?.abort();
      const id = pending.current; pending.current = null;
      if (id) void worldRequest(`requests/${id}/cancel`, {}).catch(() => undefined);
    };
  }, []);

  async function begin(provider: WorldProvider) {
    if (busy || !status?.enabled || !status.providers[provider]) return;
    const token = ++generation.current;
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const live = () => generation.current === token && !controller.signal.aborted;
    setBusy(true); setError(""); setSuccess(""); setQr(""); setLink(""); setPhase("Preparing a new World request…");
    let active: WorldRequest | null = null;
    try {
      active = await worldRequest("requests", { provider, purpose: "enroll" }, controller.signal);
      if (!live()) { void worldRequest(`requests/${active.id}/cancel`, {}).catch(() => undefined); return; }
      if (active.provider !== provider || active.purpose !== "enroll") throw new WorldFlowError("WORLD_REQUEST_MISMATCH");
      pending.current = active.id; setRequest(active);
      let completed: WorldRequest;
      if (worldTerminal(active.status)) completed = active;
      else if (provider === "idkit") {
        const deadline = Math.min(active.expiresAt * 1000, Date.now() + 120_000);
        const bridge = await bounded(createWorldBridge(active), controller.signal, deadline - Date.now());
        if (!live()) return;
        const url = new URL(bridge.connectorURI);
        if (url.protocol !== "https:" || url.username || url.password) throw new WorldFlowError("WORLD_SHAPE");
        const { default: QRCode } = await import("qrcode");
        const picture = await QRCode.toDataURL(bridge.connectorURI, { width: 264, margin: 4, errorCorrectionLevel: "M" });
        if (!live()) return;
        setLink(bridge.connectorURI); setQr(picture); setPhase(PHASES.waiting_for_connection!);
        const result = await waitForIdkit(bridge, { signal: controller.signal, timeout: deadline - Date.now(), onStatus: (state) => { if (live()) setPhase(PHASES[state] ?? "Waiting for World…"); } });
        if (!live()) return;
        setQr(""); setLink(""); setPhase("PerkOS is validating the original World proof…");
        completed = await worldRequest(`requests/${active.id}/proof`, { result }, controller.signal);
      } else {
        if (!active.verificationUrl) throw new WorldFlowError("WORLD_SHAPE");
        setLink(active.verificationUrl); setPhase("Open World in your browser and approve. This screen waits for the verified API result.");
        completed = await waitForWorld(active, controller.signal, (id, signal) => worldRequest(`requests/${id}/poll`, {}, signal));
      }
      if (!live()) return;
      requireEnrollmentCompletion(active, completed);
      pending.current = null;
      setSuccess(`${LABELS[provider]} connected. Permission changes still require a fresh verification.`);
      await refresh(controller.signal);
    } catch (e) {
      if (live()) setError(worldMessage(e));
    } finally {
      if (live()) {
        const id = pending.current; pending.current = null;
        if (id) void worldRequest(`requests/${id}/cancel`, {}).catch(() => undefined);
        setBusy(false); setRequest(null); setQr(""); setLink(""); setPhase("");
      }
    }
  }
  async function cancel() {
    generation.current++; abort.current?.abort();
    const id = pending.current; pending.current = null;
    setBusy(false); setRequest(null); setQr(""); setLink(""); setPhase(""); setSuccess("");
    try {
      if (id) {
        const result = await worldRequest(`requests/${id}/cancel`, {});
        if (result.status === "enrolled") { await refresh(); setSuccess("World confirmed enrollment before cancellation. No additional permission was granted."); return; }
        if (!["cancelled", "denied", "expired", "failed", "stale"].includes(result.status)) {
          setError("Stopped waiting. Verification may still be finishing; refresh the status before retrying.");
          return;
        }
      }
      setError("Verification cancelled. No new permission was approved.");
    } catch { setError("Stopped waiting. The cancellation could not be confirmed; refresh the status before retrying."); }
  }

  if (status && !status.enabled) return null;
  if (!status && !error) return null;
  return <section id="world-settings" aria-label="World ID settings">
    <span className="kicker">World ID</span>
    <p className={styles.intro}>Connect the human who controls your agents. A fresh verification protects new delegation and increases to permissions. Reducing limits and revoking access remain available.</p>
    {status ? <><p className={styles.note}>Sandbox · IDKit and browser identities are connected separately.</p>
      <div className={styles.providers}>{(["idkit", "oidc"] as const).map((provider) => <div className={styles.provider} key={provider}>
        <header><strong>{LABELS[provider]}</strong><span className={`${styles.badge} ${status.enrolled[provider] ? styles.connected : ""}`}>{status.enrolled[provider] ? "Connected" : status.providers[provider] ? "Not connected" : "Unavailable"}</span></header>
        <p>{provider === "idkit" ? "Scan a QR with World ID on your phone. PerkOS verifies the proof before linking the session." : "Approve in the external browser. World returns to PerkOS API, and this app reads the result."}</p>
        {status.providers[provider] && !status.enrolled[provider] ? <button type="button" className="chip-btn" disabled={busy} onClick={() => void begin(provider)}>Connect {provider === "idkit" ? "with IDKit" : "in browser"}</button> : null}
      </div>)}</div></> : null}
    {busy ? <div ref={pendingView} className={styles.pending} aria-live="polite">
      <p className={styles.status}>{phase}</p>
      {qr ? <img className={styles.qr} src={qr} width={264} height={264} alt="Scan this World ID verification QR with your phone" /> : null}
      {request ? <p className={styles.note}>Expires {new Date(request.expiresAt * 1000).toLocaleTimeString()}. Keep Settings open until verification finishes.</p> : null}
      <div className={styles.actions}>{link ? <a className="chip-btn" href={link} target="_blank" rel="noopener noreferrer">Open World ↗</a> : null}<button type="button" className="link-btn" onClick={() => void cancel()}>Cancel verification</button></div>
    </div> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {success ? <p className={styles.success} role="status">{success}</p> : null}
    <button type="button" className="link-btn" disabled={busy} onClick={() => { setError(""); void refresh().catch((e: unknown) => setError(worldMessage(e))); }}>Refresh World status</button>
  </section>;
}

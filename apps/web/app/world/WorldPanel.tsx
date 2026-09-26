"use client";

import { useEffect, useRef, useState } from "react";
import { worldTerminal, type WorldProvider, type WorldRequest, type WorldStatus } from "@perkos/client";
import { bounded, cancelWorldRequests, createWorldBridge, finishWorldEnrollment, waitForIdkit, waitForWorld, worldMessage, worldRequest, worldStatus, WorldFlowError } from "./flow";
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
  const [pairing, setPairing] = useState("");
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef(new Set<string>());
  const candidateId = useRef<string | null>(null);
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
      const ids = [...pending.current]; pending.current.clear(); candidateId.current = null;
      void cancelWorldRequests(ids, (id) => worldRequest(`requests/${id}/cancel`, {})).catch(() => undefined);
    };
  }, []);

  async function begin(provider: WorldProvider) {
    if (busy || !status?.enabled || !status.providers[provider]) return;
    const token = ++generation.current;
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const live = () => generation.current === token && !controller.signal.aborted;
    const requireLive = () => { if (!live()) throw new WorldFlowError("cancelled"); };
    setBusy(true); setError(""); setSuccess(""); setQr(""); setLink(""); setPairing(""); setPhase("Preparing a new World request…");
    async function confirm(active: WorldRequest): Promise<WorldRequest> {
      requireLive(); setRequest(active); setQr(""); setLink("");
      if (worldTerminal(active.status)) return active;
      if (active.provider === "idkit") {
        setPhase("Preparing the World ID QR…");
        const deadline = Math.min(active.expiresAt * 1000, Date.now() + 120_000);
        const bridge = await bounded(createWorldBridge(active), controller.signal, deadline - Date.now());
        requireLive();
        const url = new URL(bridge.connectorURI);
        if (url.protocol !== "https:" || url.username || url.password) throw new WorldFlowError("WORLD_SHAPE");
        const { default: QRCode } = await import("qrcode");
        const picture = await QRCode.toDataURL(bridge.connectorURI, { width: 264, margin: 4, errorCorrectionLevel: "M" });
        requireLive();
        setLink(bridge.connectorURI); setQr(picture); setPhase(PHASES.waiting_for_connection!);
        const result = await waitForIdkit(bridge, { signal: controller.signal, timeout: deadline - Date.now(), onStatus: (state) => { if (live()) setPhase(PHASES[state] ?? "Waiting for World…"); } });
        requireLive();
        setQr(""); setLink(""); setPhase("PerkOS is validating the original World proof…");
        return worldRequest(`requests/${active.id}/proof`, { result }, controller.signal);
      }
      if (!active.verificationUrl) throw new WorldFlowError("WORLD_SHAPE");
      setLink(active.verificationUrl); setPhase("Open World in your browser and approve. This screen waits for the verified API result.");
      return waitForWorld(active, controller.signal, (id, signal) => worldRequest(`requests/${id}/poll`, {}, signal));
    }
    try {
      const active = await worldRequest("requests", { provider, purpose: "enroll" }, controller.signal);
      if (!live()) { void worldRequest(`requests/${active.id}/cancel`, {}).catch(() => undefined); return; }
      if (active.provider !== provider || active.purpose !== "enroll") throw new WorldFlowError("WORLD_REQUEST_MISMATCH");
      candidateId.current = active.id; pending.current.add(active.id);
      const proved = await confirm(active); requireLive();
      await finishWorldEnrollment(active, proved, controller.signal, {
        status: () => worldStatus(controller.signal),
        startLink: (existing, id) => worldRequest("requests", { purpose: "link-provider", provider: existing, candidateId: id }, controller.signal),
        confirm,
        read: (id) => worldRequest(`requests/${id}`, undefined, controller.signal),
        cancel: (id) => worldRequest(`requests/${id}/cancel`, {}),
        onLink: (linking) => {
          pending.current.add(linking.id);
          setPairing(`The new method is not connected yet. Confirm with your already connected ${LABELS[linking.provider]} to add it.`);
        },
      });
      requireLive(); pending.current.clear(); candidateId.current = null;
      setSuccess(`${LABELS[provider]} connected. Permission changes still require a fresh verification.`);
      await refresh(controller.signal);
    } catch (e) {
      if (live()) setError(worldMessage(e));
    } finally {
      if (live()) {
        const ids = [...pending.current]; pending.current.clear(); candidateId.current = null;
        void cancelWorldRequests(ids, (id) => worldRequest(`requests/${id}/cancel`, {})).catch(() => undefined);
        setBusy(false); setRequest(null); setQr(""); setLink(""); setPhase(""); setPairing("");
      }
    }
  }
  async function cancel() {
    const token = ++generation.current; abort.current?.abort();
    const ids = [...pending.current], candidate = candidateId.current; pending.current.clear(); candidateId.current = null;
    setBusy(true); setRequest(null); setQr(""); setLink(""); setPhase("Cancelling verification…"); setSuccess(""); setPairing("");
    try {
      const results = await cancelWorldRequests(ids, (id) => worldRequest(`requests/${id}/cancel`, {}));
      if (generation.current !== token) return;
      if (results.some((r) => r.id === candidate && r.status === "enrolled")) { await refresh(); setSuccess("World confirmed enrollment before cancellation. No additional permission was granted."); return; }
      if (results.some((r) => !["cancelled", "denied", "expired", "failed", "stale", "consumed"].includes(r.status))) {
          setError("Stopped waiting. Verification may still be finishing; refresh the status before retrying.");
          return;
      }
      setError("Verification cancelled. No new permission was approved.");
    } catch { if (generation.current === token) setError("Stopped waiting. The cancellation could not be confirmed; refresh the status before retrying."); }
    finally { if (generation.current === token) { setBusy(false); setPhase(""); } }
  }

  if (status && !status.enabled) return null;
  if (!status && !error) return null;
  return <section id="world-settings" aria-label="World ID settings">
    <span className="kicker">World ID</span>
    <p className={styles.intro}>Connect the human who controls your agents. A fresh verification protects new delegation and increases to permissions. Reducing limits and revoking access remain available.</p>
    {status ? <><p className={styles.note}>Sandbox · Adding another method requires approval with your already connected World method. The two identities are not automatically matched.</p>
      <div className={styles.providers}>{(["idkit", "oidc"] as const).map((provider) => <div className={styles.provider} key={provider}>
        <header><strong>{LABELS[provider]}</strong><span className={`${styles.badge} ${status.enrolled[provider] ? styles.connected : ""}`}>{status.enrolled[provider] ? "Connected" : status.providers[provider] ? "Not connected" : "Unavailable"}</span></header>
        <p>{provider === "idkit" ? "Scan a QR with World ID on your phone. PerkOS verifies the proof before linking the session." : "Approve in the external browser. World returns to PerkOS API, and this app reads the result."}</p>
        {status.providers[provider] && !status.enrolled[provider] ? <button type="button" className="chip-btn" disabled={busy} onClick={() => void begin(provider)}>Connect {provider === "idkit" ? "with IDKit" : "in browser"}</button> : null}
      </div>)}</div></> : null}
    {busy ? <div ref={pendingView} className={styles.pending} aria-live="polite">
      {pairing ? <p className={styles.status}><strong>{pairing}</strong></p> : null}
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

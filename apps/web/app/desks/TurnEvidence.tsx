"use client";

import { useEffect, useRef, useState } from "react";
import { parseEvidence, type EvidenceEnvelope, type IdentityAction, type IdentityStatus } from "@perkos/ens";
import type { TurnRecord } from "../lib/turnRecord";
import { EnsActivityLog, ensStepLabel } from "./EnsActivityLog";
import { EvidenceResult } from "./EnsExplorer";
import styles from "./IdentitySheet.module.css";

const ROLES = ["scout", "risk", "trader", "auditor", "hooks", "quote", "treasury"];

/** The saved task result is the only selectable publication source. No freeform agent impersonation. */
export function TurnEvidence({ record }: { record: TurnRecord }) {
  const [packet, setPacket] = useState<EvidenceEnvelope | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const url = `/api/desks/identity?desk=${encodeURIComponent(record.desk)}`;

  async function request<T>(body: unknown, preview = false): Promise<T> {
    const res = await fetch(url + (preview ? "&preview=1" : ""), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(65_000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "ENS could not complete this action.");
    return data as T;
  }
  async function preview(role: string) {
    const reply = record.replies.find((r) => r.role === role);
    if (!reply?.evidenceTaskId) return;
    const version = ++generation.current;
    setBusy(true); setError(""); setPacket(null); setSelected(role);
    try {
      const envelope = parseEvidence(await request({ action: "evidence", taskId: reply.evidenceTaskId, decisionId: record.id, response: reply.reply }, true));
      if (version === generation.current) setPacket(envelope);
    } catch (err) { if (version === generation.current) setError((err as Error).message); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function publish() {
    if (!packet || busy) return;
    const version = ++generation.current;
    setBusy(true); setError("");
    const p = packet.packet;
    const requestId = crypto.randomUUID();
    try {
      let next = await request<IdentityStatus>({ action: "publish", taskId: p.taskId, decisionId: p.decisionId, response: p.response, expectedHash: packet.hash, requestId } satisfies IdentityAction);
      for (let i = 0; version === generation.current; i++) {
        setStatus(next);
        if (["ready", "failed", "reconciliation", "disabled"].includes(next.state) || i >= 120) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (version !== generation.current) return;
        next = await request<IdentityStatus>({ action: "advance" });
      }
      if (version !== generation.current) return;
      const updated = parseEvidence(await request({ action: "evidence", taskId: p.taskId, decisionId: p.decisionId, response: p.response }, true));
      if (version === generation.current) setPacket(updated);
    } catch (err) { if (version === generation.current) setError((err as Error).message); }
    finally { if (version === generation.current) setBusy(false); }
  }

  return <section className={`${styles.body} ${styles.section}`} aria-label="Turn ENS evidence">
    <h3>ENS evidence</h3>
    <p>Publish a selected response with its teammate's own wallet. Review the complete public packet first. Prompts, memory and the rest of the conversation are excluded.</p>
    <ul className={styles.seats}>{ROLES.map((role) => {
      const reply = record.replies.find((r) => r.role === role);
      const available = reply?.ok && reply.evidenceTaskId && role !== "trader";
      return <li key={role}>
        <strong>{role}</strong> · {!reply ? "not in this turn" : !reply.ok ? "no completed response" : role === "trader" ? "identity only, no ENS write" : reply.evidenceTaskId ? "task receipt captured" : "no server task receipt"}
        {available ? <button type="button" disabled={busy} onClick={() => void preview(role)}>{selected === role && packet ? "Refresh evidence" : "Preview evidence"}</button> : null}
      </li>;
    })}</ul>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p className={styles.liveAction} role="status">{status?.step ? ensStepLabel(status.step) : "Preparing the public packet…"}</p> : null}
    {packet ? <>
      <EvidenceResult key={packet.hash + packet.transactionHash} envelope={packet} />
      {!packet.transactionHash ? <><p>This response and its quote sources will become public. Its hash is permanent in Sepolia transaction history.</p><button type="button" disabled={busy} onClick={() => void publish()}>Publish {packet.packet.role} evidence on Sepolia</button></> : <p>Publication confirmed. Export the packet to verify it from another session.</p>}
    </> : null}
    <EnsActivityLog activity={status?.activity ?? []} />
    <a href="/ens" target="_blank" rel="noreferrer">Open the public ENS verifier ↗</a>
  </section>;
}

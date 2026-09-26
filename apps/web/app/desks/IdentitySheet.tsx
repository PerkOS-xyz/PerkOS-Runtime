"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { instanceName, verifyDeskIdentity, type DeskVerification, type IdentityAction, type IdentityStatus } from "@perkos/ens";
import type { Chain } from "./chains";
import styles from "./IdentitySheet.module.css";

const reader = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 15_000, retryCount: 0 }), cacheTime: 0 });
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const stateLabel: Record<IdentityStatus["state"], string> = {
  absent: "The team has no public identity yet.", disabled: "ENS is not configured for this deployment.",
  provisioning: "Creating the team's identities.", pending: "Waiting for the transaction to be confirmed.",
  reconciliation: "The transaction needs operator review.", ready: "The public identities are ready to verify.", failed: "The transaction failed.",
};

/** Explicit public publication. No private turn, prompt or portfolio is copied here. */
export function IdentitySheet({ desk, title, chain, onClose }: { desk: string; title: string; chain: Chain; onClose: () => void }) {
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [verification, setVerification] = useState<DeskVerification | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("");
  const [value, setValue] = useState("");
  const generation = useRef(0);
  const running = useRef(false);
  const url = `/api/desks/identity?desk=${encodeURIComponent(desk)}`;

  const request = useCallback(async (action?: IdentityAction): Promise<IdentityStatus> => {
    const response = await fetch(url, { method: action ? "POST" : "GET", cache: "no-store", ...(action ? { headers: { "content-type": "application/json" }, body: JSON.stringify(action) } : {}), signal: AbortSignal.timeout(65_000) });
    const body = await response.json() as IdentityStatus & { message?: string };
    if (!response.ok) throw new Error(body.message ?? "Identity could not be read.");
    return body;
  }, [url]);

  const show = useCallback(async (next: IdentityStatus, version: number) => {
    if (generation.current !== version) return;
    setStatus(next); setVerification(null);
    if (next.identity) {
      try {
        const result = await verifyDeskIdentity(reader, next.identity);
        if (generation.current === version) setVerification(result);
      } catch { throw new Error("Could not verify this identity on Sepolia. Publishing stays disabled until verification succeeds."); }
    }
  }, []);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setError(""); setVerification(null); setBusy(true);
    try { await show(await request(), version); }
    catch (err) { if (generation.current === version) setError((err as Error).message); }
    finally { if (generation.current === version) setBusy(false); }
  }, [request, show]);

  useEffect(() => {
    void refresh();
    return () => { generation.current++; running.current = false; };
  }, [refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: IdentityAction) {
    if (running.current) return;
    running.current = true;
    const version = ++generation.current;
    setBusy(true); setError(""); setVerification(null);
    try {
      let next = await request(action);
      // One explicit creation runs a resumable sequence. Closing this view stops future steps.
      for (let poll = 0; generation.current === version; poll++) {
        await show(next, version);
        if (["ready", "disabled", "reconciliation", "failed"].includes(next.state) || poll >= 600) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (generation.current !== version) break;
        next = await request({ action: "advance" });
      }
      if (generation.current === version && action.action === "record" && next.lastOperation?.requestId === action.requestId && next.lastOperation.success) setValue("");
    } catch (err) { if (generation.current === version) { setVerification(null); setError((err as Error).message); } }
    finally { if (generation.current === version) { setBusy(false); running.current = false; } }
  }

  const identity = status?.identity;
  const writable = status?.descriptor?.seats.filter((seat) => seat.writes) ?? [];
  const chosenRole = role || writable[0]?.id || "";
  const grant = verification?.seats.find((seat) => seat.id === chosenRole);
  const ready = status?.state === "ready" && verification?.verified === true && !busy;
  return <aside className={`mk-sheet ${chain}`} aria-label={`${title} identity`}>
    <div className="mk-sheet-bar"><span className="kicker">{title} · Identity</span><button type="button" className="bubble-close" aria-label="Close identity" onClick={onClose}>&times;</button></div>
    <div className={styles.body}>
      <h2>One name for every teammate</h2>
      <p>Public identities on Sepolia. Records describe the team and its evidence; trading uses your existing approval rules.</p>
      {error ? <p role="alert">{error}</p> : null}
      <p aria-live="polite">{busy ? status?.state === "pending" ? stateLabel.pending : "Checking identity…" : status?.message ?? (status ? stateLabel[status.state] : "Reading identity…")}</p>
      {status?.parentName ? <p>Parent: <strong>{status.parentName}</strong></p> : null}
      {status?.operator ? <p>Provisioning wallet: <a href={`https://sepolia.etherscan.io/address/${status.operator}`} target="_blank" rel="noreferrer">{short(status.operator)}</a></p> : null}
      {identity ? <><strong style={{ overflowWrap: "anywhere" }}>{instanceName(identity.label, identity.parentName)}</strong>
        <p>{verification?.verified ? `Verified at block ${verification.blockNumber}` : "Identity has not been verified."}</p>
        {verification && !verification.verified ? <p role="alert">The parent, ownership or a teammate identity no longer matches. Publishing is disabled.</p> : null}
      </> : null}
      <ul className={styles.seats}>
        {(status?.descriptor?.seats ?? []).map((seat) => {
          const saved = identity?.seats.find((s) => s.id === seat.id);
          const checked = verification?.seats.find((s) => s.id === seat.id);
          return <li key={seat.id}><strong>{seat.label}</strong> — {checked?.verified ? "Verified" : "Unverified"}
            <div style={{ overflowWrap: "anywhere" }}>{checked?.name ?? seat.context}</div>
            <small>{seat.writes ? `${seat.writes}: ${checked ? checked.writeGranted ? "may publish" : "revoked" : "not checked"}` : "No ENS publication permission"}</small>
            {saved ? <div><a href={`https://sepolia.etherscan.io/address/${saved.wallet}`} target="_blank" rel="noreferrer">{short(saved.wallet)}</a> · ERC-8004 #{saved.registrationId}</div> : null}
          </li>;
        })}
      </ul>
      {status?.transactionHash ? <a href={`https://sepolia.etherscan.io/tx/${status.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void refresh()}>Verify again</button>
        {status && !["disabled", "ready", "reconciliation"].includes(status.state) ? <button type="button" disabled={busy} onClick={() => void run({ action: "advance" })}>{status.state === "absent" ? "Create public identities" : "Resume"}</button> : null}
      </div>
      {identity ? <form onSubmit={(event) => { event.preventDefault(); void run({ action: "record", role: chosenRole, value, requestId: crypto.randomUUID() }); }}>
        <h3>Publish public evidence</h3>
        <p>This text is public and permanent in transaction history. Enter only information you intend to publish.</p>
        <label>Teammate <select value={chosenRole} onChange={(event) => setRole(event.target.value)} disabled={busy}>{writable.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select></label>
        <label>Public record<textarea rows={3} maxLength={1024} value={value} onChange={(event) => setValue(event.target.value)} disabled={!ready || !grant?.writeGranted} /></label>
        <button type="submit" disabled={!ready || !grant?.writeGranted || !value.trim() || new TextEncoder().encode(value).length > 1024}>Publish with teammate wallet</button>
        <button type="button" disabled={!ready || !grant?.writeGranted} onClick={() => void run({ action: "revoke", role: chosenRole, requestId: crypto.randomUUID() })}>Revoke {chosenRole} publication</button>
      </form> : null}
    </div>
  </aside>;
}

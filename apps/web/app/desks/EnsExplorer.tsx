"use client";

import { useRef, useState } from "react";
import { discoverDesk, instanceName, parseEvidence, readText, seatName, verifyEvidence, type EvidenceEnvelope } from "@perkos/ens";
import styles from "./IdentitySheet.module.css";
import { Ensip25Proof, Ensip25Summary } from "./Ensip25Proof";

import { ensReader } from "../lib/ensReader";
export { ensReader };
const PUBLIC_EVIDENCE = "https://api.perkos.xyz/ens/evidence/";

export function EvidenceResult({ envelope }: { envelope: EvidenceEnvelope }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof verifyEvidence>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const p = envelope.packet;
  return <section className={styles.section} aria-label="Evidence packet">
    <strong>{p.role} · {p.decisionId}</strong>
    <p>{seatName(p.role, instanceName(p.identity.label, p.identity.parentName))}</p>
    <p>ENS: Sepolia · Task completed {p.completedAt}</p>
    <pre className={styles.packet}>{p.response}</pre>
    <details><summary>Public packet, hash and quote sources</summary><pre className={styles.packet}>{JSON.stringify(envelope, null, 2)}</pre></details>
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={async () => { setResult(null); setError(""); setBusy(true); try { setResult(await verifyEvidence(ensReader, envelope)); } catch { setError("Could not verify this packet against Sepolia. No verification is claimed."); } finally { setBusy(false); } }}>Verify independently</button>
      <button type="button" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `ens-evidence-${envelope.hash.slice(2, 14)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export packet</button>
    </div>
    {envelope.transactionHash ? <a href={`https://sepolia.etherscan.io/tx/${envelope.transactionHash}`} target="_blank" rel="noreferrer">Publication transaction</a> : <p>Not published on Sepolia.</p>}
    {busy ? <p role="status">Checking hash, transaction signer and historical identity…</p> : null}
    {result ? <p role="status">Content hash matches. Publication: {result.publication}. Quote freshness: {result.quoteStatus}. {result.issues.join(", ")}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <small>Publication verifies provenance and integrity. It does not validate the agent's conclusions. Current permissions can differ from those at publication.</small>
  </section>;
}

/** Uses public ENS and optional published packets only. No PerkOS login. */
export function EnsExplorer() {
  const [name, setName] = useState("");
  const [desk, setDesk] = useState<Awaited<ReturnType<typeof discoverDesk>> | null>(null);
  const [records, setRecords] = useState<Record<string, string>>({});
  const [packet, setPacket] = useState<EvidenceEnvelope | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = async (hash: string) => {
    setPacket(null); setError(""); setBusy(true);
    try {
      const res = await fetch(`${PUBLIC_EVIDENCE}${hash}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error("The content is unavailable. Import an exported packet to verify it.");
      const raw = await res.text();
      if (raw.length > 150_000) throw new Error("Packet is too large.");
      const e = parseEvidence(JSON.parse(raw));
      if (e.hash !== hash) throw new Error("The content does not match the requested hash.");
      setPacket(e);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return <section className={styles.section} aria-label="Public ENS explorer">
    <h3>Open a team by ENS</h3>
    <p>Inspect its parent and child pointers, seven seats where declared, and publication permissions. No account required.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); const version = ++generation.current; setDesk(null); setRecords({}); setPacket(null); setError(""); setBusy(true);
      try {
        const found = await discoverDesk(ensReader, name.trim());
        if (version !== generation.current) return;
        setDesk(found);
        if (found.verification.verified) {
          const rows = await Promise.all(found.identity.seats.filter((s) => s.writes).map(async (s) => [s.id, await readText(ensReader, seatName(s.id, found.verification.name), s.writes!).catch(() => "")] as const));
          if (version === generation.current) setRecords(Object.fromEntries(rows));
        }
      } catch { if (version === generation.current) setError("No verifiable desk manifest could be read at this name on Sepolia."); }
      finally { if (version === generation.current) setBusy(false); }
    }}>
      <label>Desk ENS name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="desk.parent.eth" maxLength={253} required disabled={busy} /></label>
      <button type="submit" disabled={busy}>Resolve and verify</button>
    </form>
    {desk ? <div className={styles.tree}>
      <strong>{desk.identity.parentName}</strong>
      <span>↓ child pointer · ↑ parent pointer</span>
      <strong>{desk.verification.name}</strong>
      <p>{desk.verification.verified ? `Canonical team verified at block ${desk.verification.blockNumber}` : `Unverified: ${desk.verification.issues.join(", ")}`}</p>
      <Ensip25Summary verification={desk.verification} total={desk.identity.seats.length} />
      <div className={styles.tree}>{desk.verification.seats.map((s) => <div key={s.id}>
        <strong>{s.id}</strong> · {s.verified ? "verified" : "unverified"} · {s.writeGranted ? "may publish" : "no publication grant"}
        <div>{s.name}</div>
        <Ensip25Proof seat={desk.identity.seats.find((seat) => seat.id === s.id)!} checked={s} block={desk.verification.blockNumber} />
        {/^perkos-evidence:1:0x[0-9a-f]{64}$/.test(records[s.id] ?? "") ? <button type="button" disabled={busy} onClick={() => void load(records[s.id]!.split(":")[2]!)}>Read {s.id} evidence</button> : null}
      </div>)}</div>
    </div> : null}
    <label>Verify an exported packet<input type="file" accept="application/json,.json" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0]; setPacket(null); setError(""); if (!file) return;
      try { if (file.size > 150_000) throw new Error("Packet is too large."); setPacket(parseEvidence(JSON.parse(await file.text()))); }
      catch (err) { setError((err as Error).message); }
      event.target.value = "";
    }} /></label>
    {error ? <p role="alert">{error}</p> : null}
    {packet ? <EvidenceResult key={packet.hash + packet.transactionHash} envelope={packet} /> : null}
  </section>;
}

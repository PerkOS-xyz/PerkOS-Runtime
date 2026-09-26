import { ENS_SEPOLIA, type DeskVerification, type SeatIdentity, type SeatVerification } from "@perkos/ens";
import styles from "./IdentitySheet.module.css";

export function Ensip25Summary({ verification, total }: { verification: DeskVerification | null; total: number }) {
  const checked = verification?.seats.filter((seat) => seat.verified && seat.ensip25).length ?? 0;
  return <section className={styles.protocol} aria-label="ENSIP-25 agent verification">
    <div className={styles.protocolHeading}><strong>ENSIP-25 · Agent identity</strong><span className={styles.proofBadge} data-verified={!!verification?.verified && checked === total && total > 0}>{verification ? `${checked}/${total} verified` : "Verification pending"}</span></div>
    <p>ERC-8004 claims the ENS name. The ENS record attests to that exact agent ID and registry.</p>
    <small>ENS V2 · Sepolia · {verification ? `Read at block ${verification.blockNumber}` : "Waiting for an independent onchain check"}</small>
    <a href="https://docs.ens.domains/ensip/25/" target="_blank" rel="noreferrer">ENSIP-25 specification · Draft ↗</a>
  </section>;
}

export function Ensip25Proof({ seat, checked, block }: { seat: SeatIdentity; checked?: SeatVerification | undefined; block?: string | undefined }) {
  const proof = checked?.ensip25;
  const verified = !!checked?.verified && !!proof;
  return <div className={styles.agentProof}>
    <span className={styles.proofBadge} data-verified={verified}>ENSIP-25 · {proof ? verified ? "Verified" : "Not verified" : "Not checked"}</span>
    <details>
      <summary>View ENSIP-25 proof · ERC-8004 #{seat.registrationId}</summary>
      <dl className={styles.proofFields}>
        <dt>1 · ERC-8004 registration</dt><dd><a href={`https://sepolia.etherscan.io/nft/${ENS_SEPOLIA.identityRegistry}/${seat.registrationId}`} target="_blank" rel="noreferrer">Agent #{seat.registrationId} ↗</a></dd>
        <dt>Registry · Sepolia (11155111)</dt><dd><a href={`https://sepolia.etherscan.io/address/${ENS_SEPOLIA.identityRegistry}`} target="_blank" rel="noreferrer">{ENS_SEPOLIA.identityRegistry}</a></dd>
        <dt>Declared ENS name</dt><dd>{proof?.claimedName ?? "No verified declaration read"}</dd>
        <dt>2 · ENS attestation record</dt><dd><code>{proof?.key ?? "Not read yet"}</code></dd>
        <dt>Value read from ENS</dt><dd><code>{proof ? JSON.stringify(proof.value) : "Not read yet"}</code></dd>
        <dt>3 · Link verification</dt><dd>{proof ? verified ? `Name matches and attestation is non-empty · block ${block}` : `Verification failed: ${checked?.issues.join(", ")}` : "Pending an onchain read"}</dd>
      </dl>
    </details>
  </div>;
}

import type { EnsActivity } from "@perkos/ens";
import styles from "./IdentitySheet.module.css";

export function ensStepLabel(step: string): string {
  const [kind, action, role] = step.split(":");
  if (kind === "text" && role?.startsWith("agent-registration[")) return `Publish ${action} ENSIP-25 attestation`;
  if (kind === "text" && role === "agent-context") return `Publish ${action} ENSIP-26 context`;
  if (kind === "move") {
    const labels: Record<string, string> = { mount: "Mount destination child pointer", parent: "Switch team parent pointer", link: `Link ${role} records to its new name`, metadata: `Update ${role} ERC-8004 name`, manifest: "Publish the new team manifest", detach: "Detach the old child pointer" };
    return labels[action ?? ""] ?? "Move team branch";
  }
  const labels: Record<string, string> = { registry: "Create team registry", resolver: `Create ${action === "_desk" ? "team" : action} resolver`, "desk-entry": "Register desk child pointer", "desk-parent": "Set team parent pointer", "desk-manifest": "Publish discovery manifest", seat: `Register ${action} name`, registration: `Register ${action} with ERC-8004`, fund: `Fund ${action} with Sepolia gas`, text: `Set ${action} identity record`, grant: `Grant ${action} publication`, revoke: `Revoke ${action} publication`, record: `Publish ${action} record`, publish: `Publish ${action} task evidence`, "lock-parent": "Lock legacy parent pointer" };
  return labels[kind ?? ""] ?? step;
}

export function EnsActivityLog({ activity = [] }: { activity?: EnsActivity[] }) {
  if (!activity.length) return null;
  return <section className={styles.section} aria-label="ENS transaction activity">
    <h3>ENS activity · Sepolia</h3>
    <p>Transactions are shown from the saved operation and mined receipt.</p>
    <ol className={styles.activity}>
      {[...activity].reverse().map((item) => <li key={item.id} data-state={item.state}>
        <span className={styles.activityDot} aria-hidden />
        <div><strong>{ensStepLabel(item.step)}</strong><p><span className={styles.badge}>{item.state}</span> · {new Date(item.at).toLocaleTimeString()}{item.block ? ` · block ${item.block}` : ""}</p>
          <small>Signer <a href={`https://sepolia.etherscan.io/address/${item.from}`} target="_blank" rel="noreferrer">{item.from.slice(0, 8)}…{item.from.slice(-6)}</a></small>
          {item.hash ? <p><a href={`https://sepolia.etherscan.io/tx/${item.hash}`} target="_blank" rel="noreferrer">{item.hash.slice(0, 12)}…{item.hash.slice(-8)} ↗</a></p> : <p>{item.state === "reconciliation" ? "The send result is unknown. Operator reconciliation is required." : "Waiting for a transaction hash."}</p>}
        </div>
      </li>)}
    </ol>
  </section>;
}

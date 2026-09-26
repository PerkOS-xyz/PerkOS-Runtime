import { EnsExplorer } from "../desks/EnsExplorer";
import styles from "../desks/IdentitySheet.module.css";

export default function PublicEnsPage() {
  return <main className={`${styles.publicPage} ${styles.body}`}><a href="/">← PerkOS Runtime</a><h1>ENS team explorer</h1><EnsExplorer /></main>;
}

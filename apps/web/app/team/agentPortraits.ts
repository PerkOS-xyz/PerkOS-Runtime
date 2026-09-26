/**
 * Which character art stands for which role on a desk's team.
 *
 * The roles a desk seats most often each have their own head, chosen for what
 * the role does: Scout keeps an antenna up, Risk is the alert fox, Trader
 * carries the signal, Auditor keeps the vault. Any other role gets one of the
 * remaining heads, picked from its name so it keeps the same face every time.
 */

const ROLE_HEADS: Record<string, string> = {
  scout: "agent-antenna",
  risk: "agent-fox",
  trader: "agent-signal",
  auditor: "agent-vault",
  hooks: "agent-blocks",
  quote: "agent-water",
  treasury: "agent-coins",
};

const SPARE_HEADS = ["agent-orbit", "agent-cat", "agent-cloud", "agent-leaf", "agent-sprout", "agent-bubblegum"] as const;

/** FNV-1a over the role's name: small, stable, and the same on every machine. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The head a role wears, as a file name without the extension. */
export function portraitFor(role: string): string {
  const key = role.trim().toLowerCase();
  return ROLE_HEADS[key] ?? SPARE_HEADS[hash(key) % SPARE_HEADS.length] ?? SPARE_HEADS[0];
}

/** Where the app serves that head. */
export function portraitSrc(role: string): string {
  return `/agents/${portraitFor(role)}.png`;
}

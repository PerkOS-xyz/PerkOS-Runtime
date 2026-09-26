/**
 * The team's lines, cut into what the chat draws: plain text, an @mention of
 * someone at the desk (a chip in that role's color), and a [Fn] tag that
 * points at one of the turn's facts.
 *
 * No React: the chat draws the parts, and tests read them.
 */

export type LinePart = { text: string } | { mention: string; role: string } | { fact: number };

/** Who can be mentioned at a desk: Sparky and the house roles. */
export const HOUSE = ["sparky", "scout", "risk", "trader", "auditor"] as const;

const TOKEN = /@([A-Za-z][A-Za-z-]{1,31})\b|\[F(\d{1,3})\]/g;

/**
 * The parts of a line. An @word is a mention only when it names someone at
 * the desk (the house, or `roles`, such as a desk's specialists); anything
 * else stays text, so an email address or a handle is left alone.
 */
export function lineParts(text: string, roles: readonly string[] = HOUSE): LinePart[] {
  const known = new Set(roles.map((r) => r.toLowerCase()));
  const parts: LinePart[] = [];
  let at = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const prev = parts[parts.length - 1];
    if (prev && "text" in prev) parts[parts.length - 1] = { text: prev.text + s };
    else parts.push({ text: s });
  };
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    const before = start > 0 ? text[start - 1]! : "";
    const name = m[1];
    if (name !== undefined) {
      // "julio@perkos.xyz" is not a mention.
      if (!known.has(name.toLowerCase()) || /[\w.]/.test(before)) continue;
      pushText(text.slice(at, start));
      parts.push({ mention: `@${name}`, role: name.toLowerCase() });
    } else {
      pushText(text.slice(at, start));
      parts.push({ fact: Number(m[2]) });
    }
    at = start + m[0].length;
  }
  pushText(text.slice(at));
  return parts;
}

/** The fact a [Fn] tag points at, from the turn's fact lines. */
export function factFor(facts: readonly string[] | undefined, n: number): string | undefined {
  return facts?.find((f) => f.startsWith(`[F${n}]`))?.replace(/^\[F\d+\]\s*/, "");
}

/** "Scout · PerkOS": an agent of the desk's team, which runs on PerkOS. */
export const agentLabel = (name: string) => `${name} · PerkOS`;

/** "Auditor did not answer: model failed" */
export const missedLine = (name: string, label: string) => `${name} did not answer: ${label}`;

/**
 * Checks on what the team answered. They do not block anything: each one is
 * a flag History counts, so the desk can see where its prompts or its agents
 * need work. "scout:no-citation" means Scout made claims without the fact tag
 * they rest on.
 *
 * The desk supplies what the checks compare against: its facts, its order cap
 * and the venues it trades on. A desk that leaves the cap or the venues out
 * gets no check for them.
 */

import type { RoleReply, TurnKind } from "./turnRecord";

export interface LintInput {
  kind: TurnKind;
  replies: RoleReply[];
  /** Everything the team was given: rules, facts and memory. A number from there is not made up. */
  given: string;
  /** The desk's prompts for this kind of turn, for their word limits. */
  rolePrompts: Record<string, string>;
  /** The most one order may spend, in `quote`. */
  maxOrder?: number | undefined;
  quote?: string | undefined;
  /** Where the desk trades. */
  venues?: string[] | undefined;
}

/**
 * Venue names worth noticing in an answer. A name here is only flagged when
 * the desk does not trade there and the facts never mention it.
 */
const VENUE_NAMES = [
  "Uniswap",
  "Aerodrome",
  "Velodrome",
  "Curve",
  "Balancer",
  "SushiSwap",
  "PancakeSwap",
  "Bankr",
  "1inch",
  "Jupiter",
  "Raydium",
  "Orca",
  "Camelot",
  "Trader Joe",
  "CoW Swap",
  "ParaSwap",
];

/** Words over the desk's own limit before an answer counts as too long. */
const LENGTH_SLACK = 15;
/** Words that make an amount a size to trade, not a price level. */
const SIZE_WORDS = "buy|size|sizing|clip|position|allocate|add|enter|entry|start with|deploy|put|invest|spend|up to|at most";
/** An amount after these is a price level: "add below 175 USDG". "Up to" is a size, unless a move comes before it. */
const LEVEL_BEFORE = /\b(at|below|above|near|under|over|from|(?<!\bup\s)to|around|price|level|trades?|trading)\s*[:$]?\s*$/i;
/** "Up to" after a move is a price target, not a size: "it could run up to 200 USDG". */
const UP_TO_END = /\s*\bup\s+to\s*[:$]?\s*$/i;
const MOVE_BEFORE =
  /\b(run|runs|running|rise|rises|rising|climb|climbs|climbing|rally|rallies|rallying|move|moves|moving|trade|trades|trading|reach|reaches|jump|jumps|rebound|rebounds|bounce|bounces|push|pushes|pop|pops|spike|spikes|extend|extends|head|heads|recover|recovers|swing|swings)(?:\s+\w+ly)?\s*$/i;
/** Words that make an amount a size to trade in Spanish, as the team answers in the person's language. */
const SIZE_WORDS_ES =
  "compra|compro|comprar|compraría|compre|entrada|entrar|entraría|entra|posición|tamaño|asigna|asignar|asignaría|invierte|invertir|invertiría|destina|destinar|destinaría|gasta|gastar|añade|añadir|agrega|agregar|suma|sumar|empieza con|empezar con|empezaría con|comienza con|comenzar con|arranca con|arrancar con|como máximo";
/** A Spanish price level: "compra por debajo de 175 USDG", "compra a 175 USDG". Only after a Spanish word, where "a" is not an article. */
const LEVEL_BEFORE_ES = /\b(a|en|sobre|desde|debajo de|encima de|cerca de|precio|nivel|objetivo|cotiza|cotizando)\s*[:$]?\s*$/i;
const SPANISH_WORD = new RegExp(`^(?:${SIZE_WORDS_ES})\\b`, "i");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pcts = (text: string) => new Set((text.match(/-?\d+(?:\.\d+)?\s?%/g) ?? []).map((x) => Math.abs(parseFloat(x)).toFixed(1)));
const word = (name: string) => new RegExp(`(^|[^A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, "i");

/** "Under 70 words" in a role prompt. */
export function wordLimit(prompt: string | undefined): number | null {
  const m = prompt?.match(/\bunder\s+(\d{1,4})\s+words\b/i);
  return m ? Number(m[1]) : null;
}

/** An amount an answer puts forward as a size to trade, and where the words that make it one begin and end. */
export interface SizeMention {
  value: number;
  at: number;
  /** Just after the amount and its unit. */
  end: number;
}

/** Every amount an answer puts forward as a size to trade, in the quote asset, in the order it says them. */
export function sizesIn(text: string, quote = "USD"): SizeMention[] {
  const unit = `(?:${escape(quote)}|USDG|USDC|USD|dollars?|d[oó]lares)`;
  const amount = `(?:\\$\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k)?|(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k)?\\s?${unit}\\b)`;
  const re = new RegExp(`\\b(?:${SIZE_WORDS}|${SIZE_WORDS_ES})\\b([^.\\n]{0,40}?)${amount}`, "gi");
  const sizeWord = new RegExp(`^(?:${SIZE_WORDS}|${SIZE_WORDS_ES})\\b`, "i");
  const sizes: SizeMention[] = [];
  for (const m of text.matchAll(re)) {
    if ((SPANISH_WORD.test(m[0]) ? LEVEL_BEFORE_ES : LEVEL_BEFORE).test(m[1] ?? "")) continue;
    const lead = text.slice(0, m.index) + (m[0].match(sizeWord)?.[0] ?? "") + (m[1] ?? "");
    if (UP_TO_END.test(lead) && MOVE_BEFORE.test(lead.replace(UP_TO_END, ""))) continue;
    const raw = m[2] ?? m[4];
    if (!raw) continue;
    // "1,500" is fifteen hundred; "50,5" is fifty and a half, as Spanish writes it.
    const value = Number(raw.replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "")) * (m[3] || m[5] ? 1000 : 1);
    if (Number.isFinite(value)) sizes.push({ value, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return sizes;
}

/** The largest amount an answer puts forward as a size to trade, in the quote asset. */
export function largestSize(text: string, quote = "USD"): number {
  return Math.max(0, ...sizesIn(text, quote).map((s) => s.value));
}

export function lintTurn(input: LintInput): string[] {
  const flags: string[] = [];
  const order = input.kind === "order";
  // A launch asks Risk for a verdict, as an order does, and has no size to trade.
  const verdicts = order || input.kind === "launch";
  const given = input.given;
  const givenPcts = pcts(given);
  const venues = (input.venues ?? []).filter((v) => v.trim());
  for (const r of input.replies) {
    if (!r.ok) {
      if (r.failure !== "stopped") flags.push(`${r.role}:no-answer`);
      continue;
    }
    const t = r.reply;
    if (/market (is |was |remains )?(closed|shut)/i.test(t) && !/24\/7/.test(t)) flags.push(`${r.role}:says-market-closed`);
    if ((r.role === "scout" || r.role === "risk") && !/@(Trader|Auditor)\b/.test(t)) flags.push(`${r.role}:no-mention`);
    if ((r.role === "trader" || r.role === "auditor") && !/@Sparky\b/.test(t)) flags.push(`${r.role}:no-mention`);
    const unknown = [...pcts(t)].filter((p) => !givenPcts.has(p));
    if (unknown.length) flags.push(`${r.role}:pct-not-in-facts(${unknown.slice(0, 3).join(",")})`);
    if (!verdicts && input.maxOrder !== undefined && largestSize(t, input.quote) > input.maxOrder) flags.push(`${r.role}:size-over-limit`);
    const limit = wordLimit(input.rolePrompts[r.role]);
    const words = t.trim().split(/\s+/).length;
    if (limit !== null && words > limit + LENGTH_SLACK) flags.push(`${r.role}:over-length(${words})`);
    if (!order && (r.role === "scout" || r.role === "auditor") && !/\[F\d+\]/.test(t)) flags.push(`${r.role}:no-citation`);
    if (venues.length) {
      for (const name of VENUE_NAMES) {
        const w = word(name);
        if (w.test(t) && !venues.some((v) => w.test(v)) && !w.test(given)) flags.push(`${r.role}:venue-not-in-facts(${name})`);
      }
    }
    if (r.role === "risk") {
      if (verdicts && !/VERDICT\s*[:-]\s*(GO|BLOCK)\b/i.test(t)) flags.push("risk:no-verdict");
      if (!verdicts && !/^\s*RISK:\s*(low|medium|high)\b/im.test(t)) flags.push("risk:no-risk-level");
    }
  }
  return flags;
}

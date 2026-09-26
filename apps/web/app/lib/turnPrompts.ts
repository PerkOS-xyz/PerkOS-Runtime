/**
 * What each agent of a desk turn is asked.
 *
 * Every role gets the same head: the request, the desk's rules, the facts
 * numbered [F1].. and what the desk remembers. The roles of the second phase
 * also get what the first ones said. Then each gets the desk's own words for
 * its role in this kind of turn.
 *
 * PerkOS takes a prompt of up to 16,000 characters. The head is cut to leave
 * room for the handoff and the longest role prompt; when it has to be cut,
 * facts go first (from the end of the list), then memory.
 */

import type { DeskAsset } from "@perkos/desk-contract";

import { failureLabel } from "./turnFailure";
import { roleName, type RiskLevel, type RoleReply, type Verdict } from "./turnRecord";

/** The whole prompt one agent gets. PerkOS refuses more than 16,000. */
export const PROMPT_CAP = 15_500;
/** What one role's answer may take in the next phase's prompt. */
export const HANDOFF_CLIP = 700;
/** What the desk's memory may add. */
export const MEMORY_CAP = 900;
/** Room kept for the handoff: two answers, their names and their notes. */
const HANDOFF_ROOM = 2 * (HANDOFF_CLIP + 80);

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => {
  const t = oneLine(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export interface HeadInput {
  question: string;
  /** The desk's rules, from its manifest. */
  rules: string;
  /** The [Fn] lines. */
  facts: string[];
  /** One line on the market as a whole: chain, quote, when it was observed. */
  market?: string;
  /** Where the desk trades, from its manifest. */
  venues?: string[];
  memory?: string;
  /** The most the head may take. */
  maxChars?: number;
}

export interface Head {
  text: string;
  /** The facts that fit. */
  facts: string[];
  /** The memory that fit. */
  memory: string;
}

/** How much of the prompt the head may take, given the desk's role prompts. */
export function headBudget(rolePrompts: string[]): number {
  const longest = Math.max(0, ...rolePrompts.map((p) => p.length));
  return Math.max(2_000, PROMPT_CAP - longest - HANDOFF_ROOM - 8);
}

/** The part every role of the turn gets. */
export function buildHead(input: HeadInput): Head {
  const max = input.maxChars ?? PROMPT_CAP;
  const facts = [...input.facts];
  let memory = clip(input.memory ?? "", MEMORY_CAP);
  const venues = (input.venues ?? []).map(oneLine).filter(Boolean);
  const compose = () =>
    [
      `Request to the desk: "${oneLine(input.question)}".`,
      `Desk rules: ${oneLine(input.rules)}`,
      venues.length ? `Where this desk trades: ${venues.join("; ")}.` : "",
      input.market ? oneLine(input.market) : "",
      facts.length ? `Market facts the desk verified, tagged for citation (use them, do not contradict them):\n${facts.join("\n")}` : "",
      memory ? `Desk memory: ${memory}` : "",
      "Answer directly from the facts above in one message. Do not open skills, files or tools.",
    ]
      .filter(Boolean)
      .join("\n");
  let text = compose();
  while (text.length > max && facts.length) {
    facts.pop();
    text = compose();
  }
  if (text.length > max && memory) {
    memory = clip(memory, Math.max(0, memory.length - (text.length - max) - 1));
    if (memory.length < 20) memory = "";
    text = compose();
  }
  if (text.length > max) text = text.slice(0, max);
  return { text, facts, memory };
}

/** What the first roles said, for the roles that plan and record with it. */
export function handoff(replies: RoleReply[], notes: { riskLevel?: RiskLevel | undefined; verdict?: Verdict | undefined } = {}): string {
  return replies
    .map((r) => {
      const who = roleName(r.role);
      const note = r.role === "risk" ? (notes.verdict ? ` (verdict ${notes.verdict})` : notes.riskLevel ? ` (risk ${notes.riskLevel})` : "") : "";
      if (!r.ok) return `(${who} did not answer: ${failureLabel(r.failure ?? "other")})${note}.`;
      return `${who} said: "${clip(r.reply, HANDOFF_CLIP)}"${note}.`;
    })
    .join(" ");
}

/** What follows the head for one role: the handoff, when there is one, then the desk's words for the role. */
export const roleTail = (rolePrompt: string, handoffText = ""): string => (handoffText ? `${handoffText}\n\n${rolePrompt}` : rolePrompt);

/** The prompt one agent gets. */
export const fullPrompt = (head: string, tail: string): string => `${head}\n\n${tail}`.slice(0, PROMPT_CAP);

const num = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });

/** A fact short enough for Sparky's line in the chat: "NVDA 181.20 USDG, +1.20% in 24h". */
export function shortFact(asset: DeskAsset, quote: string): string {
  const price = asset.priceUsd === null ? "no price" : `${num(asset.priceUsd)} ${quote}`;
  const change = asset.change24hPct === null ? "" : `, ${asset.change24hPct >= 0 ? "+" : ""}${asset.change24hPct.toFixed(2)}% in 24h`;
  return `${asset.ticker} ${price}${change}`;
}

/**
 * Sparky's line to the first roles, as the chat shows it:
 * "@Scout @Risk How is NVDA doing today? Facts attached: NVDA 181.20 USDG, +1.20% in 24h."
 */
export function principalLine(question: string, roles: string[], shortFacts: string[], shown = 4): string {
  const q = oneLine(question);
  const asked = /[.?!]$/.test(q) ? q : `${q}.`;
  const mentions = roles.map((r) => `@${roleName(r)}`).join(" ");
  const facts = shortFacts.slice(0, shown);
  const more = shortFacts.length - facts.length;
  const attached = facts.length ? ` Facts attached: ${facts.join("; ")}${more > 0 ? `; and ${more} more` : ""}.` : "";
  return `${mentions} ${asked}${attached}`.trim();
}

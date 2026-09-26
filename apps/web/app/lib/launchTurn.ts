/**
 * A drafted token launch, as the desk's team gets it: what is on the table,
 * what Bankr checked and simulated, and how the fees and the supply split.
 * The window sends it with the launch turn, the route reads it back here, and
 * these lines become the turn's facts after the pair's own market line.
 *
 * The facts name the person's wallets by what they are, never by address:
 * the team runs on PerkOS, and a line the model reads is a line it may repeat.
 *
 * No Node imports: the route, the window and the tests share it.
 */

import type { DraftAnswer } from "./launchDraft";

export interface LaunchTurnFacts {
  name: string;
  symbol: string;
  pair: { symbol: string; name: string; kind: string; illiquid: boolean | null };
  feesTo: "wallet" | "bankr";
  vesting: boolean;
  quoteOnlyFees: boolean;
  checks: Array<{ label: string; ok: boolean; warn?: boolean; note: string }>;
  /** Bankr's simulation, when it ran and passed. */
  preview: { tokenAddress: string; poolId: string; creatorBps: number | null; protocolBps: number | null } | null;
  simError?: string;
}

const MAX_CHECKS = 12;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.replace(/\s+/g, " ").trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const bps = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : null);
const HEX = /^0x[0-9a-fA-F]{1,64}$/;

/** A drafted launch the window sent, or null when it is not one. */
export function readLaunchFacts(v: unknown): LaunchTurnFacts | null {
  const o = obj(v);
  const pair = obj(o?.pair);
  if (!o || !pair) return null;
  const name = text(o.name, 100);
  const symbol = text(o.symbol, 20);
  const pairSymbol = text(pair.symbol, 24);
  const pairName = text(pair.name, 100);
  const kind = text(pair.kind, 24);
  if (!name || !symbol || !pairSymbol || !pairName || !kind) return null;
  if (o.feesTo !== "wallet" && o.feesTo !== "bankr") return null;
  if (typeof o.vesting !== "boolean" || typeof o.quoteOnlyFees !== "boolean") return null;
  if (!Array.isArray(o.checks) || o.checks.length > MAX_CHECKS) return null;
  const checks: LaunchTurnFacts["checks"] = [];
  for (const raw of o.checks) {
    const c = obj(raw);
    const label = text(c?.label, 60);
    const note = text(c?.note, 400);
    if (!c || !label || !note || typeof c.ok !== "boolean") return null;
    checks.push({ label, ok: c.ok, ...(c.warn === true ? { warn: true } : {}), note });
  }
  let preview: LaunchTurnFacts["preview"] = null;
  if (o.preview !== null && o.preview !== undefined) {
    const p = obj(o.preview);
    if (!p || typeof p.tokenAddress !== "string" || !HEX.test(p.tokenAddress) || typeof p.poolId !== "string" || (p.poolId !== "" && !HEX.test(p.poolId))) return null;
    preview = { tokenAddress: p.tokenAddress, poolId: p.poolId, creatorBps: bps(p.creatorBps), protocolBps: bps(p.protocolBps) };
  }
  const simError = text(o.simError, 600);
  return {
    name,
    symbol,
    pair: { symbol: pairSymbol, name: pairName, kind, illiquid: typeof pair.illiquid === "boolean" ? pair.illiquid : null },
    feesTo: o.feesTo,
    vesting: o.vesting,
    quoteOnlyFees: o.quoteOnlyFees,
    checks,
    preview,
    ...(simError ? { simError } : {}),
  };
}

/** What the window sends for a checked draft. */
export function launchFactsOf(answer: DraftAnswer): LaunchTurnFacts {
  const d = answer.draft;
  return {
    name: d.name,
    symbol: d.symbol,
    pair: { symbol: d.pair.symbol, name: d.pair.name, kind: d.pair.kind, illiquid: d.pair.illiquid },
    feesTo: d.feesTo,
    vesting: d.vesting,
    quoteOnlyFees: d.quoteOnlyFees,
    checks: answer.checks.map((c) => ({ label: c.label, ok: c.ok, ...(c.warn ? { warn: true } : {}), note: c.note })),
    preview: answer.preview
      ? { tokenAddress: answer.preview.tokenAddress, poolId: answer.preview.poolId, creatorBps: answer.preview.creator?.bps ?? null, protocolBps: answer.preview.protocolBps }
      : null,
    ...(answer.simError ? { simError: answer.simError } : {}),
  };
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const pct = (b: number) => `${Number((b / 100).toFixed(2))}%`;
const ADDRESS = /0x[0-9a-fA-F]{4,40}(?:…[0-9a-fA-F]{4})?/g;
/** Wallet addresses in a note, shortened or not, become what they are to the team. */
const withoutAddresses = (s: string) =>
  s.replace(new RegExp(`(your (?:Bankr )?wallet) ${ADDRESS.source}`, "g"), "$1").replace(ADDRESS, "the Bankr wallet");

/** The question the turn carries: the launch, as the person drafted it. */
export const launchQuestion = (f: LaunchTurnFacts) => `Launch ${f.name} (${f.symbol}) paired with ${f.pair.symbol} on Robinhood Chain. Is it ready to go out?`;

/** The launch in a few words, for Sparky's line to the team. */
export const launchShortFact = (f: LaunchTurnFacts) =>
  `${f.symbol} / ${f.pair.symbol} pool, ${f.preview ? "Bankr's simulation passed" : f.simError ? "Bankr's simulation failed" : "not simulated"}`;

/** The launch's facts for the team, in the order they read best. */
export function launchFactLines(f: LaunchTurnFacts): string[] {
  const what = f.pair.kind === "stock" ? `${f.pair.name}, a tokenized stock` : f.pair.kind === "major" ? `${f.pair.name}, the default quote` : f.pair.name;
  const recipient = f.feesTo === "bankr" ? "the person's Bankr wallet" : "the person's own wallet";
  const creator = f.preview?.creatorBps ?? 9_500;
  const protocol = f.preview?.protocolBps ?? 10_000 - creator;
  const lines = [
    `Launch on the table: "${f.name}" (${f.symbol}), a new token on Robinhood Chain whose Uniswap v4 pool is quoted in ${f.pair.symbol} (${what}). Bankr deploys it through Doppler from the person's Bankr wallet, which signs and pays the gas; the person signs nothing on chain and holds to launch.${f.pair.illiquid ? ` Bankr marks ${f.pair.symbol}'s own pool as thin right now.` : ""}`,
    `Fee split: every swap pays a 0.7% pool fee, ${pct(creator)} of it to the fee recipient (${recipient}) and ${pct(protocol)} to the protocol; Bankr's hook on the pool adds its own fees, 1.75% of volume in all. Fees are paid ${f.quoteOnlyFees ? `in ${f.pair.symbol} only` : `in both ${f.symbol} and ${f.pair.symbol}`}.`,
    f.vesting
      ? `Supply: 100 billion ${f.symbol}. Vesting on: 15% goes to the fee recipient over one year after a 30-day cliff, and 85% seeds the pool.`
      : `Supply: 100 billion ${f.symbol}. Vesting off: all of it seeds the pool.`,
    "First minutes: for five minutes no wallet may hold more than 2% of the supply, and a fee that fades over about ten seconds slows snipers.",
    ...f.checks.map((c) => `Check ${c.ok ? (c.warn ? "passes with a caution" : "passes") : "FAILS"}, ${c.label}: ${withoutAddresses(c.note)}.`),
    f.preview
      ? `Bankr's simulation passed: the token would be at ${short(f.preview.tokenAddress)}${f.preview.poolId ? `, pool id ${short(f.preview.poolId)}` : ""}. Nothing was sent.`
      : f.simError
        ? `Bankr's simulation failed: ${withoutAddresses(f.simError)}`
        : "Bankr's simulation did not run, because a check failed.",
  ];
  return lines;
}

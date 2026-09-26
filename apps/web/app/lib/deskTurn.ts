/**
 * One desk turn, from the question to the kept record, as the route runs it.
 *
 *   1. Read the desk's market and number the facts the team gets.
 *   2. Open: Sparky's line to the first roles, streamed to the window.
 *   3. Make the team ready: wake it only when part of it sleeps.
 *   4. Run the phases, check the answers, keep the record.
 *
 * Every step is streamed as an event. Nothing here prepares or sends an
 * order: the person trades only from the Trader sheet, by holding to approve.
 */

import { Agents, Desks, Team, type DeskSummary, type PerkosClient } from "@perkos/client";
import type { DeskAsset, DeskManifest, DeskMarket, DeskSeries } from "@perkos/desk-contract";
import type { NoteStore } from "@perkos/vault";

import { askedAbout, candidates, factLines, MAX_CANDIDATES } from "./marketFacts";
import { teamMemory } from "./memory";
import { rememberMarket } from "./perkos";
import { runTurn } from "./turnEngine";
import { failureLabel } from "./turnFailure";
import { lintTurn } from "./turnLint";
import { buildHead, headBudget, principalLine, shortFact } from "./turnPrompts";
import { TURN_PHASES, type FailureKind, type RoleReply, type TurnErrorCode, type TurnEvent, type TurnKind, type TurnRecord, type TurnStep } from "./turnRecord";
import { saveTurn } from "./turnStore";
import { readyTeam, TURN_ERRORS } from "./turnTeam";

/** The market and its history together must answer within this. */
export const FACTS_MS = 10_000;
/** Assets a question about named stocks puts in front of the team. */
const MAX_ASKED = 5;

export interface DeskTurnInput {
  id: string;
  wallet: string;
  desk: DeskSummary & { module: string };
  manifest: DeskManifest;
  kind: TurnKind;
  question: string;
  /** Tickers the window already knows the question is about. */
  tickers?: string[];
  client: PerkosClient;
  /** The wallet's notes while memory is on. */
  notes: NoteStore | null;
  signal: AbortSignal;
  emit: (event: TurnEvent) => void;
}

const within = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), Math.max(0, ms)))]);

/** The assets a turn looks at: the ones named, or the desk's best candidates. */
export function turnAssets(kind: TurnKind, question: string, market: DeskMarket, tickers?: string[]): DeskAsset[] {
  if (tickers?.length) {
    const wanted = new Set(tickers.map((t) => t.toUpperCase()));
    const named = market.assets.filter((a) => wanted.has(a.ticker.toUpperCase()));
    if (named.length) return named.slice(0, MAX_ASKED);
  }
  if (kind === "advise") return candidates(market, MAX_CANDIDATES);
  const asked = askedAbout(question, market.assets).slice(0, MAX_ASKED);
  return asked.length ? asked : candidates(market, MAX_ASKED);
}

/** A failed role's label when the whole team could not take part. */
const TEAM_FAILURE: Partial<Record<TurnErrorCode, FailureKind>> = {
  TEAM_NOT_SET_UP: "not_set_up",
  NO_DESK_TIME: "no_time",
  INFRA_APPROVAL_REQUIRED: "approval",
  LLM_BYOK_REQUIRED: "byok",
  TEAM_ASLEEP: "offline",
  TEAM_SETTING_UP: "setting_up",
  TEAM_FAILED: "start_failed",
  TEAM_UNREACHABLE: "network",
  SIGNED_OUT: "other",
};

export async function runDeskTurn(input: DeskTurnInput): Promise<TurnRecord | null> {
  const { signal, manifest, kind } = input;
  const rolePrompts = manifest.turns[kind];
  if (!rolePrompts) return null;
  const started = Date.now();
  const trace: TurnStep[] = [];
  const emit = (event: TurnEvent) => {
    if (event.step === "working") trace.push({ at: event.at, text: event.text });
    input.emit(event);
  };
  const step = (text: string, at = new Date()): TurnEvent => ({ step: "working", at: at.toISOString(), text });
  const desks = new Desks(input.client);

  // 1. Facts. The window hears nothing until the turn opens, so these steps are sent right after it.
  const early: TurnEvent[] = [step("Reading the market")];
  const market = await within<DeskMarket | null>(desks.market(input.desk.module), FACTS_MS, null);
  if (signal.aborted) return null;
  if (!market) {
    input.emit({ step: "error", code: "DESK_MARKET", message: TURN_ERRORS.DESK_MARKET });
    return null;
  }
  rememberMarket(input.desk.module, market);
  const assets = turnAssets(kind, input.question, market, input.tickers);
  if (!assets.length) {
    input.emit({ step: "error", code: "DESK_MARKET", message: "The desk has no priced asset to look at right now." });
    return null;
  }
  const series = await within<DeskSeries[]>(
    desks.series(
      input.desk.module,
      assets.map((a) => a.ticker),
    ),
    FACTS_MS - (Date.now() - started),
    [],
  );
  if (signal.aborted) return null;
  const facts = factLines(market, assets, series);
  early.push(step(`Read ${facts.length} ${facts.length === 1 ? "fact" : "facts"} from the market`));
  const memory = input.notes ? await teamMemory(input.notes, input.desk.id, input.question).catch(() => "") : "";

  // 2. Open.
  const phases = TURN_PHASES.map((roles) => roles.filter((r) => rolePrompts[r as keyof typeof rolePrompts] !== undefined));
  const roles = phases.flat();
  const principal = principalLine(
    input.question,
    phases[0] ?? [],
    assets.map((a) => shortFact(a, market.quoteSymbol)),
  );
  const startedAt = new Date(started).toISOString();
  emit({ step: "open", turnId: input.id, kind, desk: input.desk.id, question: input.question, principal, facts, roles, at: startedAt });
  for (const e of early) emit(e);

  const prompts = rolePrompts as unknown as Record<string, string>;
  const head = buildHead({
    question: input.question,
    rules: manifest.rules,
    facts,
    market: `Market on ${market.chain}, priced in ${market.quoteSymbol}, observed at ${market.observedAt}.`,
    ...(manifest.venues ? { venues: manifest.venues } : {}),
    memory,
    maxChars: headBudget(Object.values(prompts)),
  });
  const record: TurnRecord = {
    v: 1,
    id: input.id,
    desk: input.desk.id,
    module: input.desk.module,
    kind,
    question: input.question,
    principal,
    startedAt,
    endedAt: startedAt,
    ms: 0,
    facts: head.facts,
    memory: head.memory,
    head: head.text,
    prompts: {},
    replies: [],
    guests: [],
    flags: [],
    trace,
  };
  const close = async (extra: Partial<TurnRecord>) => {
    const ended = Date.now();
    Object.assign(record, extra, { endedAt: new Date(ended).toISOString(), ms: ended - started });
    if (signal.aborted) record.stopped = true;
    const kept = await saveTurn(input.wallet, record, input.notes);
    emit({
      step: "done",
      turnId: record.id,
      replies: record.replies,
      flags: record.flags,
      ms: record.ms,
      kept,
      ...(record.riskLevel ? { riskLevel: record.riskLevel } : {}),
      ...(record.verdict ? { verdict: record.verdict } : {}),
      ...(record.stopped ? { stopped: true } : {}),
      ...(record.error ? { error: record.error.code } : {}),
    });
    return record;
  };

  try {
    // 3. Team.
    const agents = new Agents(input.client);
    const team = await readyTeam({ team: new Team(input.client), desk: input.desk.id, roles, emit, signal });
    if (!team.ok) {
      emit({ step: "error", code: team.code, message: team.message });
      const failure = TEAM_FAILURE[team.code] ?? "other";
      // Where the team was read, each role keeps its own reason; otherwise they share the turn's.
      const perSeat = team.code === "TEAM_NOT_SET_UP" || team.code === "TEAM_ASLEEP" || team.code === "TEAM_SETTING_UP" || team.code === "TEAM_FAILED";
      const replies: RoleReply[] = roles.map((role) => {
        const seat = team.seats[role];
        const phase: 1 | 2 = (phases[0] ?? []).includes(role) ? 1 : 2;
        const own = perSeat && seat && !seat.ready ? seat : null;
        const reply: RoleReply = {
          role,
          phase,
          ...(seat?.agentName ? { agentName: seat.agentName } : {}),
          ok: false,
          reply: "",
          failure: own?.failure ?? failure,
          detail: own?.detail ?? team.message,
          ms: 0,
        };
        emit({ step: "reply", ...reply });
        // The same pair of events a role that did not answer sends mid-turn, so the window reads one shape.
        emit({ step: "failure", role, phase, failure: reply.failure ?? failure, label: failureLabel(reply.failure ?? failure), ...(reply.detail ? { detail: reply.detail } : {}) });
        return reply;
      });
      return await close({ replies, error: { code: team.code, message: team.message } });
    }

    // 4. Phases, checks, record.
    const outcome = await runTurn({
      kind,
      phases: phases as readonly string[][],
      seats: team.seats,
      head: head.text,
      rolePrompts: prompts,
      ask: (agentId, prompt, options) => agents.ask(agentId, prompt, options),
      touch: (agentId) => agents.touch(agentId),
      emit,
      signal,
    });
    if (!signal.aborted) emit(step("Checking the answers"));
    const flags = lintTurn({
      kind,
      replies: outcome.replies,
      given: head.text,
      rolePrompts: prompts,
      maxOrder: manifest.maxOrder,
      quote: market.quoteSymbol,
      venues: manifest.venues,
    });
    return await close({
      prompts: outcome.prompts,
      replies: outcome.replies,
      flags,
      ...(outcome.riskLevel ? { riskLevel: outcome.riskLevel } : {}),
      ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
    });
  } catch (err) {
    const message = `${TURN_ERRORS.INTERNAL} ${(err as Error).message}`.trim();
    emit({ step: "error", code: "INTERNAL", message });
    return await close({ error: { code: "INTERNAL", message } });
  }
}

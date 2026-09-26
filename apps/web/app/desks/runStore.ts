/**
 * A money move a desk is sending, kept above the Trader sheet. Closing the
 * sheet, opening the market or leaving the desk does not stop what PerkOS is
 * already signing, so its outcome waits here until the person has seen it,
 * and the sheet shows it again when it opens. One per desk at a time.
 *
 * With a keeper, each desk's run is also kept in the window's sessionStorage,
 * so a reload neither loses a move that may still land nor brings back the
 * form that would send a second one. Without storage it works as before.
 */

export interface Run<S, O> {
  id: number;
  module: string;
  /** What the person approved, for the screen. */
  summary: S;
  /** Null while PerkOS is still working on it. */
  outcome: O | null;
  /** When the outcome arrived, on this machine's monotonic clock; null before. */
  answeredAt: number | null;
}

export interface RunStore<S, O> {
  /** The desk's run in flight, or the last one whose outcome the person has not dismissed. */
  get(module: string): Run<S, O> | null;
  subscribe(listener: () => void): () => void;
  /** Starts a run unless one is already in flight for this desk, and returns it. */
  start(module: string, summary: S, send: () => Promise<O>): Run<S, O> | null;
  /** The person has seen the outcome. A run still in flight stays. */
  dismiss(module: string): void;
}

/** The part of sessionStorage a run needs. */
export type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Where and how a desk's run is kept across a reload of the window. */
export interface RunKeeper<S, O> {
  /** Where runs are kept, or null where there is nowhere (a server render, storage turned off). */
  storage: () => KeptStorage | null;
  /** The key a desk's run is kept under. */
  key: (module: string) => string;
  /** Whether a kept summary and outcome are still ones the sheet can draw. */
  isSummary: (s: unknown) => s is S;
  isOutcome: (o: unknown) => o is O;
}

/** The window's sessionStorage, or null on a server render or where the window refuses it. */
export function windowSession(): KeptStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A run as it is kept: what was approved and what came back. The clock stays behind, since it restarts with the page. */
export const keptRun = <S, O>(run: Pick<Run<S, O>, "summary" | "outcome">): string => JSON.stringify({ summary: run.summary, outcome: run.outcome });

/**
 * What a kept run held, or null when nothing the sheet can draw was kept. A
 * run still in flight when the page went away comes back as `lost`: the page
 * that waited for its answer is gone, and it may be on chain. So does an
 * outcome that no longer reads.
 */
export function readKept<S, O>(raw: string | null, lost: O, isSummary: (s: unknown) => s is S, isOutcome: (o: unknown) => o is O): { summary: S; outcome: O } | null {
  if (!raw) return null;
  let kept: unknown;
  try {
    kept = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof kept !== "object" || kept === null) return null;
  const { summary, outcome } = kept as { summary?: unknown; outcome?: unknown };
  if (!isSummary(summary)) return null;
  return { summary, outcome: isOutcome(outcome) ? outcome : lost };
}

/**
 * `lost` is what a send that throws becomes: it happened after the approval,
 * so it may be on chain and is never read as nothing sent.
 */
export function createRunStore<S, O>(lost: O, now: () => number = () => performance.now(), keeper?: RunKeeper<S, O>): RunStore<S, O> {
  const runs = new Map<string, Run<S, O>>();
  const listeners = new Set<() => void>();
  // The desks whose kept run has been looked for since the page loaded.
  const looked = new Set<string>();
  let seq = 0;
  const changed = () => {
    for (const listener of listeners) listener();
  };

  // A desk's run, looking in storage the first time. One brought back after a
  // reload starts its minute again now, so it is not put away early.
  const current = (module: string): Run<S, O> | null => {
    if (keeper && !looked.has(module)) {
      looked.add(module);
      let raw: string | null = null;
      try {
        raw = keeper.storage()?.getItem(keeper.key(module)) ?? null;
      } catch {
        raw = null;
      }
      const kept = readKept(raw, lost, keeper.isSummary, keeper.isOutcome);
      if (kept && !runs.has(module)) runs.set(module, { id: ++seq, module, summary: kept.summary, outcome: kept.outcome, answeredAt: now() });
    }
    return runs.get(module) ?? null;
  };

  // Writes the desk's run to storage, or clears it. Storage that refuses changes nothing on screen.
  const keep = (module: string) => {
    if (!keeper) return;
    try {
      const storage = keeper.storage();
      if (!storage) return;
      const run = runs.get(module);
      if (run) storage.setItem(keeper.key(module), keptRun(run));
      else storage.removeItem(keeper.key(module));
    } catch {
      // Full or turned off: the run still lives in memory until the page goes.
    }
  };

  return {
    get(module) {
      return current(module);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(module, summary, send) {
      const existing = current(module);
      if (existing && existing.outcome === null) return null;
      const run: Run<S, O> = { id: ++seq, module, summary, outcome: null, answeredAt: null };
      runs.set(module, run);
      keep(module);
      changed();
      void send()
        .catch((): O => lost)
        .then((outcome) => {
          if (runs.get(module)?.id !== run.id) return;
          runs.set(module, { ...run, outcome, answeredAt: now() });
          keep(module);
          changed();
        });
      return run;
    },
    dismiss(module) {
      const run = current(module);
      if (!run || run.outcome === null) return;
      runs.delete(module);
      keep(module);
      changed();
    },
  };
}

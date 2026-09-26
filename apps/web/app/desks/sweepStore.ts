/**
 * The transfer home a desk is sending, kept above the Trader sheet (see
 * runStore): closing the sheet does not forget it, so Send home stays off
 * while it is in flight and its outcome shows again when the sheet opens.
 * It is kept in the window's sessionStorage too, so a reload does not free
 * Send home while it may still land.
 */

import { createRunStore, windowSession, type Run } from "./runStore";
import { isSweepOutcome, SWEEP_UNCONFIRMED, type SweepOutcome } from "./trade";

export interface SweepSummary {
  symbol: string;
  token: string;
}

export type SweepRun = Run<SweepSummary, SweepOutcome>;

/** Whether a summary kept across a reload is one the note can draw. */
export const isSweepSummary = (s: unknown): s is SweepSummary =>
  typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).symbol === "string" && typeof (s as Record<string, unknown>).token === "string";

/** The key a desk's transfer home is kept under in sessionStorage. */
export const sweepKey = (module: string): string => `runtime.trader.sweep:${module}`;

const sweeps = createRunStore<SweepSummary, SweepOutcome>({ kind: "unconfirmed", message: SWEEP_UNCONFIRMED }, undefined, {
  storage: windowSession,
  key: sweepKey,
  isSummary: isSweepSummary,
  isOutcome: isSweepOutcome,
});

export const sweepRun = (module: string): SweepRun | null => sweeps.get(module);
export const subscribeSweeps = (listener: () => void): (() => void) => sweeps.subscribe(listener);
export const startSweep = (module: string, summary: SweepSummary, send: () => Promise<SweepOutcome>): SweepRun | null => sweeps.start(module, summary, send);
export const dismissSweep = (module: string): void => sweeps.dismiss(module);

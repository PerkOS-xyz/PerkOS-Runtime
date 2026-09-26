/**
 * The launch a desk is sending, kept above the card (see runStore). Bankr can
 * take a couple of minutes to deploy, and closing the card or leaving the
 * desk does not stop it, so its outcome waits here until the person has seen
 * it. It is kept in the window's sessionStorage too, so a reload shows the
 * outcome, or says the launch may be on chain, instead of a form that would
 * send a second one.
 */

import { LAUNCH_UNCONFIRMED } from "./launch";
import { isLaunchOutcome, type LaunchOutcome } from "./launchForm";
import { createRunStore, windowSession, type Run } from "./runStore";

/** What the person held for, for the card while Bankr works. */
export interface LaunchSummary {
  name: string;
  symbol: string;
  pairedSymbol: string;
  /** The Bankr wallet that deploys it, for the explorer when the answer is unclear. */
  deployer: string;
}

export type LaunchRun = Run<LaunchSummary, LaunchOutcome>;

export function isLaunchSummary(s: unknown): s is LaunchSummary {
  if (typeof s !== "object" || s === null) return false;
  const l = s as Record<string, unknown>;
  return typeof l.name === "string" && typeof l.symbol === "string" && typeof l.pairedSymbol === "string" && typeof l.deployer === "string";
}

/** The key a desk's launch is kept under in sessionStorage. */
export const launchKey = (module: string): string => `runtime.launch:${module}`;

const launches = createRunStore<LaunchSummary, LaunchOutcome>({ kind: "unconfirmed", message: LAUNCH_UNCONFIRMED }, undefined, {
  storage: windowSession,
  key: launchKey,
  isSummary: isLaunchSummary,
  isOutcome: isLaunchOutcome,
});

/** The desk's launch in flight, or the last one whose outcome the person has not put away. */
export const launchRun = (module: string): LaunchRun | null => launches.get(module);
export const subscribeLaunches = (listener: () => void): (() => void) => launches.subscribe(listener);
/** Starts a launch unless one is already in flight for this desk. */
export const startLaunch = (module: string, summary: LaunchSummary, send: () => Promise<LaunchOutcome>): LaunchRun | null =>
  launches.start(module, summary, send);
/** The person has seen the outcome. A launch still in flight stays. */
export const dismissLaunch = (module: string): void => launches.dismiss(module);

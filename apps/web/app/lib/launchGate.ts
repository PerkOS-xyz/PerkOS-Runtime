/**
 * What lets a launch go out from this app: a simulation of exactly what is
 * about to be sent, run in the last ten minutes, and no other launch in
 * flight for the wallet. The hold in the window is the person's; this is the
 * server's own check that the hold approves what was checked.
 *
 * Both live on `globalThis`, so the draft and deploy routes share them and a
 * reload of the dev server keeps them.
 */

import { createHash } from "node:crypto";

import { deployBody, type LaunchParams, type LaunchPreview } from "./bankrLaunch";

/** How long a simulation stays good for a launch. */
export const PREVIEW_MS = 10 * 60_000;
/** A launch lock older than this belongs to a request that can no longer be running. */
const LOCK_STALE_MS = 5 * 60_000;

interface Gate {
  previews: Map<string, { fingerprint: string; at: number; preview: LaunchPreview }>;
  deploying: Map<string, number>;
}

const GATE = Symbol.for("perkos.runtime.launchGate");

function gate(): Gate {
  const g = globalThis as unknown as Record<symbol, Gate | undefined>;
  let s = g[GATE];
  if (!s) {
    s = { previews: new Map(), deploying: new Map() };
    g[GATE] = s;
  }
  return s;
}

/** Everything Bankr would get for the real launch, and from which wallet. */
export function launchFingerprint(deployer: string, params: LaunchParams): string {
  return createHash("sha256")
    .update(JSON.stringify({ deployer: deployer.toLowerCase(), body: deployBody(params, false) }))
    .digest("hex");
}

export function rememberPreview(wallet: string, fingerprint: string, preview: LaunchPreview, now = Date.now()): void {
  gate().previews.set(wallet.toLowerCase(), { fingerprint, at: now, preview });
}

/** The simulation of exactly this launch, when it is recent enough. */
export function previewFor(wallet: string, fingerprint: string, now = Date.now()): LaunchPreview | null {
  const hit = gate().previews.get(wallet.toLowerCase());
  return hit && hit.fingerprint === fingerprint && now - hit.at < PREVIEW_MS ? hit.preview : null;
}

/** A launch went out, or may have: the next one needs a new check. */
export function forgetPreview(wallet: string): void {
  gate().previews.delete(wallet.toLowerCase());
}

/** Takes the wallet's launch lock. False while another launch from this app is in flight. */
export function claimDeploy(wallet: string, now = Date.now()): boolean {
  const { deploying } = gate();
  const key = wallet.toLowerCase();
  const held = deploying.get(key);
  if (held !== undefined && now - held < LOCK_STALE_MS) return false;
  deploying.set(key, now);
  return true;
}

export function releaseDeploy(wallet: string): void {
  gate().deploying.delete(wallet.toLowerCase());
}

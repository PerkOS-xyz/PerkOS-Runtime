"use client";

import { useState } from "react";

import type { VaultState } from "../shell/useVault";

/** Offers to turn on Sparky's memory. Shown while the vault is locked, until dismissed. */
export function MemoryBanner({ vault }: { vault: VaultState }) {
  const [dismissed, setDismissed] = useState(false);
  if (vault.unlocked !== false || dismissed) return null;
  return (
    <div className="memory-banner" role="note">
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
      <div>
        <p>{vault.busy ? "Approve the signature in your wallet. It moves no funds." : "Sparky can remember your conversations, encrypted with your wallet."}</p>
        {vault.error ? <p className="hint err">{vault.error}</p> : null}
        <div className="memory-actions">
          <button type="button" className="chip-btn" disabled={vault.busy} onClick={() => void vault.unlock()}>
            Turn on memory
          </button>
          <button type="button" className="link-btn" onClick={() => setDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

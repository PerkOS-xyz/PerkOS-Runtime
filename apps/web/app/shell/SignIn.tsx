"use client";

import { useEffect, useRef } from "react";

import type { Wallet } from "../wallet/context";
import type { PerkosSessionState } from "./usePerkosSession";
import { WizardFrame } from "./WizardFrame";

/**
 * Step 1. The wallet window opens from the welcome screen; once the wallet is
 * connected, the PerkOS signature is requested right away, once per address.
 */
export function SignIn({
  wallet,
  session,
  onDone,
  onBack
}: {
  wallet: Wallet;
  session: PerkosSessionState;
  onDone: () => void;
  onBack: () => void;
}) {
  const requested = useRef("");

  useEffect(() => {
    if (session.signedIn) {
      onDone();
      return;
    }
    if (!wallet.connected || session.loading || session.busy) return;
    if (requested.current === wallet.address) return;
    requested.current = wallet.address;
    void session.signIn();
  }, [wallet.connected, wallet.address, session, onDone]);

  async function switchWallet() {
    requested.current = "";
    await wallet.logout();
    wallet.open();
  }

  if (!wallet.enabled) {
    return (
      <WizardFrame step={1}>
        <span className="kicker">Step 1 of 3</span>
        <h2>Wallet sign-in is not set up.</h2>
        <p className="lead">Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID in apps/web/.env.local and open the app again.</p>
        <div className="wz-actions">
          <button type="button" className="link-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </WizardFrame>
    );
  }

  if (!wallet.connected) {
    return (
      <WizardFrame step={1}>
        <span className="kicker">Step 1 of 3</span>
        <h2>Connect your wallet.</h2>
        <p className="lead">Choose your wallet in the window that opened. Connecting does not spend anything.</p>
        {wallet.error ? <p className="wz-note err">{wallet.error}</p> : null}
        <div className="wz-actions">
          <button type="button" className="pill" disabled={wallet.busy} onClick={wallet.open}>
            {wallet.loaded ? "Open the wallet window" : "Loading…"}
          </button>
          <button type="button" className="link-btn" onClick={onBack}>
            Back
          </button>
        </div>
      </WizardFrame>
    );
  }

  if (session.busy || (!session.error && !session.signedIn)) {
    return (
      <WizardFrame step={1}>
        <span className="kicker">Step 1 of 3</span>
        <h2>Approve the signature.</h2>
        <p className="lead">
          Your wallet asks you to sign a message from PerkOS. It proves the wallet is yours; nothing is spent.
        </p>
        <div className="wz-wait" aria-hidden>
          <i />
        </div>
        <p className="wz-note">Connected as {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</p>
      </WizardFrame>
    );
  }

  return (
    <WizardFrame step={1}>
      <span className="kicker">Step 1 of 3</span>
      <h2>The signature did not go through.</h2>
      <p className="lead">{session.error}</p>
      <div className="wz-actions">
        <button type="button" className="pill" disabled={session.busy} onClick={() => void session.signIn()}>
          Try again
        </button>
        <button type="button" className="link-btn" onClick={() => void switchWallet()}>
          Use another wallet
        </button>
      </div>
    </WizardFrame>
  );
}

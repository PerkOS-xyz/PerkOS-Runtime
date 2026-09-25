"use client";

import { useEffect, useRef, useState } from "react";

import type { Wallet } from "../wallet/context";
import type { PerkosSessionState } from "./usePerkosSession";

export type LoginPhase = "idle" | "connecting" | "signing" | "error";

export interface LoginState {
  phase: LoginPhase;
  /** Error to show, when the phase is "error". */
  message: string;
  start: () => void;
  retry: () => void;
  switchWallet: () => Promise<void>;
}

/**
 * Login from the welcome screen: open the wallet window, then request the
 * PerkOS signature as soon as the wallet connects (once per address).
 */
export function useLogin(wallet: Wallet, session: PerkosSessionState, onSignedIn: () => void): LoginState {
  const [active, setActive] = useState(false);
  const requested = useRef("");

  useEffect(() => {
    if (!active) return;
    if (session.signedIn) {
      setActive(false);
      onSignedIn();
      return;
    }
    if (!wallet.connected || session.loading || session.busy) return;
    if (requested.current === wallet.address) return;
    requested.current = wallet.address;
    void session.signIn();
  }, [active, wallet.connected, wallet.address, session, onSignedIn]);

  function start() {
    if (session.signedIn) {
      onSignedIn();
      return;
    }
    // Opened from the click itself, so the wallet window is not treated as a popup.
    if (wallet.enabled && !wallet.connected) wallet.open();
    setActive(true);
  }

  const phase: LoginPhase = !active
    ? "idle"
    : !wallet.connected
      ? "connecting"
      : session.error && !session.busy
        ? "error"
        : "signing";

  return {
    phase,
    message: session.error,
    start,
    retry: () => void session.signIn(),
    switchWallet: async () => {
      requested.current = "";
      await wallet.logout();
      wallet.open();
    }
  };
}

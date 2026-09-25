"use client";

import { useCallback, useEffect, useState } from "react";

import type { Wallet } from "../wallet/context";

export interface PerkosSessionState {
  loading: boolean;
  /** Signed in with the wallet that is connected now. */
  signedIn: boolean;
  busy: boolean;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    const err = new Error(body.message ?? body.error ?? `Request failed (${res.status})`) as Error & { code?: string };
    if (body.error) err.code = body.error;
    throw err;
  }
  return body;
}

const messageFor = (err: unknown): string => {
  const e = err as Error & { code?: string };
  if (e.code === "INFRA_PAYMENT_REQUIRED") return "This wallet has no active PerkOS infrastructure yet.";
  if (/reject|denied|cancel/i.test(e.message)) return "The signature was cancelled.";
  return e.message || "Sign-in failed.";
};

/** PerkOS session for the connected wallet, kept on the local server. */
export function usePerkosSession(wallet: Wallet): PerkosSessionState {
  const [loading, setLoading] = useState(true);
  const [sessionWallet, setSessionWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    call<{ signedIn: boolean; wallet?: string }>("/api/session")
      .then((s) => live && setSessionWallet(s.signedIn ? (s.wallet ?? "") : ""))
      .catch(() => live && setSessionWallet(""))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!wallet.address) return;
    setBusy(true);
    setError("");
    try {
      const { nonce, message } = await call<{ nonce: string; message: string }>("/api/session/challenge", {
        method: "POST",
        body: JSON.stringify({ address: wallet.address })
      });
      const signature = await wallet.signMessage(message);
      const s = await call<{ wallet: string }>("/api/session", {
        method: "POST",
        body: JSON.stringify({ address: wallet.address, nonce, signature })
      });
      setSessionWallet(s.wallet);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await call("/api/session", { method: "DELETE" });
      setSessionWallet("");
      await wallet.logout();
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  const signedIn = Boolean(wallet.address && sessionWallet && sessionWallet === wallet.address.toLowerCase());
  return { loading, signedIn, busy, error, signIn, signOut };
}

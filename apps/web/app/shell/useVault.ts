"use client";

import { useCallback, useEffect, useState } from "react";

import type { Wallet } from "../wallet/context";

export interface VaultState {
  /** null while loading. */
  unlocked: boolean | null;
  /** The key survives a restart on this device. */
  persistent: boolean;
  busy: boolean;
  error: string;
  unlock: () => Promise<void>;
  lock: () => Promise<void>;
}

/** Sparky's memory on this machine: encrypted with a key from one wallet signature. */
export function useVault(wallet: Wallet): VaultState {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/vault").catch(() => null);
    if (!res || !res.ok) return setUnlocked(false);
    const body = (await res.json()) as { unlocked: boolean; persistent: boolean; message?: string };
    setUnlocked(body.unlocked);
    setPersistent(body.persistent);
    setMessage(body.message ?? "");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unlock = useCallback(async () => {
    if (!message) return;
    setBusy(true);
    setError("");
    try {
      const signature = await wallet.signMessage(message);
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature })
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not turn on memory.");
      await refresh();
    } catch (err) {
      const text = (err as Error).message;
      setError(/reject|denied|cancel/i.test(text) ? "The signature was cancelled." : text);
    } finally {
      setBusy(false);
    }
  }, [message, refresh, wallet]);

  const lock = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/vault", { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { unlocked, persistent, busy, error, unlock, lock };
}

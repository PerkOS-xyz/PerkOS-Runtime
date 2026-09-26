"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Wallet } from "../wallet/context";

export interface VaultState {
  /** null while loading. */
  unlocked: boolean | null;
  /** The key survives a restart on this device. */
  persistent: boolean;
  /** The wallet signed differently than last time; the saved memory stays locked. */
  conflict: boolean;
  busy: boolean;
  error: string;
  unlock: () => Promise<void>;
  /** After a conflict: set the saved memory aside and start a new one. */
  startFresh: () => Promise<void>;
  dismiss: () => void;
  lock: () => Promise<void>;
}

/** Tells every open view that memory was turned on or off. */
const CHANGED = "perkos:vault";

/** Sparky's memory on this machine: encrypted with a key from one wallet signature. */
export function useVault(wallet: Wallet): VaultState {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The signature that hit a conflict, kept only until the person decides.
  const pending = useRef("");

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
    const onChange = () => void refresh();
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [refresh]);

  const send = useCallback(async (signature: string, fresh: boolean) => {
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fresh ? { signature, fresh } : { signature })
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 409 && body.error === "other_key") {
      pending.current = signature;
      setConflict(true);
      return;
    }
    if (!res.ok) throw new Error(body.message ?? "Could not turn on memory.");
    pending.current = "";
    setConflict(false);
    await refresh();
    window.dispatchEvent(new Event(CHANGED));
  }, [refresh]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      const text = (err as Error).message;
      setError(/reject|denied|cancel/i.test(text) ? "The signature was cancelled." : text);
    } finally {
      setBusy(false);
    }
  }, []);

  const unlock = useCallback(
    () =>
      run(async () => {
        if (!message) return;
        await send(await wallet.signMessage(message), false);
      }),
    [message, run, send, wallet]
  );

  const startFresh = useCallback(
    () =>
      run(async () => {
        if (pending.current) await send(pending.current, true);
      }),
    [run, send]
  );

  const dismiss = useCallback(() => {
    pending.current = "";
    setConflict(false);
    setError("");
  }, []);

  const lock = useCallback(
    () =>
      run(async () => {
        await fetch("/api/vault", { method: "DELETE" });
        await refresh();
        window.dispatchEvent(new Event(CHANGED));
      }),
    [refresh, run]
  );

  return { unlocked, persistent, conflict, busy, error, unlock, startFresh, dismiss, lock };
}

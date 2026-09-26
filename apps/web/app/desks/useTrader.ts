"use client";

import type { DeskTrader } from "@perkos/client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface TraderState {
  trader: DeskTrader | null;
  error: string;
  loading: boolean;
  /** Read the wallet again and return it, for a step that waits on the browser or the chain. */
  load: () => Promise<DeskTrader | null>;
}

/** The wallet the owner delegated to a desk's Trader, and what it holds, read through PerkOS. */
export function useTrader(module: string): TraderState {
  const [trader, setTrader] = useState<DeskTrader | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/desks/trader?module=${encodeURIComponent(module)}`);
      const body = (await res.json().catch(() => ({}))) as { trader?: DeskTrader; message?: string };
      if (!res.ok || !body.trader) throw new Error(body.message ?? `Could not read the Trader's wallet (${res.status})`);
      if (live.current) {
        setTrader(body.trader);
        setError("");
      }
      return body.trader;
    } catch (err) {
      const message = (err as Error).message;
      if (live.current) setError(message === "Failed to fetch" ? "Could not reach PerkOS. Try again." : message);
      return null;
    } finally {
      if (live.current) setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  return { trader, error, loading, load };
}

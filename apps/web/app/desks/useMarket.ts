"use client";

import type { DeskMarket } from "@perkos/desk-contract";
import { useCallback, useEffect, useState } from "react";

export interface MarketState {
  market: DeskMarket | null;
  error: string;
  loading: boolean;
  refresh: () => void;
}

const EVERY_MS = 60_000;

/** A desk's market, read again every minute while the desk is open. */
export function useMarket(module: string | undefined): MarketState {
  const [market, setMarket] = useState<DeskMarket | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(module));
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!module) return;
    let live = true;
    setLoading(true);
    fetch(`/api/desks/market?module=${encodeURIComponent(module)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { market?: DeskMarket; message?: string };
        if (!live) return;
        if (!res.ok || !body.market) throw new Error(body.message ?? "The market did not answer.");
        setMarket(body.market);
        setError("");
      })
      .catch((err: Error) => {
        if (live) setError(err.message === "Failed to fetch" ? "Could not reach the market. Try again." : err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [module, tick]);

  useEffect(() => {
    if (!module) return;
    const timer = setInterval(refresh, EVERY_MS);
    return () => clearInterval(timer);
  }, [module, refresh]);

  return { market, error, loading, refresh };
}

"use client";

import type { DeskPortfolio } from "@perkos/client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface PortfolioState {
  portfolio: DeskPortfolio | null;
  /** "signed_out" once PerkOS says so; "error" only while nothing was read yet. */
  status: "loading" | "ready" | "signed_out" | "error";
  /** Why the last read failed, kept beside a portfolio read before it. */
  error: string;
  loading: boolean;
  load: () => Promise<DeskPortfolio | null>;
}

/** What the delegated wallet holds on a desk and what it cost, read through PerkOS. */
export function usePortfolio(module: string): PortfolioState {
  const [portfolio, setPortfolio] = useState<DeskPortfolio | null>(null);
  const [status, setStatus] = useState<PortfolioState["status"]>("loading");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/desks/positions?module=${encodeURIComponent(module)}`);
      const body = (await res.json().catch(() => ({}))) as { portfolio?: DeskPortfolio; message?: string };
      if (res.status === 401) {
        if (live.current) setStatus("signed_out");
        return null;
      }
      if (!res.ok || !body.portfolio) throw new Error(body.message ?? `Could not read the portfolio (${res.status})`);
      if (live.current) {
        setPortfolio(body.portfolio);
        setError("");
        setStatus("ready");
      }
      return body.portfolio;
    } catch (err) {
      const message = (err as Error).message;
      if (live.current) {
        setError(message === "Failed to fetch" ? "Could not reach PerkOS. Try again." : message);
        // A portfolio read before stays on screen under the error.
        setStatus((s) => (s === "ready" ? s : "error"));
      }
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

  return { portfolio, status, error, loading, load };
}

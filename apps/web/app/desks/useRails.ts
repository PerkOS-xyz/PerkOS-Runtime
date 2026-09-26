"use client";

import type { DeskRails } from "@perkos/client";
import { useCallback, useEffect, useState } from "react";

export interface RailsState {
  rails: DeskRails | null;
  error: string;
  loading: boolean;
  /** Read the rails again and return them, for a step that waits on the chain. */
  load: () => Promise<DeskRails | null>;
}

/** The owner's rails on a vault desk, read from the chain through PerkOS. */
export function useRails(module: string): RailsState {
  const [rails, setRails] = useState<DeskRails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/desks/rails?module=${encodeURIComponent(module)}`);
      const body = (await res.json().catch(() => ({}))) as { rails?: DeskRails; message?: string };
      if (!res.ok || !body.rails) throw new Error(body.message ?? `Could not read the rails (${res.status})`);
      setRails(body.rails);
      setError("");
      return body.rails;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rails, error, loading, load };
}

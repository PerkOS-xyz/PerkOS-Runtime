"use client";

import { useCallback, useEffect, useState } from "react";

export interface ModelSource {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  models: string[];
}

export interface ModelChoice {
  provider: string;
  model: string;
}

export interface ModelState {
  loading: boolean;
  sources: ModelSource[];
  choice: ModelChoice | null;
  busy: boolean;
  error: string;
  reload: () => Promise<void>;
  choose: (choice: ModelChoice) => Promise<void>;
}

/** Model sources detected by the local server, and the saved choice. */
export function useModel(): ModelState {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<ModelSource[]>([]);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/model");
      const body = (await res.json()) as { sources: ModelSource[]; choice: ModelChoice | null };
      setSources(body.sources ?? []);
      setChoice(body.choice ?? null);
    } catch {
      setError("Could not check the model sources.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const choose = useCallback(async (next: ModelChoice) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next)
      });
      const body = (await res.json().catch(() => ({}))) as { choice?: ModelChoice; error?: string };
      if (!res.ok || !body.choice) throw new Error(body.error ?? "Could not save the model.");
      setChoice(body.choice);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return { loading, sources, choice, busy, error, reload, choose };
}

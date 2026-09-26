"use client";

import type { DeskTeam } from "@perkos/client";
import { useCallback, useEffect, useState } from "react";

import { pollEvery } from "./look";

export interface TeamState {
  team: DeskTeam | null;
  busy: boolean;
  error: string;
  wake: () => Promise<void>;
}

/** The desk's team on PerkOS, read again while it wakes and now and then otherwise. */
export function useTeam(desk: string): TeamState {
  const [team, setTeam] = useState<DeskTeam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    const res = await fetch(`/api/desks/team?desk=${encodeURIComponent(desk)}`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { team?: DeskTeam } | null;
    if (res?.ok && body?.team) setTeam(body.team);
  }, [desk]);

  useEffect(() => {
    void read();
  }, [read]);

  const status = team?.status;
  useEffect(() => {
    const timer = setInterval(() => void read(), pollEvery(status));
    return () => clearInterval(timer);
  }, [read, status]);

  const wake = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/desks/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desk })
      });
      const body = (await res.json().catch(() => ({}))) as { team?: DeskTeam; message?: string };
      if (res.status === 402) throw new Error("Add desk time to run the team.");
      if (!res.ok || !body.team) throw new Error(body.message ?? "The team could not wake. Try again in a moment.");
      setTeam(body.team);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [desk]);

  return { team, busy, error, wake };
}

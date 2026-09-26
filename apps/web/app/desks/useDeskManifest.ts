"use client";

import type { DeskManifest } from "@perkos/desk-contract";
import { useEffect, useState } from "react";

/** How the desk presents itself, as the desk writes it. Null until it answers, or when it publishes none. */
export function useDeskManifest(module: string | undefined): DeskManifest | null {
  const [manifest, setManifest] = useState<DeskManifest | null>(null);

  useEffect(() => {
    setManifest(null);
    if (!module) return;
    let live = true;
    fetch(`/api/desks/manifest?module=${encodeURIComponent(module)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ manifest: DeskManifest | null }>) : { manifest: null }))
      .then((body) => {
        if (live) setManifest(body.manifest);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [module]);

  return manifest;
}

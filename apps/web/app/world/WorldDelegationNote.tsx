"use client";

import { useEffect, useState } from "react";
import { worldStatus } from "./flow";

/** Optional guidance only. The API, rather than this note, enforces the permission change. */
export function WorldDelegationNote() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void worldStatus(controller.signal).then((s) => { if (!controller.signal.aborted) setEnabled(s.enabled); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!enabled) return null;
  return <p className="tr-note">World checks the same human before new access or increased limits. Connect your identity in Settings first; the delegation page verifies the exact change. Reductions and revocation do not need World. {" "}<button type="button" className="link-btn" onClick={() => window.dispatchEvent(new Event("perkos:world-settings"))}>World settings</button></p>;
}

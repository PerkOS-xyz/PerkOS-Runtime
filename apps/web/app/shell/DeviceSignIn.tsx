"use client";

import { useEffect, useRef, useState } from "react";

type Start = { userCode: string; verificationUri: string; verificationUriComplete?: string; intervalMs: number };
type Poll = { status: "pending" | "ok" | "denied" | "expired"; intervalMs?: number };

/**
 * Device-code sign-in for a model subscription (Grok, ChatGPT). `api` is the
 * route prefix with `/start` and `/poll`; `site` is where the code is entered.
 */
export function DeviceSignIn({ api, label, site, onSignedIn }: { api: string; label: string; site: string; onSignedIn: () => void }) {
  const [start, setStart] = useState<Start | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function poll(intervalMs: number) {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${api}/poll`, { method: "POST" });
        const body = (await res.json()) as Poll & { message?: string };
        if (!res.ok) throw new Error(body.message ?? "Could not check the sign-in.");
        if (body.status === "pending") return poll(body.intervalMs ?? intervalMs);
        setStart(null);
        if (body.status === "ok") return onSignedIn();
        setError(body.status === "denied" ? `The sign-in was declined at ${site}.` : "The code expired. Start again.");
      } catch (err) {
        setStart(null);
        setError((err as Error).message);
      }
    }, intervalMs);
  }

  async function begin() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${api}/start`, { method: "POST" });
      const body = (await res.json()) as Start & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not start the sign-in.");
      setStart(body);
      window.open(body.verificationUriComplete ?? body.verificationUri, "_blank", "noopener");
      poll(body.intervalMs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (start) {
    return (
      <div className="grok">
        <p className="hint">
          Enter <b className="code">{start.userCode}</b> at{" "}
          <a href={start.verificationUriComplete ?? start.verificationUri} target="_blank" rel="noopener noreferrer">
            {site}
          </a>{" "}
          and approve. This screen continues on its own.
        </p>
      </div>
    );
  }
  return (
    <div className="grok">
      <button type="button" className="chip-btn" disabled={busy} onClick={() => void begin()}>
        {label}
      </button>
      {error ? <p className="hint err">{error}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type Start = { userCode: string; verificationUri: string; verificationUriComplete?: string; intervalMs: number };
type Poll = { status: "pending" | "ok" | "denied" | "expired"; intervalMs?: number };

/** Device-code sign-in with a Grok subscription. Calls onSignedIn once approved. */
export function GrokSignIn({ onSignedIn }: { onSignedIn: () => void }) {
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
        const res = await fetch("/api/xai/poll", { method: "POST" });
        const body = (await res.json()) as Poll & { message?: string };
        if (!res.ok) throw new Error(body.message ?? "Could not check the Grok sign-in.");
        if (body.status === "pending") return poll(body.intervalMs ?? intervalMs);
        setStart(null);
        if (body.status === "ok") return onSignedIn();
        setError(body.status === "denied" ? "The sign-in was declined at x.ai." : "The code expired. Start again.");
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
      const res = await fetch("/api/xai/start", { method: "POST" });
      const body = (await res.json()) as Start & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not start the Grok sign-in.");
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
            x.ai
          </a>{" "}
          and approve. This screen continues on its own.
        </p>
      </div>
    );
  }
  return (
    <div className="grok">
      <button type="button" className="cta" disabled={busy} onClick={() => void begin()}>
        Sign in with Grok
      </button>
      {error ? <p className="hint err">{error}</p> : null}
    </div>
  );
}

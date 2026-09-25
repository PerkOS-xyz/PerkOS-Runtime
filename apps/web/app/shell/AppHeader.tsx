"use client";

import { useEffect, useState, type ReactNode } from "react";

type Identity = { address: string; name: string | null };

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Top bar after sign-in: the wallet's name (ENS or Basename, else the short address) and Log out. */
export function AppHeader({
  section,
  actions,
  onLogout,
  onSettings
}: {
  section: string;
  actions?: ReactNode;
  onLogout: () => Promise<void>;
  onSettings?: () => void;
}) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/identity")
      .then((res) => (res.ok ? (res.json() as Promise<Identity>) : null))
      .then((id) => live && setIdentity(id))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function logout() {
    setLeaving(true);
    try {
      await onLogout();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <header className="app-header">
      <div className="ah-brand">
        <img src="/logo-name.png" alt="PerkOS" />
        <span className="kicker">{section}</span>
      </div>
      <div className="ah-account">
        {actions}
        {onSettings ? (
          <button type="button" className="gear-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-2.4-1.4L14.2 3h-4l-.4 2.5a7.7 7.7 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1c.7.6 1.5 1 2.4 1.4l.4 2.5h4l.4-2.5c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        {identity ? (
          <span className="ah-id" title={identity.address}>
            <i className="ah-dot" aria-hidden />
            {identity.name ?? short(identity.address)}
          </span>
        ) : null}
        <button type="button" className="ah-out" disabled={leaving} onClick={() => void logout()}>
          {leaving ? "Logging out…" : "Log out"}
        </button>
      </div>
    </header>
  );
}

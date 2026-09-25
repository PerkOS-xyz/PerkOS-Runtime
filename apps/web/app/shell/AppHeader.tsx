"use client";

import { useEffect, useState, type ReactNode } from "react";

type Identity = { address: string; name: string | null };

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Top bar after sign-in: the wallet's name (ENS or Basename, else the short address) and Log out. */
export function AppHeader({ section, actions, onLogout }: { section: string; actions?: ReactNode; onLogout: () => Promise<void> }) {
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

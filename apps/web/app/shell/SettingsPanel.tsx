"use client";

import { useEffect, useState } from "react";

import pkg from "../../package.json";
import { useWallet } from "../wallet/context";
import { orderSources, type ModelState } from "./useModel";
import { useVault } from "./useVault";

type Identity = { address: string; name: string | null };

/** How to disconnect each source that holds a session or a key on this machine. */
const DISCONNECT: Record<string, { path: string; label: string }> = {
  xai: { path: "/api/xai", label: "Sign out" },
  openai: { path: "/api/chatgpt", label: "Sign out" },
  anthropic: { path: "/api/anthropic", label: "Remove key" }
};

/** Global settings: account, the model and its connections, and the app. */
export function SettingsPanel({
  open,
  onClose,
  model,
  onChangeModel,
  onLogout
}: {
  open: boolean;
  onClose: () => void;
  model: ModelState;
  onChangeModel: () => void;
  onLogout: () => Promise<void>;
}) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [busy, setBusy] = useState("");
  const vault = useVault(useWallet());

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/identity")
      .then((res) => (res.ok ? (res.json() as Promise<Identity>) : null))
      .then((id) => live && setIdentity(id))
      .catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  async function disconnect(id: string) {
    const target = DISCONNECT[id];
    if (!target) return;
    setBusy(id);
    try {
      await fetch(target.path, { method: "DELETE" });
      await model.reload();
    } finally {
      setBusy("");
    }
  }

  const current = model.choice && model.sources.find((s) => s.id === model.choice?.provider);

  return (
    <div className={`settings${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="settings-backdrop" onClick={onClose} />
      <aside className="settings-panel" role="dialog" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button type="button" className="bubble-close" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </header>

        <section>
          <span className="kicker">Account</span>
          {identity ? (
            <div className="set-account">
              <i className="ah-dot" aria-hidden />
              <div>
                <b>{identity.name ?? `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}`}</b>
                <code>{identity.address}</code>
              </div>
            </div>
          ) : null}
          <button type="button" className="chip-btn" onClick={() => void onLogout()}>
            Log out
          </button>
        </section>

        <section>
          <span className="kicker">AI</span>
          <p className="set-line">
            {model.choice && current?.ok ? (
              <>
                Sparky uses <b>{model.choice.model}</b> · {current.label}
              </>
            ) : (
              "No model is in use."
            )}
          </p>
          <button type="button" className="chip-btn" onClick={onChangeModel}>
            Change model
          </button>
          <ul className="set-sources">
            {orderSources(model.sources).map((s) => (
              <li key={s.id}>
                <span>{s.label}</span>
                <span className={`ptag${s.ok ? " ok" : ""}`}>{s.ok ? "Connected" : "Not connected"}</span>
                {s.ok && DISCONNECT[s.id] ? (
                  <button type="button" className="link-btn" disabled={busy === s.id} onClick={() => void disconnect(s.id)}>
                    {DISCONNECT[s.id]?.label}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <span className="kicker">Memory</span>
          <p className="set-line">
            {vault.unlocked
              ? vault.persistent
                ? "On. Your conversations are kept encrypted with your wallet on this device."
                : "On for this session. Sign again after a restart."
              : "Off. Sparky does not keep your conversations."}
          </p>
          {vault.error ? <p className="set-line hint err">{vault.error}</p> : null}
          {vault.unlocked ? (
            <button type="button" className="chip-btn" disabled={vault.busy} onClick={() => void vault.lock()}>
              Turn off on this device
            </button>
          ) : (
            <button type="button" className="chip-btn" disabled={vault.busy || vault.unlocked === null} onClick={() => void vault.unlock()}>
              {vault.busy ? "Waiting for the signature…" : "Turn on memory"}
            </button>
          )}
        </section>

        <section>
          <span className="kicker">App</span>
          <p className="set-line">PerkOS Runtime {pkg.version}</p>
          <p className="set-line muted">Your sessions, keys and settings stay on this machine, in ~/.perkos-runtime.</p>
        </section>
      </aside>
    </div>
  );
}

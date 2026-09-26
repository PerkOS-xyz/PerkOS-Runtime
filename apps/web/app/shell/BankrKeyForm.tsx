"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type KeyStatus = { saved: boolean; persistent: boolean };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Paste a Bankr API key. It is checked with Bankr and kept on this machine; the field clears after saving. */
export function BankrKeyForm({ onSaved }: { onSaved: (wallet: string) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bankr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key })
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; wallet?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not save the key.");
      setKey("");
      onSaved(body.wallet ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="key-form" onSubmit={save}>
      <div className="provider-pick">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="bk_usr_…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Bankr API key"
          disabled={busy}
        />
        <button type="submit" className="chip-btn" disabled={busy || !key.trim()}>
          {busy ? "Checking…" : "Save key"}
        </button>
      </div>
      <a className="key-link" href="https://bankr.bot/api-keys" target="_blank" rel="noopener noreferrer">
        Create a key on Bankr
      </a>
      {error ? <p className="hint err">{error}</p> : null}
    </form>
  );
}

/** Settings for launching tokens: the Bankr key, what it needs, and where it is kept. */
export function BankrKeySection({ open }: { open: boolean }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/bankr").catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as KeyStatus | null) : null;
    setStatus(body);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function remove() {
    setBusy(true);
    try {
      await fetch("/api/bankr", { method: "DELETE" });
      setWallet("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <span className="kicker">Launches</span>
      {status?.saved ? (
        <>
          <p className="set-line">
            {status.persistent ? "Bankr key saved, encrypted on this device." : "Bankr key saved for this session only. Paste it again after a restart."}
            {wallet ? (
              <>
                {" "}
                Launches go out from your Bankr wallet <b>{short(wallet)}</b>.
              </>
            ) : null}
          </p>
          <button type="button" className="link-btn" disabled={busy} onClick={() => void remove()}>
            Remove key
          </button>
        </>
      ) : (
        <>
          <p className="set-line">
            Launch a token paired with a tokenized stock from a desk. Bankr deploys it from your Bankr wallet. The key needs Bankr&apos;s Token Launch API
            turned on, with read-write access.
          </p>
          <BankrKeyForm
            onSaved={(w) => {
              setWallet(w);
              void load();
            }}
          />
        </>
      )}
    </section>
  );
}

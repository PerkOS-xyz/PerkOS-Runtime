"use client";

import { useState, type FormEvent } from "react";

/** Paste an Anthropic API key. It is checked and stored on this machine; the field clears after saving. */
export function AnthropicKeyForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key })
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? "Could not save the key.");
      setKey("");
      onSaved();
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
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Anthropic API key"
          disabled={busy}
        />
        <button type="submit" className="chip-btn" disabled={busy || !key.trim()}>
          {busy ? "Checking…" : "Save key"}
        </button>
      </div>
      <a className="key-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
        Get a key from the Anthropic console
      </a>
      {error ? <p className="hint err">{error}</p> : null}
    </form>
  );
}

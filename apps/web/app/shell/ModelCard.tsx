"use client";

import { useState, type ReactNode } from "react";

import { AnthropicKeyForm } from "./AnthropicKeyForm";
import { GrokSignIn } from "./GrokSignIn";
import type { ModelSource, ModelState } from "./useModel";
import { WizardFrame } from "./WizardFrame";

/** Subscriptions and keys first, a local runner last. */
const RANK: Record<string, number> = { xai: 0, anthropic: 1, local: 9 };
const order = (sources: ModelSource[]) => [...sources].sort((a, b) => (RANK[a.id] ?? 5) - (RANK[b.id] ?? 5));

/** Screen 2: the model Sparky and the desks talk through. */
export function ModelCard({ state, header, onDone }: { state: ModelState; header: ReactNode; onDone: () => void }) {
  // A saved choice only counts while its source still answers (a Grok session can expire).
  const usable = Boolean(state.choice && state.sources.find((s) => s.id === state.choice?.provider)?.ok);
  return (
    <WizardFrame header={header}>
      <span className="kicker">AI</span>
      <h2>Choose Sparky&apos;s model.</h2>
      <p className="lead">Sparky and your desks think with it. It stays on this machine, and logging out keeps it.</p>
      {state.loading && !state.sources.length ? (
        <p className="wz-note">Looking for models…</p>
      ) : (
        <ul className="providers">
          {order(state.sources).map((source) => (
            <Provider key={source.id} source={source} state={state} />
          ))}
        </ul>
      )}
      {state.error ? <p className="wz-note err">{state.error}</p> : null}
      <div className="wz-actions">
        <button type="button" className="pill" disabled={!usable} onClick={onDone}>
          Continue <span className="arrow" aria-hidden>&rarr;</span>
        </button>
        <button type="button" className="link-btn" disabled={state.loading} onClick={() => void state.reload()}>
          Check again
        </button>
      </div>
    </WizardFrame>
  );
}

function Provider({ source, state }: { source: ModelSource; state: ModelState }) {
  const inUse = source.ok && state.choice?.provider === source.id ? state.choice.model : undefined;
  const [model, setModel] = useState(inUse ?? source.models[0] ?? "");
  const current = source.models.includes(model) ? model : (source.models[0] ?? "");
  return (
    <li className={`provider${inUse ? " on" : ""}`}>
      <div className="provider-head">
        <span className="provider-name">{source.label}</span>
        {inUse ? <span className="ptag ok">In use · {inUse}</span> : source.ok ? <span className="ptag">Ready</span> : null}
      </div>
      <small>{source.detail}</small>
      {source.ok ? (
        <div className="provider-pick">
          {source.models.length > 1 ? (
            <select value={current} disabled={state.busy} onChange={(e) => setModel(e.target.value)}>
              {source.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <span className="model-name">{current}</span>
          )}
          <button
            type="button"
            className="chip-btn"
            disabled={state.busy || !current || current === inUse}
            onClick={() => void state.choose({ provider: source.id, model: current })}
          >
            {current === inUse ? "In use" : "Use"}
          </button>
        </div>
      ) : source.id === "xai" ? (
        <GrokSignIn onSignedIn={() => void state.reload()} />
      ) : source.id === "anthropic" ? (
        <AnthropicKeyForm onSaved={() => void state.reload()} />
      ) : null}
      {source.ok && source.id === "anthropic" ? (
        <button type="button" className="link-btn key-remove" onClick={() => void removeKey(state)}>
          Remove key
        </button>
      ) : null}
    </li>
  );
}

async function removeKey(state: ModelState) {
  await fetch("/api/anthropic", { method: "DELETE" }).catch(() => undefined);
  await state.reload();
}

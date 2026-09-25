"use client";

import { useState } from "react";

import type { ModelState } from "./useModel";

export function ModelStep({ state, enabled }: { state: ModelState; enabled: boolean }) {
  const [changing, setChanging] = useState(false);
  if (!enabled) return null;
  if (state.loading) return <p className="hint">Looking for models…</p>;

  const current = state.choice && state.sources.find((s) => s.id === state.choice?.provider);
  if (state.choice && current && !changing) {
    return (
      <p className="hint ok">
        Using {state.choice.model} · {current.label}{" "}
        <button type="button" className="link" onClick={() => setChanging(true)}>
          Change
        </button>
      </p>
    );
  }

  return (
    <div className="step-action">
      {state.sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          busy={state.busy}
          selected={state.choice?.provider === source.id ? state.choice.model : undefined}
          onChoose={async (model) => {
            await state.choose({ provider: source.id, model });
            setChanging(false);
          }}
        />
      ))}
      <button type="button" className="link" disabled={state.loading} onClick={() => void state.reload()}>
        Check again
      </button>
      {state.error ? <p className="hint err">{state.error}</p> : null}
    </div>
  );
}

function SourceRow({
  source,
  busy,
  selected,
  onChoose
}: {
  source: { id: string; label: string; ok: boolean; detail: string; models: string[] };
  busy: boolean;
  selected: string | undefined;
  onChoose: (model: string) => Promise<void>;
}) {
  const [model, setModel] = useState(selected ?? source.models[0] ?? "");
  return (
    <div className="source">
      <b>{source.label}</b>
      <small className={source.ok ? "" : "err"}>{source.detail}</small>
      {source.ok ? (
        <div className="row">
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
            {source.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" className="cta" disabled={busy || !model} onClick={() => void onChoose(model)}>
            Use this model
          </button>
        </div>
      ) : null}
    </div>
  );
}

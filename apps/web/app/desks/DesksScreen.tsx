"use client";

import { useEffect, useState } from "react";

import { SparkyBubble } from "../chat/SparkyBubble";
import { AppHeader } from "../shell/AppHeader";
import { CHAIN_LABEL, chainOf } from "./chains";

export type Desk = { id: string; name: string; description: string; module?: string };

/** The desks this wallet can open, as a row of cards. */
export function DesksScreen({
  model,
  onChangeModel,
  onOpen,
  onLogout,
  onSettings
}: {
  model: string | null;
  onChangeModel: () => void;
  onOpen: (desk: Desk) => void;
  onLogout: () => Promise<void>;
  onSettings: () => void;
}) {
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/desks")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { desks?: Desk[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? `Could not load the desks (${res.status})`);
        if (live) setDesks(body.desks ?? []);
      })
      .catch((err: Error) => {
        if (!live) return;
        setError(err.message);
        setDesks([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="desks-home">
      <AppHeader
        section="Desks"
        onLogout={onLogout}
        onSettings={onSettings}
        actions={
          model ? (
            <button type="button" className="ai-chip" onClick={onChangeModel} title="Change the model">
              <span className="kicker">AI</span>
              {model}
            </button>
          ) : null
        }
      />
      <section className="dh-intro">
        <span className="kicker">Your desks</span>
        <h1>Pick a desk.</h1>
        <p>Each desk is a team of agents with its own market and screens. Open one and Sparky comes along.</p>
      </section>
      {error ? <p className="wz-note err dh-note">{error}</p> : null}
      <ul className="deck" aria-busy={!desks}>
        {!desks ? <li className="desk-card skel" aria-hidden /> : null}
        {desks?.map((d, i) => {
          const chain = chainOf(d.module);
          return (
            <li key={d.id} className={`desk-card ${chain}`} style={{ animationDelay: `${120 + i * 90}ms` }}>
              <header>
                <span className="kicker">Desk</span>
                {chain !== "neutral" ? <span className={`chain-badge ${chain}`}>{CHAIN_LABEL[chain]}</span> : null}
              </header>
              <div className="desk-art">
                <img className="desk-art-logo" src="/logo.png" alt="" />
                <b>{d.name}</b>
                <img className="desk-art-sparky" src="/sparky-full.png" alt="" draggable={false} />
              </div>
              {d.module ? <span className="desk-module">{d.module}</span> : null}
              <p>{d.description}</p>
              <footer>
                <button type="button" className="pill small" onClick={() => onOpen(d)}>
                  Open desk <span className="arrow" aria-hidden>&rarr;</span>
                </button>
                <small>
                  {i + 1} of {desks.length}
                </small>
              </footer>
            </li>
          );
        })}
      </ul>
      {desks && !desks.length && !error ? <p className="wz-note dh-note">No desks are published yet.</p> : null}
      <SparkyBubble model={model} />
    </main>
  );
}

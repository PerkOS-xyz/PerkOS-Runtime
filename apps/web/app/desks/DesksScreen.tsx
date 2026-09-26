"use client";

import { useEffect, useState } from "react";

import { SparkyScene } from "../chat/SparkyScene";
import { AppHeader } from "../shell/AppHeader";
import { CHAIN_LABEL, chainOf } from "./chains";

export type Desk = { id: string; name: string; description: string; module?: string };

/** The desk this build puts first; the rest are one tap away. */
const FEATURED = (process.env.NEXT_PUBLIC_FEATURED_DESK?.trim() || "eqlty").toLowerCase();

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
  const [withSparky, setWithSparky] = useState(false);
  const [showAll, setShowAll] = useState(false);

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

  const featured = desks?.find((d) => `${d.id} ${d.module ?? ""}`.toLowerCase().includes(FEATURED)) ?? desks?.[0] ?? null;
  const featuredChain = chainOf(featured?.module);
  const featuring = !showAll && (featured !== null || !desks);

  return (
    <main className={`desks-home${featuring ? " featured" : ""}${withSparky ? " behind" : ""}`}>
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
      {featuring ? (
        <section className={`dh-featured ${featured ? featuredChain : "skel"}`} aria-label="Featured desk" aria-busy={!featured}>
          {featured ? (
            <>
              <div className="df-copy">
                <span className="kicker">Featured desk</span>
                <h1>{featured.name}</h1>
                {featuredChain !== "neutral" ? <span className={`chain-badge ${featuredChain}`}>{CHAIN_LABEL[featuredChain]}</span> : null}
                <p>{featured.description}</p>
                <div className="df-cta">
                  <button type="button" className="pill" onClick={() => onOpen(featured)}>
                    Open desk <span className="arrow" aria-hidden>&rarr;</span>
                  </button>
                  {desks && desks.length > 1 ? (
                    <button type="button" className="link-btn df-more" onClick={() => setShowAll(true)}>
                      See all desks ({desks.length})
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="df-art" aria-hidden>
                <i className="df-glow" />
                <img className="df-sparky" src="/sparky-full.png" alt="" draggable={false} />
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      <section className="dh-intro">
        {featured ? (
          <button type="button" className="link-btn dh-back" onClick={() => setShowAll(false)}>
            &larr; Featured desk
          </button>
        ) : null}
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
      <SparkyScene model={model} onOpenChange={setWithSparky} />
    </main>
  );
}

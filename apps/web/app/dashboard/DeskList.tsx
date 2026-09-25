"use client";

import { useEffect, useState } from "react";

type Desk = { id: string; name: string; description: string; module?: string };

export function DeskList() {
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/desks")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { desks?: Desk[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? `Could not load desks (${res.status})`);
        if (live) setDesks(body.desks ?? []);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <aside className="desks">
      <h3>Desks</h3>
      {error ? <p className="hint err">{error}</p> : null}
      {!desks && !error ? <p className="hint">Loading…</p> : null}
      {desks && !desks.length ? <p className="hint">No desks are published yet.</p> : null}
      {desks?.map((d) => (
        <div key={d.id} className="desk">
          <b>{d.name}</b>
          <small>{d.description}</small>
          {d.module ? <span className="tag">{d.module}</span> : null}
        </div>
      ))}
    </aside>
  );
}

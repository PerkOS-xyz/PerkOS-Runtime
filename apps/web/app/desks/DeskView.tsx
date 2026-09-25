"use client";

import { SparkyChat } from "../chat/SparkyChat";
import { AppHeader } from "../shell/AppHeader";
import { CHAIN_LABEL, chainOf } from "./chains";
import type { Desk } from "./DesksScreen";

/** An open desk: its card on the left, the full chat with Sparky on the right. */
export function DeskView({ desk, onBack, onLogout }: { desk: Desk; onBack: () => void; onLogout: () => Promise<void> }) {
  const chain = chainOf(desk.module);
  return (
    <main className="desk-view">
      <AppHeader
        section={desk.name}
        onLogout={onLogout}
        actions={
          <button type="button" className="ah-out" onClick={onBack}>
            All desks
          </button>
        }
      />
      <div className="dv-body">
        <aside className={`dv-side ${chain}`}>
          <span className="kicker">Desk</span>
          <h1>{desk.name}</h1>
          {chain !== "neutral" ? <span className={`chain-badge ${chain}`}>{CHAIN_LABEL[chain]}</span> : null}
          <p>{desk.description}</p>
          <img className="dv-sparky" src="/sparky-full.png" alt="" draggable={false} />
        </aside>
        <SparkyChat desk={desk.id} greeting={`You are in ${desk.name}. Ask me about it, or tell me what you want to do here.`} />
      </div>
    </main>
  );
}

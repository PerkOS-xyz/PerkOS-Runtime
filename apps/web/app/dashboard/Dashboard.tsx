"use client";

import { SparkyChat } from "./SparkyChat";

export function Dashboard({ onSetup }: { onSetup: () => void }) {
  return (
    <main className="dashboard">
      <header className="brand">
        <img src="/sparky.png" alt="" width={32} height={32} />
        <span>PerkOS Runtime</span>
        <button type="button" className="link push" onClick={onSetup}>
          Setup
        </button>
      </header>
      <SparkyChat />
    </main>
  );
}

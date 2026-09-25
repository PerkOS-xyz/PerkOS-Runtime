"use client";

import { AppHeader } from "../shell/AppHeader";
import { DeskList } from "./DeskList";
import { SparkyChat } from "./SparkyChat";

export function Dashboard({ onSetup, onLogout }: { onSetup: () => void; onLogout: () => Promise<void> }) {
  return (
    <main className="dashboard">
      <AppHeader
        section="Desks"
        onLogout={onLogout}
        actions={
          <button type="button" className="ah-out" onClick={onSetup}>
            Setup
          </button>
        }
      />
      <div className="board">
        <SparkyChat />
        <DeskList />
      </div>
    </main>
  );
}

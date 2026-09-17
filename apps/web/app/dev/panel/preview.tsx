"use client";

import { useState } from "react";
import "../../floor/apiToken";
import DeskPanel, { type DeskScreen } from "../../floor/DeskPanel";
import ChatsDrawer from "../../floor/ChatsDrawer";

const SCREENS: DeskScreen[] = ["market", "portfolio", "launches", "automations", "notes", "map", "history"];

export default function PanelPreview({ initial }: { initial: string }) {
  const [screen, setScreen] = useState<DeskScreen>((SCREENS as string[]).includes(initial) ? (initial as DeskScreen) : "launches");
  const [max, setMax] = useState(true);
  // ?screen=drawer: el cajon de hilos del lado del chat, contra la API real.
  if (initial === "drawer") {
    return (
      <main className="stage" style={{ minHeight: "100vh" }}>
        <ChatsDrawer bridge={{ activeId: "", locked: false, canUnlock: false, refreshKey: 0, onOpen: (id) => console.log("open", id), onNew: () => console.log("new"), onUnlock: () => undefined, onDeleted: () => undefined }} onClose={() => console.log("close")} />
      </main>
    );
  }
  return (
    <main className="stage desk-open desk-max" style={{ minHeight: "100vh" }}>
      <DeskPanel screen={screen} focus="" onScreen={setScreen} onClose={() => undefined} onSay={(t) => console.log("say:", t)} max={max} onMax={setMax} />
    </main>
  );
}

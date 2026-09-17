"use client";

import { useState } from "react";
import "../../floor/apiToken";
import DeskPanel, { type DeskScreen } from "../../floor/DeskPanel";

const SCREENS: DeskScreen[] = ["market", "portfolio", "launches", "automations", "chats", "notes", "map", "history"];

export default function PanelPreview({ initial }: { initial: string }) {
  const [screen, setScreen] = useState<DeskScreen>((SCREENS as string[]).includes(initial) ? (initial as DeskScreen) : "launches");
  const [max, setMax] = useState(true);
  return (
    <main className="stage desk-open desk-max" style={{ minHeight: "100vh" }}>
      <DeskPanel screen={screen} focus="" onScreen={setScreen} onClose={() => undefined} onSay={(t) => console.log("say:", t)} max={max} onMax={setMax} />
    </main>
  );
}

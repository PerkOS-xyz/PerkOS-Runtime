"use client";

import { useState } from "react";
import DeskPanel, { type DeskScreen } from "../../floor/DeskPanel";

export default function LaunchesPreview() {
  const [screen, setScreen] = useState<DeskScreen>("launches");
  const [max, setMax] = useState(true);
  return (
    <main className="stage desk-open desk-max" style={{ minHeight: "100vh" }}>
      <DeskPanel screen={screen} focus="" onScreen={setScreen} onClose={() => undefined} onSay={(t) => console.log("say:", t)} max={max} onMax={setMax} />
    </main>
  );
}

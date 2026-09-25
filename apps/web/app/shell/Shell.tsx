"use client";

import { useState } from "react";

import { Setup } from "./Setup";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "setup";

/** Welcome screen first, then the setup steps. */
export function Shell() {
  const [stage, setStage] = useState<Stage>("welcome");
  if (stage === "welcome") return <Welcome onStart={() => setStage("setup")} />;
  return <Setup onBack={() => setStage("welcome")} />;
}

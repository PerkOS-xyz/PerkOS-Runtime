"use client";

import { useState } from "react";

import { WalletProvider } from "../wallet/WalletProvider";
import { Setup } from "./Setup";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "setup";

/** Welcome screen first, then the setup steps. */
export function Shell() {
  const [stage, setStage] = useState<Stage>("welcome");
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      {stage === "welcome" ? <Welcome onStart={() => setStage("setup")} /> : <Setup onBack={() => setStage("welcome")} />}
    </WalletProvider>
  );
}

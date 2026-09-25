"use client";

import { useState } from "react";

import { Dashboard } from "../dashboard/Dashboard";
import { WalletProvider } from "../wallet/WalletProvider";
import { Setup } from "./Setup";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "setup" | "dashboard";

/** Welcome screen first, then the setup steps, then the dashboard. */
export function Shell() {
  const [stage, setStage] = useState<Stage>("welcome");
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      {stage === "welcome" ? <Welcome onStart={() => setStage("setup")} /> : null}
      {stage === "setup" ? <Setup onBack={() => setStage("welcome")} onDone={() => setStage("dashboard")} /> : null}
      {stage === "dashboard" ? <Dashboard onSetup={() => setStage("setup")} /> : null}
    </WalletProvider>
  );
}

"use client";

import { useState } from "react";

import { Dashboard } from "../dashboard/Dashboard";
import { useWallet } from "../wallet/context";
import { WalletProvider } from "../wallet/WalletProvider";
import { Setup } from "./Setup";
import { SignIn } from "./SignIn";
import { usePerkosSession } from "./usePerkosSession";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "signin" | "setup" | "dashboard";

export function Shell() {
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      <Stages />
    </WalletProvider>
  );
}

/** Welcome screen, then sign-in, then the remaining setup and the dashboard. */
function Stages() {
  const wallet = useWallet();
  const session = usePerkosSession(wallet);
  const [stage, setStage] = useState<Stage>("welcome");

  function start() {
    if (session.signedIn) {
      setStage("setup");
      return;
    }
    // Opened from the click itself, so the wallet window is not treated as a popup.
    if (wallet.enabled && !wallet.connected) wallet.open();
    setStage("signin");
  }

  if (stage === "welcome") return <Welcome busy={session.loading} onStart={start} />;
  if (stage === "signin") {
    return <SignIn wallet={wallet} session={session} onDone={() => setStage("setup")} onBack={() => setStage("welcome")} />;
  }
  const logout = async () => {
    await session.signOut();
    setStage("welcome");
  };
  if (stage === "setup") {
    return <Setup onBack={() => setStage("welcome")} onDone={() => setStage("dashboard")} onLogout={logout} />;
  }
  return <Dashboard onSetup={() => setStage("setup")} onLogout={logout} />;
}

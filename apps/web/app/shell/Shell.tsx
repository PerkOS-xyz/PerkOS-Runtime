"use client";

import { useState } from "react";

import { Dashboard } from "../dashboard/Dashboard";
import { useWallet } from "../wallet/context";
import { WalletProvider } from "../wallet/WalletProvider";
import { AppHeader } from "./AppHeader";
import { ModelCard } from "./ModelCard";
import { SignIn } from "./SignIn";
import { useModel } from "./useModel";
import { usePerkosSession } from "./usePerkosSession";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "signin" | "model" | "dashboard";

export function Shell() {
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      <Stages />
    </WalletProvider>
  );
}

/** Welcome screen, then sign-in and the model, then the desks. */
function Stages() {
  const wallet = useWallet();
  const session = usePerkosSession(wallet);
  const model = useModel();
  const [stage, setStage] = useState<Stage>("welcome");

  const afterSignIn = () => setStage(model.choice ? "dashboard" : "model");

  function start() {
    if (session.signedIn) {
      afterSignIn();
      return;
    }
    // Opened from the click itself, so the wallet window is not treated as a popup.
    if (wallet.enabled && !wallet.connected) wallet.open();
    setStage("signin");
  }

  const logout = async () => {
    await session.signOut();
    setStage("welcome");
  };

  if (stage === "welcome") return <Welcome busy={session.loading || model.loading} onStart={start} />;
  if (stage === "signin") {
    return <SignIn wallet={wallet} session={session} onDone={afterSignIn} onBack={() => setStage("welcome")} />;
  }
  if (stage === "model") {
    return (
      <ModelCard
        state={model}
        header={<AppHeader section="Setup" onLogout={logout} />}
        onDone={() => setStage("dashboard")}
      />
    );
  }
  return <Dashboard onSetup={() => setStage("model")} onLogout={logout} />;
}

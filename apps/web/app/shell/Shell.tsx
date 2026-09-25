"use client";

import { useState } from "react";

import { DeskView } from "../desks/DeskView";
import { DesksScreen, type Desk } from "../desks/DesksScreen";
import { useWallet } from "../wallet/context";
import { WalletProvider } from "../wallet/WalletProvider";
import { AppHeader } from "./AppHeader";
import { ModelCard } from "./ModelCard";
import { SignIn } from "./SignIn";
import { useModel } from "./useModel";
import { usePerkosSession } from "./usePerkosSession";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "signin" | "model" | "desks" | "desk";

export function Shell() {
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      <Stages />
    </WalletProvider>
  );
}

/** Welcome screen, then sign-in and the model, then the desks and an open desk. */
function Stages() {
  const wallet = useWallet();
  const session = usePerkosSession(wallet);
  const model = useModel();
  const [stage, setStage] = useState<Stage>("welcome");
  const [desk, setDesk] = useState<Desk | null>(null);

  const afterSignIn = () => setStage(model.choice ? "desks" : "model");

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
        onDone={() => setStage("desks")}
      />
    );
  }
  if (stage === "desk" && desk) {
    return <DeskView desk={desk} onBack={() => setStage("desks")} onLogout={logout} />;
  }
  return (
    <DesksScreen
      model={model.choice?.model ?? null}
      onChangeModel={() => setStage("model")}
      onOpen={(d) => {
        setDesk(d);
        setStage("desk");
      }}
      onLogout={logout}
    />
  );
}

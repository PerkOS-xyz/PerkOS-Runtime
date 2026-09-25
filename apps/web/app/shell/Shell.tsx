"use client";

import { useState } from "react";

import { DeskView } from "../desks/DeskView";
import { DesksScreen, type Desk } from "../desks/DesksScreen";
import { useWallet } from "../wallet/context";
import { WalletProvider } from "../wallet/WalletProvider";
import { AppHeader } from "./AppHeader";
import { ModelCard } from "./ModelCard";
import { useLogin } from "./useLogin";
import { useModel } from "./useModel";
import { usePerkosSession } from "./usePerkosSession";
import { Welcome } from "./Welcome";

type Stage = "welcome" | "model" | "desks" | "desk";

export function Shell() {
  return (
    <WalletProvider>
      <div className="dragbar" aria-hidden />
      <Stages />
    </WalletProvider>
  );
}

/** Two screens to get in (welcome with login, then the model), then the desks and an open desk. */
function Stages() {
  const wallet = useWallet();
  const session = usePerkosSession(wallet);
  const model = useModel();
  const [stage, setStage] = useState<Stage>("welcome");
  const [desk, setDesk] = useState<Desk | null>(null);

  const afterSignIn = () => setStage(model.choice ? "desks" : "model");
  const login = useLogin(wallet, session, afterSignIn);

  const logout = async () => {
    await session.signOut();
    setStage("welcome");
  };

  if (stage === "welcome") {
    return <Welcome login={login} busy={session.loading || model.loading} walletError={wallet.error} />;
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

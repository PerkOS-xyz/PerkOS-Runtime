"use client";

import { useWallet } from "../wallet/context";
import { AppHeader } from "./AppHeader";
import { ModelStep } from "./ModelStep";
import { useModel } from "./useModel";
import { usePerkosSession, type PerkosSessionState } from "./usePerkosSession";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function Setup({ onBack, onDone, onLogout }: { onBack: () => void; onDone: () => void; onLogout: () => Promise<void> }) {
  const wallet = useWallet();
  const session = usePerkosSession(wallet);
  const model = useModel();
  return (
    <main className="setup">
      <AppHeader section="Setup" onLogout={onLogout} />
      <section>
        <h2>Two steps and we are ready.</h2>
        <ol className="steps">
          <li className={session.signedIn ? "done" : "active"}>
            <span className="n">1</span>
            <div>
              <b>Connect your wallet</b>
              <small>It is how PerkOS knows you. Nothing moves without your signature.</small>
              <WalletStep session={session} />
            </div>
          </li>
          <li className={model.choice ? "done" : session.signedIn ? "active" : ""}>
            <span className="n">2</span>
            <div>
              <b>Choose a model</b>
              <small>Ollama or LM Studio on this machine, or a model you already pay for.</small>
              <ModelStep state={model} enabled={session.signedIn} />
            </div>
          </li>
        </ol>
        {session.signedIn && model.choice ? (
          <button type="button" className="cta ready" onClick={onDone}>
            Open dashboard
          </button>
        ) : null}
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
      </section>
    </main>
  );
}

function WalletStep({ session }: { session: PerkosSessionState }) {
  const wallet = useWallet();
  if (!wallet.enabled) {
    return <p className="hint err">Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID in apps/web/.env.local</p>;
  }
  if (!wallet.connected) {
    return (
      <div className="step-action">
        <button type="button" className="cta" disabled={wallet.busy} onClick={wallet.open}>
          {wallet.loaded ? "Connect wallet" : "Loading…"}
        </button>
        {wallet.error ? <p className="hint err">{wallet.error}</p> : null}
      </div>
    );
  }
  if (session.signedIn) {
    return (
      <p className="hint ok">
        Signed in · {short(wallet.address)}{" "}
        <button type="button" className="link" disabled={session.busy} onClick={() => void session.signOut()}>
          Sign out
        </button>
      </p>
    );
  }
  return (
    <div className="step-action">
      <p className="hint">
        Connected · {short(wallet.address)}{" "}
        <button type="button" className="link" disabled={wallet.busy || session.busy} onClick={() => void wallet.logout()}>
          Disconnect
        </button>
      </p>
      <button type="button" className="cta" disabled={session.busy || session.loading} onClick={() => void session.signIn()}>
        {session.busy ? "Waiting for signature…" : "Sign in to PerkOS"}
      </button>
      <p className="hint">Your wallet asks you to sign a message. It does not move funds.</p>
      {session.error ? <p className="hint err">{session.error}</p> : null}
    </div>
  );
}

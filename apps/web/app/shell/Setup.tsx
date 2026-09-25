"use client";

import { useWallet } from "../wallet/context";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function Setup({ onBack }: { onBack: () => void }) {
  const wallet = useWallet();
  return (
    <main className="setup">
      <header className="brand">
        <img src="/sparky.png" alt="" width={32} height={32} />
        <span>PerkOS Runtime</span>
      </header>
      <section>
        <h2>Two steps and we are ready.</h2>
        <ol className="steps">
          <li className={wallet.connected ? "done" : "active"}>
            <span className="n">1</span>
            <div>
              <b>Connect your wallet</b>
              <small>It is how PerkOS knows you. Nothing moves without your signature.</small>
              <WalletStep />
            </div>
          </li>
          <li className={wallet.connected ? "active" : ""}>
            <span className="n">2</span>
            <div>
              <b>Choose a model</b>
              <small>Ollama or LM Studio on this machine, or a model you already pay for.</small>
            </div>
          </li>
        </ol>
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
      </section>
    </main>
  );
}

function WalletStep() {
  const wallet = useWallet();
  if (!wallet.enabled) {
    return <p className="hint err">Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID in apps/web/.env.local</p>;
  }
  if (wallet.connected) {
    return (
      <p className="hint ok">
        Connected · {short(wallet.address)}{" "}
        <button type="button" className="link" disabled={wallet.busy} onClick={() => void wallet.logout()}>
          Disconnect
        </button>
      </p>
    );
  }
  return (
    <div className="step-action">
      <button type="button" className="cta" disabled={wallet.busy} onClick={wallet.open}>
        {wallet.loaded ? "Connect wallet" : "Loading…"}
      </button>
      {wallet.error ? <p className="hint err">{wallet.error}</p> : null}
    </div>
  );
}

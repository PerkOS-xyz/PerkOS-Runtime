"use client";

import { useEffect, useState } from "react";
import Ambient from "./Ambient";
import XaiConnect from "./XaiConnect";
import { useWallet } from "./wallet/context";

// Pasos: 0 ident cinematografico -> 1 Privy (wallet) -> 2 LLM.
// El paso 2 solo aparece si no hay LLM conectado en la maquina; FloorApp lo decide.

export default function Wizard({ onDone, start = 0 }: { onDone: () => void; start?: number }) {
  const [step, setStep] = useState(start);
  if (step === 0) {
    return (
      <div className="wizard">
        <Ambient cine>
          <div className="wizard-card ident">
            <img className="cine-mark" src="/logo-vertical.png" alt="PerkOS" />
            <p className="cine-line">Your business just hired its first team.</p>
            <small className="cine-sub">They draft. You approve.</small>
            <button className="cine-cta" type="button" onClick={() => setStep(1)}>
              Continue
            </button>
          </div>
        </Ambient>
      </div>
    );
  }
  return <Auth step={step} setStep={setStep} onDone={onDone} />;
}

type Llm = { provider: string; model: string; connected: boolean };

const PROVIDERS: Array<{ id: string; label: string; sub: string; soon?: boolean }> = [
  { id: "xai-oauth", label: "xAI · Grok", sub: "Sign in with your SuperGrok / Premium+ subscription" },
  { id: "openai", label: "OpenAI", sub: "API key", soon: true },
  { id: "anthropic", label: "Anthropic", sub: "API key", soon: true },
  { id: "local", label: "Local", sub: "Ollama / LM Studio", soon: true }
];

function Auth({ step, setStep, onDone }: { step: number; setStep: (n: number) => void; onDone: () => void }) {
  const wallet = useWallet();
  const [llm, setLlm] = useState<Llm | null>(null);

  useEffect(() => {
    if (step === 1 && wallet.connected) setStep(2);
  }, [step, wallet.connected, setStep]);

  useEffect(() => {
    if (step !== 1) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStep(0); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, setStep]);

  useEffect(() => {
    if (step !== 2) return;
    void fetch("/api/llm/status").then((r) => r.json()).then(setLlm).catch(() => setLlm(null));
  }, [step]);

  async function finish() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: wallet.address, finish: true })
    });
    onDone();
  }

  return (
    <div className="wizard">
      <Ambient>
        {step === 1 ? (
          <div className="wizard-card">
            <div className="k">SIGN IN</div>
            <b>Welcome to PerkOS.</b>
            <p className="lead">
              Use your email or Google. Your account lives on this Mac and never spends anything without you.
            </p>
            <p className="hint-line">Have a crypto wallet? You can use that too.</p>
            {!wallet.enabled ? <p className="hint-line err">Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local</p> : null}
            {wallet.error ? <p className="hint-line err">{wallet.error}</p> : null}
            <button type="button" className="cta" disabled={!wallet.enabled || wallet.busy} onClick={() => wallet.open()}>
              {wallet.busy ? "Loading…" : "Continue"}
            </button>
            <button type="button" className="back" onClick={() => setStep(0)}>← Back</button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-card">
            <div className="k">LLM</div>
            <b>The team needs a model.</b>
            <p className="hint-line">Stays on this machine. Logging out of the wallet keeps it connected.</p>
            <ul className="providers">
              {PROVIDERS.map((p) => (
                <li key={p.id} className={`provider${p.soon ? " soon" : ""}${llm?.provider === p.id && llm.connected ? " on" : ""}`}>
                  <div className="provider-head">
                    <span className="provider-name">{p.label}</span>
                    {p.soon ? <span className="tag">Coming soon</span> : null}
                    {llm?.provider === p.id && llm.connected ? <span className="tag ok">Connected · {llm.model}</span> : null}
                  </div>
                  <small>{p.sub}</small>
                  {p.id === "xai-oauth" && !p.soon ? (
                    <XaiConnect
                      label={llm?.connected ? "Reconnect" : "Sign in with your Grok subscription"}
                      onConnected={() => void fetch("/api/llm/status").then((r) => r.json()).then(setLlm)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="row">
              <button type="button" className="cta" disabled={!llm?.connected} onClick={() => void finish()}>
                Enter Floor
              </button>
            </div>
          </div>
        ) : null}
      </Ambient>
    </div>
  );
}

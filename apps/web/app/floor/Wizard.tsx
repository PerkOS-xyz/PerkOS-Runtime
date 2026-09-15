"use client";

import { useEffect, useState } from "react";
import Ambient from "./Ambient";
import XaiConnect from "./XaiConnect";
import { useWallet } from "./wallet/context";

// Pasos: 0 ident cinematografico -> 1 Privy (wallet) -> 2 LLM -> 3 equipo.
// FloorApp decide donde arranca: 2 si falta el LLM, 3 si falta la flota. El
// paso 3 es onboarding, no escena: la esfera recien aparece con equipo.

export type DeskCard = { id: string; name: string; description: string; idleMinutes: number; agents: Array<{ role: string; name: string; duty: string }> };
export type TeamStep = {
  /** Una card por template fleet publicado en PerkOS. Hoy: PerkOS Floor desk. */
  desks: DeskCard[];
  desk: DeskCard | null;
  deskNote: string;
  onSelect: (id: string) => void;
  perkosConnected: boolean;
  perkosBusy: boolean;
  perkosNote: string;
  fundingUrl: string;
  paying: boolean;
  deploying: boolean;
  onDeploy: () => void;
  onPay: () => void;
  onReconnect: () => void;
  onSkip: () => void;
};

export default function Wizard({ onDone, start = 0, team }: { onDone: () => void; start?: number; team?: TeamStep }) {
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
  return <Auth step={step} setStep={setStep} onDone={onDone} team={team} />;
}

type Llm = { provider: string; model: string; connected: boolean };

const PROVIDERS: Array<{ id: string; label: string; sub: string; soon?: boolean }> = [
  { id: "xai-oauth", label: "xAI · Grok", sub: "Sign in with your SuperGrok / Premium+ subscription" },
  { id: "openai", label: "OpenAI", sub: "API key", soon: true },
  { id: "anthropic", label: "Anthropic", sub: "API key", soon: true },
  { id: "local", label: "Local", sub: "Ollama / LM Studio", soon: true }
];

function Auth({ step, setStep, onDone, team }: { step: number; setStep: (n: number) => void; onDone: () => void; team?: TeamStep }) {
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
    // Con el LLM listo sigue el equipo; FloorApp cierra el wizard cuando la
    // flota existe (o al saltar el paso).
    if (team) setStep(3);
    else onDone();
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
                {team ? "Continue" : "Enter Floor"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 && team ? <TeamCard team={team} /> : null}
      </Ambient>
    </div>
  );
}

/** Paso 3: elegir el equipo. Una card por template fleet de PerkOS (hoy una);
 *  la elegida muestra sus roles y el boton de deploy bajo la cuenta del usuario. */
function TeamCard({ team }: { team: TeamStep }) {
  const { desks, desk, deskNote, perkosConnected, perkosBusy, perkosNote, fundingUrl, paying, deploying } = team;
  const ready = perkosConnected && !!desk;
  return (
    <div className="wizard-card team">
      <div className="k">YOUR TEAM</div>
      <b>{desks.length > 1 ? "Choose a team." : "Your first team."}</b>
      <p className="lead">Teams run on PerkOS infrastructure under your account. They draft; you approve.</p>

      {!perkosConnected ? (
        <p className="hint-line">
          {perkosBusy ? "Connecting your PerkOS account… approve the signature in your wallet." : perkosNote || "PerkOS account not connected."}
        </p>
      ) : null}
      {perkosConnected && !desks.length && deskNote ? <p className="hint-line err">{deskNote}</p> : null}

      {desks.length ? (
        <div className="desk-cards" role="list">
          {desks.map((d) => {
            const on = desk?.id === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="listitem"
                className={`desk-card${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => team.onSelect(d.id)}
              >
                <span className="k">PERKOS TEMPLATE</span>
                <strong>{d.name}</strong>
                <span className="desk-desc">{d.description}</span>
                <span className="desk-roles">
                  {d.agents.map((a) => (
                    <span key={a.role} className="tag role">{a.name}</span>
                  ))}
                </span>
                <span className="desk-meta">{d.agents.length} agents · sleeps after {d.idleMinutes} min idle</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {desk ? (
        <ul className="providers team-roles">
          {desk.agents.map((a) => (
            <li key={a.role} className="provider">
              <div className="provider-head">
                <span className="provider-name">{a.name}</span>
                <span className="tag role">{a.role}</span>
              </div>
              <small>{a.duty}</small>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="row">
        {!perkosConnected && !perkosBusy ? (
          <button type="button" className="cta" onClick={team.onReconnect}>Connect PerkOS</button>
        ) : fundingUrl ? (
          <button type="button" className="cta" disabled={paying} onClick={team.onPay}>
            {paying ? "Waiting for payment…" : "Activate PerkOS infrastructure"}
          </button>
        ) : (
          <button type="button" className="cta" disabled={!ready || deploying} onClick={team.onDeploy}>
            {deploying ? "Deploying…" : `Deploy ${desk?.name ?? "team"} on PerkOS`}
          </button>
        )}
      </div>
      <p className="hint-line">
        {fundingUrl
          ? "Opens pay.perkos.xyz in your browser. Card, USDC on Base, or a code. The team deploys as soon as the balance is positive."
          : "Runs under your account · they draft, you approve."}
      </p>
      <button type="button" className="back" onClick={team.onSkip}>Enter Floor without a team</button>
    </div>
  );
}

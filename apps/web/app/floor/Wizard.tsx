"use client";

import { useEffect, useState } from "react";
import Ambient from "./Ambient";
import XaiConnect from "./XaiConnect";
import { useWallet } from "./wallet/context";
import { flog } from "./log";

// Pasos: 0 ident cinematografico -> 1 Privy (wallet) -> 2 LLM -> 3 equipo ->
// 4 rail de gasto (1Claw, opcional). FloorApp decide donde arranca: 2 si falta
// el LLM, 3 si falta la flota, 4 recien desplegada la flota. Los pasos 3 y 4
// son onboarding, no escena: la esfera recien aparece con equipo.

export type DeskCard = { id: string; name: string; description: string; idleMinutes: number; agents: Array<{ role: string; name: string; duty: string }> };
export type TeamStep = {
  /** Como se va a llamar este desk: es el nombre del proyecto en PerkOS. */
  name: string;
  onName: (v: string) => void;
  /** Una card por desk publicado en PerkOS (project template de tipo fleet). Hoy: PerkOS Floor Desk. */
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
  /** Abierto a mano teniendo ya un desk: hay sitio al que volver, y la salida no es "entrar sin equipo". */
  adding?: boolean;
  onCancel?: () => void;
  /** Por que no se puede montar otro desk de esta plantilla con esta wallet, si es el caso. */
  blocked?: string;
};

export type RailStep = {
  status: "unknown" | "not_configured" | "not_connected" | "claim_pending" | "linked";
  /** Estado del agente con rail (Trader): solo `ready` puede vincularse. */
  traderName: string;
  traderState: string;
  lockUsd: number;
  busy: boolean;
  note: string;
  claimUrl?: string;
  onLink: (email: string) => void;
  onOpenClaim: () => void;
  onSkip: () => void;
};

export default function Wizard({ onDone, start = 0, team, rail }: { onDone: () => void; start?: number; team?: TeamStep; rail?: RailStep }) {
  const [step, setStep] = useState(start);
  const wallet = useWallet();
  // "Meet the Floor Desk" abre Privy directamente; la pagina de sign in (paso 1) queda solo
  // para quien llega por "sign in again". Al conectar, sigue al paso del LLM.
  const [wantsIn, setWantsIn] = useState(false);
  useEffect(() => {
    if (step !== 0 || !wallet.connected || wallet.busy) return;
    if (wantsIn) { setWantsIn(false); setStep(2); return; }
    // En la bienvenida el usuario esta desconectado por definicion (FloorApp arranca
    // en el paso 2 o 3 cuando hay sesion). Si Privy reporta sesion aqui es una sesion
    // vieja que el logout no llego a cerrar: se cierra ahora, sin que el usuario haga nada.
    flog("warn", "welcome: a stale wallet session survived the logout, closing it");
    void wallet.logout();
  }, [step, wantsIn, wallet.connected, wallet.busy, wallet]);
  const meet = () => {
    setWantsIn(true);
    wallet.open();
  };
  if (step === 0) {
    return (
      <div className="wizard">
        {/* El fondo ambiental va solo (su hijo .logo-3d mide 0 x 0); el hero es hermano, a pantalla completa.
            Hero como el del sitio perkos.xyz: titular grande con "first team." en degradado,
            Sparky de cuerpo entero a la derecha, CTA en pill. Nada hace scroll. */}
        <Ambient cine>{null}</Ambient>
        <section className="hero ident" aria-label="Welcome">
            <div className="hero-copy">
              <img className="hero-mark" src="/logo-name.png" alt="PerkOS" />
              {/* Copy propio del Floor Desk, el unico desk del app hoy. El eslogan del sitio
                  ("Your business just hired its first team") volvera a tener sentido cuando
                  el app ofrezca varios desks para elegir. */}
              <h1 className="hero-title">They draft.<br /><span>You approve.</span></h1>
              <p className="hero-sub">PerkOS Floor Desk puts four agents on tokenized stocks on Base. Scout reads the market, Risk says go or block, Trader drafts the order, Auditor checks it. Nothing moves until you sign in your own wallet.</p>
              <div className="hero-cta">
                <button className="hero-primary" type="button" disabled={!wallet.enabled || wallet.busy} onClick={meet}>{wallet.busy ? "Opening…" : "Meet the Floor Desk"} <span aria-hidden>&rarr;</span></button>
              </div>
              {!wallet.enabled ? <p className="hint-line err">Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local</p> : null}
              {wallet.error ? <p className="hint-line err">{wallet.error}</p> : null}
              <ul className="hero-checks">
                {["Your keys, your trade", "Uniswap, Aerodrome and Bankr", "Launches and automations", "Ready in two minutes"].map((t) => (
                  <li key={t}><svg viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{t}</li>
                ))}
              </ul>
            </div>
            <div className="hero-stage" aria-hidden>
              <div className="hero-glow" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="hero-sparky" src="/sparky-full.png" alt="" />
            </div>
        </section>
      </div>
    );
  }
  return <Auth step={step} setStep={setStep} onDone={onDone} team={team} rail={rail} />;
}

type Llm = { provider: string; model: string; connected: boolean };

const PROVIDERS: Array<{ id: string; label: string; sub: string; soon?: boolean }> = [
  { id: "xai-oauth", label: "xAI · Grok", sub: "Sign in with your SuperGrok / Premium+ subscription" },
  { id: "openai", label: "OpenAI", sub: "API key", soon: true },
  { id: "anthropic", label: "Anthropic", sub: "API key", soon: true },
  { id: "local", label: "Local", sub: "Ollama / LM Studio", soon: true }
];

function Auth({ step, setStep, onDone, team, rail }: { step: number; setStep: (n: number) => void; onDone: () => void; team?: TeamStep; rail?: RailStep }) {
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
        {step === 4 && rail ? <RailCard rail={rail} /> : null}
      </Ambient>
    </div>
  );
}

/** Paso 4: rail de gasto. El Trader solo gasta a traves de 1Claw (limites,
 *  allowlist, aprobacion humana) y la persona reclama su vault en el browser.
 *  Opcional: se puede entrar sin rail y volver desde la orb del Trader. */
function RailCard({ rail }: { rail: RailStep }) {
  const [email, setEmail] = useState<string>(() => {
    try { return localStorage.getItem("perkos.rail.email") ?? localStorage.getItem("floor.rail.email") ?? ""; } catch { return ""; }
  });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Provisioned is enough: the API links the credential and reprovisions the
  // container, which also wakes an agent the curator put to sleep.
  const traderReady = rail.traderState === "ready" || rail.traderState === "hibernated" || rail.traderState === "waking";
  const traderLine = rail.traderState === "ready" ? "ready on PerkOS" : rail.traderState === "hibernated" ? "asleep on PerkOS · wakes when linked" : rail.traderState === "waking" ? "waking…" : rail.traderState === "provisioning" ? "provisioning… link is enabled when it is ready" : rail.traderState || "not created";
  const link = () => {
    try { localStorage.setItem("perkos.rail.email", email.trim()); } catch {}
    rail.onLink(email.trim());
  };
  return (
    <div className="wizard-card team rail">
      <div className="k">SPEND RAIL</div>
      <b>The Trader spends only through 1Claw.</b>
      <p className="lead">
        Limits, allowlists and your approval, enforced outside the model. Above ${rail.lockUsd} every spend waits for you.
      </p>
      <ul className="providers team-roles">
        <li className={`provider${traderReady ? " on" : ""}`}>
          <div className="provider-head">
            <span className="provider-name">{rail.traderName || "Trader"}</span>
            <span className={`tag${traderReady ? " ok" : ""}`}>{rail.traderState === "hibernated" ? "Asleep" : traderReady ? "Ready" : "Deploying"}</span>
          </div>
          <small>Trader · {traderLine}</small>
        </li>
        <li className={`provider${rail.status === "linked" ? " on" : ""}`}>
          <div className="provider-head">
            <span className="provider-name"><img className="rail-mark" src="/1claw.svg" alt="" />1Claw</span>
            {rail.status === "linked" ? <span className="tag ok">Linked</span> : rail.status === "claim_pending" ? <span className="tag">Claim pending</span> : null}
          </div>
          <small>
            {rail.status === "linked"
              ? "Your vault and the Trader's credential are in place."
              : rail.status === "claim_pending"
                ? "Finish claiming your vault at 1Claw. This step completes on its own once you do."
                : rail.status === "not_configured"
                  ? "Not enabled on this PerkOS yet."
                  : "You get your own vault at 1Claw; the Trader gets a credential that can only act within it."}
          </small>
        </li>
      </ul>

      {rail.status === "not_connected" || rail.status === "unknown" ? (
        <label>
          <span>Your email (for your 1Claw account)</span>
          <input type="email" value={email} placeholder="you@company.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : null}
      {rail.note ? <p className={`hint-line${/fail|could not|error/i.test(rail.note) ? " err" : ""}`}>{rail.note}</p> : null}

      <div className="row">
        {rail.status === "claim_pending" ? (
          <button type="button" className="cta" onClick={rail.onOpenClaim}>Open 1Claw again</button>
        ) : rail.status === "linked" ? (
          <button type="button" className="cta" onClick={rail.onSkip}>Enter Floor</button>
        ) : (
          <button type="button" className="cta" disabled={!traderReady || !validEmail || rail.busy || rail.status === "not_configured"} onClick={link}>
            {rail.busy ? "Linking…" : "Link 1Claw"}
          </button>
        )}
      </div>
      <p className="hint-line">
        {rail.status === "claim_pending"
          ? "Waiting for the claim in your browser…"
          : "Opens 1Claw in your browser to claim the vault. The key never touches this Mac."}
      </p>
      {rail.status !== "linked" ? (
        <button type="button" className="back" onClick={rail.onSkip}>Enter Floor without a spend rail</button>
      ) : null}
    </div>
  );
}

/** Paso 3: elegir el equipo. Una card por template fleet de PerkOS (hoy una);
 *  la elegida muestra sus roles y el boton de deploy bajo la cuenta del usuario. */
function TeamCard({ team }: { team: TeamStep }) {
  const { name, onName, desks, desk, deskNote, perkosConnected, perkosBusy, perkosNote, fundingUrl, paying, deploying } = team;
  const ready = perkosConnected && !!desk;
  return (
    <div className="wizard-card team">
      <div className="k">YOUR DESK</div>
      <b>{desks.length > 1 ? "Choose a desk." : "Your first desk."}</b>
      <p className="lead">A desk brings its team, its chain and its screens. The team runs on PerkOS infrastructure under your account. They draft; you approve.</p>

      {perkosConnected && desks.length ? (
        <label className="desk-name">
          <span>Name this desk</span>
          <input
            value={name}
            onChange={(e) => onName(e.target.value.slice(0, 120))}
            placeholder={desk?.name ?? "My desk"}
            aria-label="Name this desk"
            spellCheck={false}
          />
          <small>Yours to rename later. It is the project name on PerkOS.</small>
        </label>
      ) : null}

      {!perkosConnected ? (
        <p className="hint-line">
          {perkosBusy ? "Connecting your PerkOS account… approve the signature in your wallet." : perkosNote || "PerkOS account not connected."}
        </p>
      ) : null}
      {perkosConnected && !desks.length && deskNote ? <p className="hint-line err">{deskNote}</p> : null}

      {desks.length ? <div className="k sub">Built from</div> : null}
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

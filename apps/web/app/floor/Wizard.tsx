"use client";

import { useEffect, useState } from "react";
import Ambient from "./Ambient";
import XaiConnect from "./XaiConnect";
import { useWallet } from "./wallet/context";
import { flog } from "./log";
import { ChainMark, chainOf } from "./ChainMark";

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
  /** Abierto a mano ("+ Add a desk" o el catalogo) teniendo ya un desk: hay sitio al
   *  que volver, asi que la salida es volver, no "entrar sin equipo". */
  adding: boolean;
  /** Cierra el paso sin tocar el estado de la flota. Solo se pinta con `adding`. */
  onCancel?: () => void;
  /** Por que no se puede montar otro desk de esta plantilla con esta wallet, si es el caso. */
  blocked?: string;
  /** El AI de la persona, el que usa Sparky: se dice antes de montar y se puede cambiar. */
  ai?: string;
  onChangeAi?: () => void;
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
    // Con el LLM listo se sale del wizard: FloorApp abre el catalogo de desks si
    // todavia no hay ninguno. Montar un desk se elige alli, no se impone aqui.
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
  // Un reclamo puede quedarse a medias: el vault existe pero la API ya no devuelve
  // su URL. Antes "Open 1Claw again" abria undefined, o sea nada, y sin decirlo.
  // Sin URL no hay nada que reabrir: se acuna uno nuevo.
  const stale = rail.status === "claim_pending" && !rail.claimUrl;
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
                ? stale
                  ? "The claim from the last attempt is no longer open. Link again and 1Claw gives you a new one."
                  : "Finish claiming your vault at 1Claw. This step completes on its own once you do."
                : rail.status === "not_configured"
                  ? "Not enabled on this PerkOS yet."
                  : "You get your own vault at 1Claw; the Trader gets a credential that can only act within it."}
          </small>
        </li>
      </ul>

      {rail.status === "not_connected" || rail.status === "unknown" || stale ? (
        <label>
          <span>Your email (for your 1Claw account)</span>
          <input type="email" value={email} placeholder="you@company.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : null}
      {rail.note ? <p className={`hint-line${/fail|could not|error/i.test(rail.note) ? " err" : ""}`}>{rail.note}</p> : null}

      <div className="row">
        {stale ? (
          <button type="button" className="cta" disabled={!traderReady || !validEmail || rail.busy} onClick={link}>
            {rail.busy ? "Linking…" : "Link 1Claw again"}
          </button>
        ) : rail.status === "claim_pending" ? (
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
        {stale
          ? "Nothing to reopen: that claim is gone. Linking again mints a fresh one."
          : rail.status === "claim_pending"
            ? "Waiting for the claim in your browser…"
            : "Opens 1Claw in your browser to claim the vault. The key never touches this Mac."}
      </p>
      {rail.status !== "linked" ? (
        <button type="button" className="back" onClick={rail.onSkip}>Enter Floor without a spend rail</button>
      ) : null}
    </div>
  );
}

/** true cuando han pasado `ms` desde que se monto. Para no ensenar una espera que no
 *  llega a existir: si la sesion de PerkOS sigue viva la respuesta tarda un parpadeo y
 *  una tarjeta que aparece y desaparece en 300 ms se lee como un fallo. */
function useElapsed(ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return on;
}

/** Lo que PerkOS hace, en la espera. Firmar puede tardar 20 s: en vez de un spinner,
 *  la espera cuenta el producto. Cada lamina es una frase, no un parrafo. */
const WAIT_SLIDES: Array<{ k: string; t: string; d: string }> = [
  // El orden lo fija que la espera son 15 a 25 s: se ven 3 o 4 laminas, no 6. Las tres
  // primeras cuentan el producto entero; el resto es premio para una firma lenta o para
  // la sala del demo, donde la banda gira en bucle. Arco: control, equipo, precios,
  // creacion, permanencia, propiedad. Abre y cierra en la wallet.
  { k: "YOUR CALL", t: "They draft. You approve.", d: "Every order stays a draft until you hold to approve it, and it is signed with your own wallet." },
  { k: "THE TEAM", t: "Four agents, one job each.", d: "Scout finds opportunities, Risk sets limits, Trader drafts the orders, and Auditor reconciles what happened against what was asked." },
  { k: "PRICE CHECK", t: "Every price is checked twice.", d: "Routes come from Uniswap and Aerodrome on Base, and a second quote from Bankr checks them before a draft." },
  { k: "NEW TOKEN", t: "Launch a token from one sentence.", d: "A name, symbol, description and an AI logo become a live pool, with the trading fees paid to your wallet." },
  { k: "ON REPEAT", t: "Recurring buys, limits and stops.", d: "You approve the rule once, then it runs on a schedule or a trigger while the team hibernates between tasks." },
  { k: "YOUR RECORD", t: "Your history stays on your machine.", d: "Notes, a knowledge map and the full history stay local, encrypted by your wallet, and open in Obsidian." }
];

function WaitSlides() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % WAIT_SLIDES.length), 5200);
    return () => window.clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <section className="ws-band" aria-label="What the desk does" aria-live="off">
      {/* Marco fijo: no cambia de sitio ni de tamano al rotar. */}
      <header className="ws-head">
        <span className="k">WHAT THE DESK DOES</span>
        <span className="ws-count">{pad(i + 1)} / {pad(WAIT_SLIDES.length)}</span>
      </header>

      {/* Las seis laminas se apilan en la misma caja de alto fijo. */}
      <div className="ws-stack">
        {WAIT_SLIDES.map((s, n) => (
          <article key={s.k} className={`ws-slide${n === i ? " on" : ""}`} aria-hidden={n !== i}>
            <span className="k">{s.k}</span>
            <b>{s.t}</b>
            <p>{s.d}</p>
          </article>
        ))}
      </div>

      {/* El <i> solo existe en el tramo activo: al cambiar el indice se monta de
          nuevo y la animacion de relleno arranca de cero, sin timers extra. */}
      <div className="ws-rail" aria-hidden="true">
        {WAIT_SLIDES.map((s, n) => (
          <span key={s.k} className={`ws-seg${n < i ? " done" : ""}${n === i ? " now" : ""}`}>
            {n === i ? <i key={i} /> : null}
          </span>
        ))}
      </div>
    </section>
  );
}

/** Paso 3: nombrar y montar el desk. La decision real es el nombre; el template
 *  y el roster son contexto y van mas chicos. Con 2 a 4 templates el catalogo es
 *  un carrusel horizontal (como el deck de DesksHome), no una grilla. `adding`
 *  distingue "+ Add a desk" (ya hay un desk, se puede volver) del primer
 *  arranque (no hay adonde volver todavia). */
function TeamCard({ team }: { team: TeamStep }) {
  const {
    name, onName, desks, desk, deskNote,
    perkosConnected, perkosBusy, perkosNote,
    fundingUrl, paying, deploying, adding, blocked, ai, onChangeAi
  } = team;
  // La espera solo se pinta si de verdad hay espera, y las laminas mas tarde todavia:
  // con sesion viva esto dura un parpadeo y no debe verse nada.
  const waitingSeen = useElapsed(700);
  const slidesSeen = useElapsed(1600);
  const ready = perkosConnected && !!desk && !blocked;
  const heading = desks.length > 1 ? "Choose a desk." : adding ? "Add a desk." : "Your first desk.";

  // Mientras la sesion de PerkOS se firma y llegan las plantillas no se sabe si esta
  // persona ya tiene desk, asi que no se puede pedir que monte uno. Antes se pintaba
  // el formulario entero como sala de espera y se reemplazaba solo: eso desconcierta.
  if (!perkosConnected || !desks.length) {
    if (!waitingSeen) return null;
    const wait = perkosConnected
      ? { k: "YOUR ACCOUNT", t: "Reading your desks.", d: deskNote || "One moment: asking PerkOS which desks you run." }
      : perkosBusy
        ? { k: "YOUR ACCOUNT", t: "Connecting your account.", d: "Approve the signature in your wallet. It only proves the wallet is yours; nothing is spent." }
        : { k: "YOUR ACCOUNT", t: "PerkOS account not connected.", d: perkosNote || "The signature was not completed." };
    return (
      <div className="wizard-card team desk-setup waiting">
        <header className="ds-head">
          <div className="ds-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-name.png" alt="PerkOS" />
            <span className="k">{wait.k}</span>
          </div>
        </header>
        <div className="ds-intro">
          <b>{wait.t}</b>
          <p className="lead">{wait.d}</p>
        </div>
        {/* La espera cuenta lo que hace PerkOS; solo mientras de verdad se espera. */}
        {slidesSeen && (perkosConnected || perkosBusy) ? <WaitSlides /> : null}
        {!perkosConnected && !perkosBusy ? (
          <footer className="ds-foot">
            <div className="row">
              <button type="button" className="cta" onClick={team.onReconnect}>Connect PerkOS</button>
            </div>
            <button type="button" className="back" onClick={team.onSkip}>Enter Floor without a team</button>
          </footer>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wizard-card team desk-setup">
      <header className="ds-head">
        <div className="ds-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-name.png" alt="PerkOS" />
          <span className="k">{adding ? "NEW DESK" : "YOUR DESK"}</span>
        </div>
        {adding && team.onCancel ? (
          <button type="button" className="ds-back" onClick={team.onCancel}>Back to desks</button>
        ) : null}
      </header>

      <div className="ds-intro">
        <b>{heading}</b>
        <p className="lead">A desk brings its team, its chain and its screens, running on PerkOS infrastructure under your account.</p>
      </div>

      <div className="ds-body">
        <section className="ds-naming">
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
          {perkosConnected && desks.length ? (
            <p className="ds-ai">
              <span className="k">RUNS ON YOUR AI</span>
              <b>{ai || "No AI connected"}</b>
              {onChangeAi ? <button type="button" onClick={onChangeAi}>Change</button> : null}
            </p>
          ) : null}
          {!perkosConnected ? (
            <p className="hint-line">
              {perkosBusy ? "Connecting your PerkOS account… approve the signature in your wallet." : perkosNote || "PerkOS account not connected."}
            </p>
          ) : null}
          {perkosConnected && !desks.length && deskNote ? <p className="hint-line err">{deskNote}</p> : null}
        </section>

        {desks.length ? (
          <>
            <i className="ds-split" aria-hidden="true" />
            <section className="ds-template">
              <div className="k sub">BUILT FROM</div>
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
                      <header className="desk-card-head">
                        <span className="k">PERKOS TEMPLATE</span>
                        <ChainMark chain={chainOf(d)} small />
                      </header>
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

              {desk ? (
                <details className="desk-roster">
                  <summary>Meet the team <small>· {desk.agents.length} agents</small></summary>
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
                </details>
              ) : null}
            </section>
          </>
        ) : null}
      </div>

      <footer className="ds-foot">
        {blocked ? <p className="hint-line warn">{blocked}</p> : null}
        <div className="row">
          {!perkosConnected && !perkosBusy ? (
            <button type="button" className="cta" onClick={team.onReconnect}>Connect PerkOS</button>
          ) : fundingUrl ? (
            <button type="button" className="cta" disabled={paying} onClick={team.onPay}>
              {paying ? "Waiting for payment…" : "Activate PerkOS infrastructure"}
            </button>
          ) : (
            <button type="button" className="cta" disabled={!ready || deploying} onClick={team.onDeploy}>
              {deploying ? "Deploying…" : "Deploy on PerkOS"}
            </button>
          )}
        </div>
        <p className="hint-line">
          {fundingUrl
            ? "Opens pay.perkos.xyz in your browser. Card, USDC on Base, or a code. The team deploys as soon as the balance is positive."
            : "Runs under your account · they draft, you approve."}
        </p>
        {!adding ? (
          <button type="button" className="back" onClick={team.onSkip}>Enter Floor without a team</button>
        ) : null}
      </footer>
    </div>
  );
}

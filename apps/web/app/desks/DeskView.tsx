"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { useSparkyChat } from "../chat/useSparkyChat";
import { openMemory } from "../memory/open";
import { AppHeader } from "../shell/AppHeader";
import { wakeAction } from "../team/look";
import { TeamRow } from "../team/TeamRow";
import { useTeam } from "../team/useTeam";
import { useTalk } from "../voice/useTalk";
import { CHAIN_LABEL, chainOf } from "./chains";
import type { Desk } from "./DesksScreen";
import { Embers } from "./Embers";
import { MarketSheet } from "./MarketSheet";
import { TraderSheet } from "./TraderSheet";
import { coreState, DEFAULT_STARTERS, isAnswering, whisper } from "./stage";
import { useDeskManifest } from "./useDeskManifest";

/**
 * An open desk as a scene: Sparky at the center, by voice or by text. The
 * conversation opens to the left once it starts, and the desk's market slides
 * in from the right. What the desk says about itself comes from its manifest.
 */
export function DeskView({
  desk,
  onBack,
  onLogout,
  onSettings
}: {
  desk: Desk;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onSettings: () => void;
}) {
  const chain = chainOf(desk.module);
  const chat = useSparkyChat({ desk: desk.id });
  const [market, setMarket] = useState(false);
  const closeMarket = useCallback(() => setMarket(false), []);
  const [trader, setTrader] = useState(false);
  const closeTrader = useCallback(() => setTrader(false), []);
  const { voice, talk } = useTalk(chat);
  const manifest = useDeskManifest(desk.module);
  const team = useTeam(desk.id);
  const waking = wakeAction(team.team?.status, team.busy);
  const [draft, setDraft] = useState("");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/voice")
      .then((res) => (res.ok ? (res.json() as Promise<{ stt: string }>) : { stt: "none" }))
      .then((cfg) => setVoiceReady(cfg.stt !== "none"))
      .catch(() => setVoiceReady(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  const state = coreState(voice.status, chat.busy, isAnswering(chat.busy, chat.messages));
  const split = chat.messages.length > 0;
  const working = chat.busy || voice.status === "speaking";
  const starters = manifest?.starters.length ? manifest.starters : DEFAULT_STARTERS;

  /** Sparky answers out loud when voice works here, and in text either way. */
  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setDraft("");
    if (voiceReady) talk(t);
    else void chat.send(t);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function stop() {
    voice.stopAll();
    chat.abort();
  }

  return (
    <main className={`stage ${chain}${split ? " split" : ""}${market || trader ? " panel" : ""}`}>
      <div className="st-ambient" aria-hidden>
        <i className="st-blob" />
        <Embers />
      </div>
      <AppHeader
        section={desk.name}
        onLogout={onLogout}
        onSettings={onSettings}
        onHome={onBack}
        actions={
          <>
            {desk.module ? (
              <button type="button" className="ah-out" aria-pressed={market} onClick={() => setMarket((v) => !v)}>
                Market
              </button>
            ) : null}
            {desk.module && manifest?.screens.includes("trader") ? (
              <button
                type="button"
                className="ah-out"
                aria-pressed={trader}
                onClick={() => {
                  setMarket(false);
                  setTrader((v) => !v);
                }}
              >
                Trader
              </button>
            ) : null}
            <button type="button" className="ah-out" onClick={() => openMemory({ scope: desk.id, name: desk.name })}>
              Memory
            </button>
            <button
              type="button"
              className={`ah-out ah-wake ${team.team?.status ?? "reading"}`}
              disabled={!waking.enabled}
              title="Wakes the desk's team on PerkOS. Desk time runs while they are awake."
              onClick={() => void team.wake()}
            >
              {waking.label}
            </button>
            <button type="button" className="ah-out" onClick={onBack}>
              Dashboard
            </button>
          </>
        }
      />
      <div className="st-area">
        <header className="st-id">
          <span className="kicker">Desk</span>
          <h1>{desk.name}</h1>
          {chain !== "neutral" ? <span className={`chain-badge ${chain}`}>{CHAIN_LABEL[chain]}</span> : null}
          {manifest?.tagline ? <small className="st-tagline">{manifest.tagline}</small> : null}
          {team.error ? <small className="st-note">{team.error}</small> : null}
        </header>

        <TeamRow team={team.team} />

        <div className="st-core-wrap">
          <button
            type="button"
            className={`st-core ${state}`}
            aria-label={voiceReady ? (state === "listening" ? "Stop listening" : "Talk to Sparky") : "Ask Sparky"}
            title={voiceReady === false ? "Voice needs Grok. Sign in with Grok in Settings." : "Talk to Sparky"}
            onClick={() => (voiceReady ? voice.toggleTalk() : inputRef.current?.focus())}
          >
            <i className="st-eye l" />
            <i className="st-eye r" />
          </button>
          <p className="st-whisper" aria-live="polite">
            {whisper(state)}
          </p>
          {!split ? <p className="st-hello">You are in {desk.name}. Ask me anything about it, or tap me to talk.</p> : null}
        </div>

        {split ? (
          <section className="st-convo" aria-label="Conversation with Sparky">
            {chat.messages.map((m, i) => (
              <div key={i} className={`st-turn ${m.role}`}>
                <span className="st-who">{m.role === "user" ? "You" : "Sparky"}</span>
                <p>
                  {m.content ||
                    (chat.busy && i === chat.messages.length - 1 ? (
                      <span className="st-typing" aria-label="Sparky is writing">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null)}
                </p>
              </div>
            ))}
            {chat.error ? <p className="hint err">{chat.error}</p> : null}
            <div ref={endRef} />
          </section>
        ) : (
          <div className="st-starters" aria-label="Suggested questions">
            {starters.map((s, i) => (
              <button key={s.text} type="button" style={{ "--i": i } as CSSProperties} onClick={() => send(s.text)}>
                {s.text}
                <small>{s.tag}</small>
              </button>
            ))}
          </div>
        )}

        <form className="st-ask" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Sparky. Nothing spends until you approve."
            aria-label="Ask Sparky"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={`st-ask-btn${voice.status === "listening" ? " listening" : ""}`}
            aria-label={voice.status === "listening" ? "Stop listening" : "Speak"}
            title={voiceReady === false ? "Voice needs Grok. Sign in with Grok in Settings." : voice.status === "listening" ? "Stop listening" : "Speak"}
            disabled={voiceReady === false}
            onClick={voice.toggleTalk}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`st-ask-btn${voice.continuous ? " on" : ""}`}
            aria-pressed={voice.continuous}
            aria-label="Live conversation"
            title="Live conversation: Sparky listens again after every reply"
            disabled={voiceReady === false}
            onClick={() => voice.setContinuous(!voice.continuous)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`st-ask-btn${voice.muted ? " on" : ""}`}
            aria-pressed={voice.muted}
            aria-label={voice.muted ? "Unmute Sparky" : "Mute Sparky"}
            title={voice.muted ? "Unmute Sparky" : "Mute Sparky"}
            onClick={() => voice.setMuted(!voice.muted)}
          >
            {voice.muted ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {working ? (
            <button type="button" className="st-ask-btn send" aria-label="Stop" title="Stop" onClick={stop}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button type="submit" className="st-ask-btn send" aria-label="Send" disabled={!draft.trim()}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {market && desk.module ? <MarketSheet title={desk.name} module={desk.module} chain={chain} onAsk={send} onClose={closeMarket} /> : null}
      {trader && !market && desk.module ? <TraderSheet title={desk.name} module={desk.module} chain={chain} onClose={closeTrader} /> : null}
    </main>
  );
}

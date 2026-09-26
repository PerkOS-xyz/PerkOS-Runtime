"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { coreState, isAnswering, whisper } from "../desks/stage";
import { openMemory } from "../memory/open";
import { useVault } from "../shell/useVault";
import { useTalk } from "../voice/useTalk";
import { useWallet } from "../wallet/context";
import { MemoryBanner } from "./MemoryBanner";
import { useSparkyChat } from "./useSparkyChat";

type Phase = "closed" | "opening" | "open" | "closing";

const OPEN_MS = 720;
const CLOSE_MS = 460;

/** Before any desk there is no team yet: these are about finding the right one. */
const STARTERS = [
  { text: "Which desk fits what I want to do?", tag: "Sparky points the way" },
  { text: "What can a desk do for me?", tag: "A team, a market, its screens" },
  { text: "What will never happen without me?", tag: "They draft. You approve." },
  { text: "What do you remember about me?", tag: "Encrypted with your wallet" }
];

/**
 * Sparky before any desk. The bubble in the corner opens a scene where he is
 * the only one there: the screen steps back, his head comes from the corner
 * to the center, and the talk runs by voice or by text. Closing sends him
 * back to the corner; the conversation stays for the next time.
 */
export function SparkyScene({ model, onOpenChange }: { model: string | null; onOpenChange?: (open: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [origin, setOrigin] = useState({ x: 0, y: 0, dx: 0, dy: 0 });
  const [draft, setDraft] = useState("");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const chat = useSparkyChat();
  const { voice, talk } = useTalk(chat);
  const vault = useVault(useWallet());
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  const shown = phase !== "closed";

  useEffect(() => {
    if (!shown || voiceReady !== null) return;
    fetch("/api/voice")
      .then((res) => (res.ok ? (res.json() as Promise<{ stt: string }>) : { stt: "none" }))
      .then((cfg) => setVoiceReady(cfg.stt !== "none"))
      .catch(() => setVoiceReady(false));
  }, [shown, voiceReady]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = useCallback(() => {
    // The scene grows out of the bubble, and his head flies from there to the center.
    const box = launcherRef.current?.getBoundingClientRect();
    const x = box ? box.left + box.width / 2 : window.innerWidth - 56;
    const y = box ? box.top + box.height / 2 : window.innerHeight - 56;
    setOrigin({ x, y, dx: x - window.innerWidth / 2, dy: y - window.innerHeight * 0.465 });
    setPhase("opening");
    onOpenChange?.(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPhase("open");
      inputRef.current?.focus();
    }, OPEN_MS);
  }, [onOpenChange]);

  const close = useCallback(() => {
    // Nothing keeps listening once he is back in the corner.
    voice.setContinuous(false);
    voice.stopAll();
    setPhase("closing");
    onOpenChange?.(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("closed"), CLOSE_MS);
  }, [voice, onOpenChange]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, close]);

  const state = coreState(voice.status, chat.busy, isAnswering(chat.busy, chat.messages));
  const split = chat.messages.length > 0;
  const working = chat.busy || voice.status === "speaking";
  const noVoice = voiceReady === false ? "Voice needs Grok. Sign in with Grok in Settings." : "";

  /** He answers out loud when voice works here, and in text either way. */
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

  const vars = { "--ox": `${origin.x}px`, "--oy": `${origin.y}px`, "--dx": `${origin.dx}px`, "--dy": `${origin.dy}px` } as CSSProperties;

  return (
    <>
      <div className={`bubble${shown ? " away" : ""}${voice.continuous ? " live" : ""}`}>
        <button ref={launcherRef} type="button" className="bubble-button" aria-label="Talk with Sparky" aria-expanded={shown} onClick={open}>
          <img src="/sparky.png" alt="" width={46} height={46} />
          <span className="bubble-tip">Talk with Sparky</span>
        </button>
      </div>

      {shown ? (
        <div className={`stage sparky-scene ${phase}${split ? " split" : ""}`} style={vars} role="dialog" aria-modal="true" aria-label="Sparky">
          <div className="st-ambient" aria-hidden>
            <i className="st-blob" />
          </div>

          <header className="ss-top">
            <div className="ss-title">
              <span className="kicker">Sparky</span>
              <b>Before any desk, it is just the two of us.</b>
              {model ? <small>{model}</small> : null}
            </div>
            <div className="ss-actions">
              {vault.unlocked ? (
                <button type="button" className="ah-out" onClick={() => openMemory()}>
                  Memory
                </button>
              ) : null}
              <button type="button" className="ss-close" aria-label="Close the chat" title="Close (Esc)" onClick={close}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          <div className="st-area">
            <div className="ss-memory">
              <MemoryBanner vault={vault} />
            </div>

            <div className="st-core-wrap">
              <div className="ss-halo">
                <i className="ss-ring outer" aria-hidden />
                <i className="ss-ring inner" aria-hidden />
                <button
                  type="button"
                  className={`st-core ${state}`}
                  aria-label={voiceReady ? (state === "listening" ? "Stop listening" : "Talk to Sparky") : "Ask Sparky"}
                  title={noVoice || "Talk to Sparky"}
                  onClick={() => (voiceReady ? voice.toggleTalk() : inputRef.current?.focus())}
                >
                  <i className="st-eye l" />
                  <i className="st-eye r" />
                </button>
              </div>
              <p className="st-whisper" aria-live="polite">
                {whisper(state)}
              </p>
              {!split ? <p className="st-hello">Hi! Ask me anything, or tell me what you want to get done and I will point you to the right desk.</p> : null}
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
                {STARTERS.map((s, i) => (
                  <button key={s.text} type="button" style={{ "--i": i } as CSSProperties} onClick={() => send(s.text)}>
                    {s.text}
                    <small>{s.tag}</small>
                  </button>
                ))}
              </div>
            )}

            {voice.error ? <p className="hint err ss-err">{voice.error}</p> : null}

            <form className="st-ask" onSubmit={submit}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask Sparky, or tap him to talk."
                aria-label="Ask Sparky"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className={`st-ask-btn${voice.status === "listening" ? " listening" : ""}`}
                aria-label={voice.status === "listening" ? "Stop listening" : "Speak"}
                title={noVoice || (voice.status === "listening" ? "Stop listening" : "Speak")}
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
                title={noVoice || "Live conversation: Sparky listens again after every reply"}
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
        </div>
      ) : null}
    </>
  );
}

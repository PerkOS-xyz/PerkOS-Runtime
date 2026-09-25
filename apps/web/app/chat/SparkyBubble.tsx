"use client";

import { useEffect, useRef, useState } from "react";

import { SentenceSplitter } from "../voice/sentences";
import { useVoice, type VoiceStatus } from "../voice/useVoice";
import { SparkyChat } from "./SparkyChat";
import { useSparkyChat } from "./useSparkyChat";

const STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: "",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking…"
};

/**
 * Sparky in the corner: a bubble that opens a compact chat, by text or voice.
 * Live keeps the conversation going: Sparky listens again after every reply.
 * The conversation stays while the panel is closed.
 */
export function SparkyBubble({ model }: { model: string | null }) {
  const [open, setOpen] = useState(false);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const chat = useSparkyChat();
  const splitter = useRef(new SentenceSplitter());

  const voice = useVoice({
    onTranscript: (text) => talk(text),
    onInterrupt: () => chat.abort()
  });

  /** Sends a message and speaks the reply sentence by sentence as it streams. */
  function talk(text: string) {
    splitter.current = new SentenceSplitter();
    voice.beginTurn();
    void chat.send(text, {
      onPiece: (piece) => splitter.current.push(piece).forEach(voice.speak),
      onEnd: () => {
        splitter.current.flush().forEach(voice.speak);
        voice.endTurn();
      }
    });
  }

  useEffect(() => {
    if (!open || voiceReady !== null) return;
    fetch("/api/voice")
      .then((res) => (res.ok ? (res.json() as Promise<{ stt: string }>) : { stt: "none" }))
      .then((cfg) => setVoiceReady(cfg.stt !== "none"))
      .catch(() => setVoiceReady(false));
  }, [open, voiceReady]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const live = voice.continuous;
  const status = voice.status;
  const noVoice = voiceReady === false ? "Voice needs Grok. Sign in with Grok in Settings." : "";

  const mic = (
    <button
      type="button"
      className={`mic-btn ${status}`}
      aria-label={status === "listening" ? "Stop listening" : "Speak to Sparky"}
      title={noVoice || (status === "listening" ? "Stop listening" : "Speak to Sparky")}
      disabled={voiceReady === false}
      onClick={voice.toggleTalk}
    >
      {status === "listening" ? (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );

  return (
    <div className={`bubble${open ? " open" : ""}${live ? " live" : ""}`}>
      <section className="bubble-panel" aria-label="Chat with Sparky" aria-hidden={!open}>
        <header>
          <span className={`sp-avatar ${status}`} aria-hidden>
            <img src="/sparky.png" alt="" width={34} height={34} />
          </span>
          <div className="sp-title">
            <b>Sparky</b>
            <small aria-live="polite">{STATUS_TEXT[status] || model || ""}</small>
          </div>
          {status === "speaking" ? (
            <span className="eq" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <div className="sp-controls">
            <button
              type="button"
              className={`sp-toggle${live ? " on" : ""}`}
              aria-pressed={live}
              title={noVoice || "Live conversation: Sparky listens again after every reply"}
              disabled={voiceReady === false}
              onClick={() => voice.setContinuous(!live)}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Live
            </button>
            <button
              type="button"
              className={`sp-icon${voice.muted ? " on" : ""}`}
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
            <button type="button" className="bubble-close" aria-label="Close" onClick={() => setOpen(false)}>
              &times;
            </button>
          </div>
        </header>
        {live ? (
          <div className="live-bar" role="status">
            <span className="live-dot" aria-hidden />
            Live conversation: talk anytime.
            <button type="button" className="link-btn" onClick={() => voice.setContinuous(false)}>
              Stop
            </button>
          </div>
        ) : null}
        {voice.error ? <p className="hint err live-err">{voice.error}</p> : null}
        <SparkyChat chat={chat} compact mic={mic} onSend={(text) => (live ? talk(text) : void chat.send(text))} />
      </section>
      <button
        type="button"
        className="bubble-button"
        aria-label={open ? "Close the chat with Sparky" : "Ask Sparky"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <img src="/sparky.png" alt="" width={46} height={46} />
        {!open ? <span className="bubble-tip">{live ? "Live: Sparky is listening" : "Ask Sparky"}</span> : null}
      </button>
    </div>
  );
}

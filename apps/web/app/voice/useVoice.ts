"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice for Sparky, as an explicit state machine:
 *
 *   idle -> listening -> transcribing -> thinking -> speaking -> idle
 *
 * - One owner of the microphone: the stream opens once per session and the
 *   recorder is armed and disarmed on it; it is not reopened between turns.
 * - Every transition checks the current status; nothing is armed otherwise.
 * - One timer, cleared before the next one is armed.
 * - Barge-in: while Sparky thinks or speaks the level monitor keeps running;
 *   if the person speaks, everything stops and capture starts from there.
 * - Speech-to-text and text-to-speech go through /api/voice; if text-to-speech
 *   is refused, the system voice is used. Mute turns off speech only.
 */

export type VoiceStatus = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

type Options = {
  /** A transcript is ready: send it to the chat. */
  onTranscript: (text: string) => void;
  /** Barge-in or stop: abort the reply in progress. */
  onInterrupt: () => void;
};

const SILENCE_LEVEL = 0.03; // RMS; speech measures around 0.16-0.26, room noise around 0.005
const SILENCE_MS = 1250;
const IDLE_SILENCE_MS = 12_000;
const TURN_TIMEOUT_MS = 60_000;
const BARGE_MS = 350;
const MIN_AUDIO_BYTES = 2000;
const MUTE_KEY = "runtime.tts.muted";

export function useVoice({ onTranscript, onInterrupt }: Options) {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [continuous, setContinuousState] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [error, setError] = useState("");

  const statusRef = useRef<VoiceStatus>("idle");
  const continuousRef = useRef(false);
  const mutedRef = useRef(muted);
  const turnRef = useRef(0);
  const timerRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const rafRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playResolveRef = useRef<(() => void) | null>(null);
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const chatDoneRef = useRef(true);
  const systemVoiceRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onInterruptRef = useRef(onInterrupt);
  onTranscriptRef.current = onTranscript;
  onInterruptRef.current = onInterrupt;

  const setStatus = useCallback((s: VoiceStatus) => {
    if (statusRef.current === s) return;
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  }, []);
  const arm = useCallback(
    (ms: number, fn: () => void) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = 0;
        fn();
      }, ms);
    },
    [clearTimer]
  );

  // ---------- shared microphone ----------
  const openMic = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      mimeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      setError("");
      return true;
    } catch {
      setError("The microphone is not available. Allow it in your system settings.");
      return false;
    }
  }, []);

  const closeMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.stop();
    }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    analyserRef.current = null;
  }, []);

  const rms = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }, []);

  // ---------- speech ----------
  const stopPlayback = useCallback(() => {
    queueRef.current = [];
    audioRef.current?.pause();
    playResolveRef.current?.();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speakSystem = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 1.02;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      }),
    []
  );

  const fetchSpeech = useCallback(async (text: string): Promise<Blob | null> => {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    }).catch(() => null);
    if (!res || !res.ok) return null;
    return res.blob();
  }, []);

  const playBlob = useCallback(
    (blob: Blob) =>
      new Promise<void>((resolve) => {
        const url = URL.createObjectURL(blob);
        const done = () => {
          URL.revokeObjectURL(url);
          playResolveRef.current = null;
          resolve();
        };
        const audio = new Audio(url);
        audioRef.current = audio;
        playResolveRef.current = done;
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      }),
    []
  );

  const settleRef = useRef<() => void>(() => undefined);
  const listenRef = useRef<() => Promise<void>>(async () => undefined);
  const bargeRef = useRef<() => void>(() => undefined);

  // Plays the queue of the current turn, fetching sentence N+1 while N plays.
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const turn = turnRef.current;
    const inflight: Array<{ text: string; audio: Promise<Blob | null> }> = [];
    const fill = () => {
      while (inflight.length < 2 && queueRef.current.length && turnRef.current === turn) {
        const text = queueRef.current.shift()!;
        inflight.push({ text, audio: systemVoiceRef.current ? Promise.resolve(null) : fetchSpeech(text) });
      }
    };
    try {
      fill();
      while (inflight.length && turnRef.current === turn) {
        const current = inflight.shift()!;
        const blob = await current.audio;
        fill();
        if (turnRef.current !== turn) break;
        if (statusRef.current === "thinking") setStatus("speaking");
        bargeRef.current();
        if (blob) await playBlob(blob);
        else {
          systemVoiceRef.current = true;
          await speakSystem(current.text);
        }
        fill();
      }
    } finally {
      drainingRef.current = false;
      if (turnRef.current === turn && chatDoneRef.current && !queueRef.current.length) settleRef.current();
    }
  }, [fetchSpeech, playBlob, setStatus, speakSystem]);

  /** The chat calls this for every complete sentence of the reply. */
  const speak = useCallback(
    (sentence: string) => {
      const s = sentence.trim();
      if (!s || mutedRef.current) return;
      queueRef.current.push(s);
      void drain();
    },
    [drain]
  );

  /** The chat calls this when a reply starts. */
  const beginTurn = useCallback(() => {
    turnRef.current += 1;
    chatDoneRef.current = false;
    queueRef.current = [];
    clearTimer();
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
      recRef.current = null;
      cancelAnimationFrame(rafRef.current);
    }
    setStatus("thinking");
    bargeRef.current();
  }, [clearTimer, setStatus]);

  /** The chat calls this when the reply has finished streaming, with or without an error. */
  const endTurn = useCallback(() => {
    chatDoneRef.current = true;
    if (!drainingRef.current && !queueRef.current.length) settleRef.current();
  }, []);

  // ---------- capturing one turn ----------
  const stopCapture = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  }, []);

  const startCapture = useCallback(
    (source: "turn" | "barge") => {
      const stream = streamRef.current;
      if (!stream) return;
      if (recRef.current && recRef.current.state === "recording") return;
      const rec = new MediaRecorder(stream, { mimeType: mimeRef.current });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        recRef.current = null;
        clearTimer();
        if (blob.size < MIN_AUDIO_BYTES) {
          setStatus("idle");
          settleRef.current();
          return;
        }
        setStatus("transcribing");
        const form = new FormData();
        form.set("file", blob, "audio.webm");
        form.set("language", navigator.language ? navigator.language.slice(0, 2) : "en");
        let text = "";
        try {
          const res = await fetch("/api/voice/stt", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as { text?: string; message?: string };
          if (res.ok) text = String(body.text ?? "").trim();
          else setError(body.message ?? "Could not transcribe the audio.");
        } catch {
          setError("Could not transcribe the audio.");
        }
        if (statusRef.current !== "transcribing") return;
        if (!text) {
          setStatus("idle");
          settleRef.current();
          return;
        }
        onTranscriptRef.current(text);
      };
      rec.start(250);
      setStatus("listening");

      // End of turn: SILENCE_MS of silence after speech; nothing heard in
      // IDLE_SILENCE_MS; never longer than TURN_TIMEOUT_MS.
      const started = Date.now();
      let heard = source === "barge";
      let lastVoice = started;
      arm(TURN_TIMEOUT_MS, stopCapture);
      const tick = () => {
        if (recRef.current !== rec || rec.state !== "recording") return;
        const level = rms();
        const now = Date.now();
        if (level > SILENCE_LEVEL) {
          heard = true;
          lastVoice = now;
        }
        if (heard && now - lastVoice > SILENCE_MS) return stopCapture();
        if (!heard && now - started > IDLE_SILENCE_MS) return stopCapture();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [arm, clearTimer, rms, setStatus, stopCapture]
  );

  // ---------- barge-in while Sparky thinks or speaks ----------
  bargeRef.current = () => {
    if (!continuousRef.current || !streamRef.current) return;
    if (recRef.current && recRef.current.state === "recording") return;
    cancelAnimationFrame(rafRef.current);
    let voiceSince = 0;
    const tick = () => {
      const st = statusRef.current;
      if (st !== "thinking" && st !== "speaking") return;
      if (recRef.current && recRef.current.state === "recording") return;
      const now = Date.now();
      if (rms() > SILENCE_LEVEL * 2) {
        if (!voiceSince) voiceSince = now;
      } else voiceSince = 0;
      if (voiceSince && now - voiceSince > BARGE_MS) {
        turnRef.current += 1;
        chatDoneRef.current = true;
        stopPlayback();
        onInterruptRef.current();
        startCapture("barge");
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // ---------- end of a reply ----------
  settleRef.current = () => {
    if (statusRef.current === "listening" || statusRef.current === "transcribing") return;
    setStatus("idle");
    if (continuousRef.current) arm(250, () => void listenRef.current());
  };

  listenRef.current = async () => {
    if (statusRef.current !== "idle") return;
    if (!(await openMic())) {
      continuousRef.current = false;
      setContinuousState(false);
      return;
    }
    if (statusRef.current !== "idle") return;
    startCapture("turn");
  };

  // ---------- public API ----------
  /** Tap the mic: listen for one message, or stop listening, or talk over Sparky. */
  const toggleTalk = useCallback(() => {
    const st = statusRef.current;
    if (st === "listening") {
      if (continuousRef.current) {
        continuousRef.current = false;
        setContinuousState(false);
      }
      stopCapture();
      return;
    }
    if (st === "thinking" || st === "speaking") {
      turnRef.current += 1;
      chatDoneRef.current = true;
      stopPlayback();
      onInterruptRef.current();
      setStatus("idle");
    }
    void listenRef.current();
  }, [setStatus, stopCapture, stopPlayback]);

  /** Continuous conversation: listen again after every reply. */
  const setContinuous = useCallback(
    (on: boolean) => {
      continuousRef.current = on;
      setContinuousState(on);
      if (on) {
        if (statusRef.current === "idle") void listenRef.current();
      } else if (statusRef.current === "listening") stopCapture();
    },
    [stopCapture]
  );

  const setMuted = useCallback(
    (on: boolean) => {
      mutedRef.current = on;
      setMutedState(on);
      try {
        localStorage.setItem(MUTE_KEY, on ? "1" : "0");
      } catch {
        // Private storage may be unavailable; the setting then lasts for the session.
      }
      if (on && statusRef.current === "speaking") {
        turnRef.current += 1;
        stopPlayback();
        settleRef.current();
      }
    },
    [stopPlayback]
  );

  /** Stop everything: speech, the reply and listening, and release the microphone. */
  const stopAll = useCallback(() => {
    clearTimer();
    turnRef.current += 1;
    chatDoneRef.current = true;
    stopPlayback();
    onInterruptRef.current();
    continuousRef.current = false;
    setContinuousState(false);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
      recRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setStatus("idle");
    closeMic();
  }, [clearTimer, closeMic, setStatus, stopPlayback]);

  useEffect(
    () => () => {
      clearTimer();
      stopPlayback();
      closeMic();
    },
    [clearTimer, closeMic, stopPlayback]
  );

  return { status, continuous, muted, error, toggleTalk, setContinuous, setMuted, speak, beginTurn, endTurn, stopAll };
}

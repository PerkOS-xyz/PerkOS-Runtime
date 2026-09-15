"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flog } from "./log";

// Voz de Floor: maquina de estados explicita, como Hermes Desktop
// (apps/desktop/src/app/chat/composer/hooks/use-voice-conversation.ts).
//
//   idle -> listening -> transcribing -> thinking -> speaking -> idle
//
// Reglas que importan (todas aprendidas de Hermes):
//  - Un solo dueno del microfono: el stream se abre una vez por sesion continua
//    y el MediaRecorder se arma/desarma sobre el; nunca se reabre entre turnos.
//  - Toda transicion chequea statusRef; nada se arma si el estado no lo permite.
//  - Un solo timer (timerRef) y se limpia ANTES de armar el siguiente: un timer
//    viejo disparando en un listen nuevo es lo que "cuelga" el loop.
//  - Barge-in de turno completo: mientras piensa o habla, el monitor sigue
//    oyendo; si el usuario habla, corta todo y captura desde ese instante.
//  - STT y TTS con la cuenta xAI del usuario via /api/voice/*; si xAI rechaza
//    TTS, speechSynthesis. Mute apaga solo el TTS.

export type VoiceStatus = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

type Opts = {
  onTranscript: (text: string) => void;   // texto listo -> chat
  onInterrupt: () => void;                 // barge-in / stop: abortar el chat en curso
  onStatus?: (s: VoiceStatus) => void;
};

// VAD (espeja tools.voice_mode de Hermes): nivel, fin de frase, sin voz.
const SILENCE_LEVEL = 0.03;      // RMS; hablando medimos 0.16-0.26, ruido ~0.005
const SILENCE_MS = 1250;
const IDLE_SILENCE_MS = 12_000;
const TURN_TIMEOUT_MS = 60_000;
const BARGE_MS = 350;            // voz sostenida para interrumpir al asistente
const MIN_AUDIO_BYTES = 2000;

export function useVoice({ onTranscript, onInterrupt, onStatus }: Opts) {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [continuous, setContinuousState] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => {
    try { return localStorage.getItem("floor.tts.muted") === "1"; } catch { return false; }
  });

  const statusRef = useRef<VoiceStatus>("idle");
  const continuousRef = useRef(false);
  const mutedRef = useRef(muted);
  const turnRef = useRef(0);                 // id del turno del asistente en curso
  const timerRef = useRef(0);                // el unico timer del loop
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
  const chatDoneRef = useRef(true);          // el chat ya termino de streamear
  const ttsFallbackRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onInterruptRef = useRef(onInterrupt);
  onTranscriptRef.current = onTranscript;
  onInterruptRef.current = onInterrupt;

  const setStatus = useCallback((s: VoiceStatus) => {
    if (statusRef.current === s) return;
    flog("info", `voice: ${statusRef.current} -> ${s}`);
    statusRef.current = s;
    setStatusState(s);
    onStatus?.(s);
  }, [onStatus]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = 0; }
  }, []);
  const arm = useCallback((ms: number, fn: () => void) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => { timerRef.current = 0; fn(); }, ms);
  }, [clearTimer]);

  // ---------- microfono compartido ----------
  const openMic = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      ctxRef.current = ctx;
      analyserRef.current = an;
      mimeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      flog("info", "mic: open");
      return true;
    } catch (e) {
      flog("error", `mic: ${(e as Error).message}`);
      return false;
    }
  }, []);

  const closeMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { rec.ondataavailable = null; rec.onstop = null; rec.stop(); }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    analyserRef.current = null;
    flog("info", "mic: closed");
  }, []);

  const rms = useCallback((): number => {
    const an = analyserRef.current;
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }, []);

  // ---------- TTS ----------
  const stopPlayback = useCallback(() => {
    queueRef.current = [];
    audioRef.current?.pause();
    playResolveRef.current?.();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speakSystem = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  }), []);

  const fetchXai = useCallback(async (text: string): Promise<Blob | null> => {
    const t0 = Date.now();
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      flog(res.status === 403 ? "warn" : "error", `tts xai ${res.status}: ${j.detail || j.error || ""} -> system voice`);
      return null;
    }
    const blob = await res.blob();
    flog("info", `tts xai ok ${Date.now() - t0} ms · ${Math.round(blob.size / 1024)} KB · "${text.slice(0, 40)}"`);
    return blob;
  }, []);

  const playBlob = useCallback((blob: Blob) => new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob);
    const done = () => { URL.revokeObjectURL(url); playResolveRef.current = null; resolve(); };
    const a = new Audio(url);
    audioRef.current = a;
    playResolveRef.current = done;
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  }), []);

  // Declaradas abajo (dependen entre si): settle <-> listen.
  const settleRef = useRef<() => void>(() => undefined);
  const listenRef = useRef<() => Promise<void>>(async () => undefined);
  const bargeRef = useRef<() => void>(() => undefined);

  // Drena la cola del turno actual con prefetch (N+1 se pide mientras suena N).
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const turn = turnRef.current;
    const inflight: Array<{ text: string; p: Promise<Blob | null> }> = [];
    const fill = () => {
      while (inflight.length < 2 && queueRef.current.length && turnRef.current === turn) {
        const text = queueRef.current.shift()!;
        inflight.push({ text, p: ttsFallbackRef.current ? Promise.resolve(null) : fetchXai(text) });
      }
    };
    try {
      fill();
      while (inflight.length && turnRef.current === turn) {
        const cur = inflight.shift()!;
        const blob = await cur.p;
        fill();
        if (turnRef.current !== turn) break;
        if (statusRef.current === "thinking") setStatus("speaking");
        bargeRef.current(); // el monitor sigue vivo mientras suena
        if (blob) await playBlob(blob);
        else { ttsFallbackRef.current = true; await speakSystem(cur.text); }
        fill();
      }
    } finally {
      drainingRef.current = false;
      if (turnRef.current === turn && chatDoneRef.current && !queueRef.current.length) settleRef.current();
    }
  }, [fetchXai, playBlob, setStatus, speakSystem]);

  /** El chat llama esto por cada oracion completa del stream. */
  const speak = useCallback((sentence: string) => {
    const s = sentence.trim();
    if (!s) return;
    if (mutedRef.current) return;
    queueRef.current.push(s);
    void drain();
  }, [drain]);

  /** El chat llama esto al empezar un turno del asistente (tras el transcript). */
  const beginTurn = useCallback(() => {
    turnRef.current += 1;
    chatDoneRef.current = false;
    queueRef.current = [];
    clearTimer();
    // Si el usuario tecleo mientras escuchabamos, ese audio ya no es un turno.
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); recRef.current = null; cancelAnimationFrame(rafRef.current); }
    setStatus("thinking");
    bargeRef.current(); // barge-in armado desde el submit, como Hermes
  }, [clearTimer, setStatus]);

  /** El chat llama esto cuando termino de streamear (con o sin error). */
  const endTurn = useCallback(() => {
    chatDoneRef.current = true;
    if (!drainingRef.current && !queueRef.current.length) settleRef.current();
  }, []);

  // ---------- captura de un turno del usuario ----------
  const stopCapture = useCallback((reason: string) => {
    cancelAnimationFrame(rafRef.current);
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    flog("info", `mic: stop (${reason})`);
    rec.stop(); // dispara onstop -> transcribe
  }, []);

  const startCapture = useCallback((source: "turn" | "barge") => {
    const stream = streamRef.current;
    if (!stream) return;
    if (recRef.current && recRef.current.state === "recording") return;
    const rec = new MediaRecorder(stream, { mimeType: mimeRef.current });
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      chunksRef.current = [];
      recRef.current = null;
      clearTimer();
      if (blob.size < MIN_AUDIO_BYTES) {
        flog("info", "stt: nothing heard");
        setStatus("idle");
        settleRef.current();
        return;
      }
      setStatus("transcribing");
      const form = new FormData();
      form.set("file", blob, "audio.webm");
      form.set("language", "en");
      flog("info", `stt -> ${Math.round(blob.size / 1024)} KB`);
      let text = "";
      try {
        const res = await fetch("/api/voice/stt", { method: "POST", body: form });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) flog("error", `stt ${res.status}: ${j.detail || j.error || ""}`);
        else text = String(j.text || "").trim();
      } catch (e) {
        flog("error", `stt: ${(e as Error).message}`);
      }
      if (statusRef.current !== "transcribing") return; // alguien cambio el estado mientras tanto
      flog("info", `stt <- ${text || "(empty)"}`);
      if (!text) { setStatus("idle"); settleRef.current(); return; }
      // beginTurn() pone "thinking"; lo llama el chat via onTranscript.
      onTranscriptRef.current(text);
    };
    rec.start(250);
    setStatus("listening");
    flog("info", `mic: recording (${source})`);

    // VAD del turno: corta tras SILENCE_MS de silencio despues de oir voz;
    // sin voz en IDLE_SILENCE_MS, cierra; nunca mas de TURN_TIMEOUT_MS.
    const started = Date.now();
    let heard = source === "barge";
    let lastVoice = started;
    let peak = 0;
    arm(TURN_TIMEOUT_MS, () => stopCapture("turn timeout"));
    const tick = () => {
      if (recRef.current !== rec || rec.state !== "recording") return;
      const level = rms();
      if (level > peak) peak = level;
      const now = Date.now();
      if (level > SILENCE_LEVEL) { heard = true; lastVoice = now; }
      if (heard && now - lastVoice > SILENCE_MS) { stopCapture(`silence after speech · peak ${peak.toFixed(3)}`); return; }
      if (!heard && now - started > IDLE_SILENCE_MS) { stopCapture(`no speech · peak ${peak.toFixed(3)}`); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [arm, clearTimer, rms, setStatus, stopCapture]);

  // ---------- barge-in: oir al usuario mientras el asistente piensa/habla ----------
  bargeRef.current = () => {
    if (!continuousRef.current || !streamRef.current) return;
    if (recRef.current && recRef.current.state === "recording") return;
    cancelAnimationFrame(rafRef.current);
    let voiceSince = 0;
    const tick = () => {
      const st = statusRef.current;
      if (st !== "thinking" && st !== "speaking") return;
      if (recRef.current && recRef.current.state === "recording") return;
      const level = rms();
      const now = Date.now();
      if (level > SILENCE_LEVEL * 2) { if (!voiceSince) voiceSince = now; }
      else voiceSince = 0;
      if (voiceSince && now - voiceSince > BARGE_MS) {
        flog("info", `barge-in (level ${level.toFixed(3)})`);
        turnRef.current += 1;      // invalida el drain en curso
        chatDoneRef.current = true;
        stopPlayback();
        onInterruptRef.current();  // aborta el chat
        startCapture("barge");
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // ---------- fin de turno del asistente ----------
  settleRef.current = () => {
    if (statusRef.current === "listening" || statusRef.current === "transcribing") return;
    setStatus("idle");
    if (continuousRef.current) {
      flog("info", "continuous: listen again");
      arm(250, () => void listenRef.current());
    }
  };

  // ---------- escuchar un turno ----------
  listenRef.current = async () => {
    if (statusRef.current !== "idle") { flog("warn", `listen refused: status ${statusRef.current}`); return; }
    if (!(await openMic())) { continuousRef.current = false; setContinuousState(false); return; }
    if (statusRef.current !== "idle") return; // cambio mientras abriamos el mic
    startCapture("turn");
  };

  // ---------- API publica ----------
  const toggleTalk = useCallback(() => {
    const st = statusRef.current;
    if (st === "listening") { stopCapture("user"); return; }
    if (st === "thinking" || st === "speaking") {
      // Hablar encima con el boton: mismo efecto que el barge-in por voz.
      turnRef.current += 1;
      chatDoneRef.current = true;
      stopPlayback();
      onInterruptRef.current();
      setStatus("idle");
    }
    void listenRef.current();
  }, [setStatus, stopCapture, stopPlayback]);

  const setContinuous = useCallback((v: boolean) => {
    continuousRef.current = v;
    setContinuousState(v);
    flog("info", `continuous conversation ${v ? "on" : "off"}`);
    if (v) { if (statusRef.current === "idle") void listenRef.current(); }
    else if (statusRef.current === "listening") stopCapture("continuous off");
  }, [stopCapture]);

  const setMuted = useCallback((v: boolean) => {
    mutedRef.current = v;
    setMutedState(v);
    try { localStorage.setItem("floor.tts.muted", v ? "1" : "0"); } catch {}
    if (v && statusRef.current === "speaking") { turnRef.current += 1; stopPlayback(); settleRef.current(); }
    flog("info", `tts ${v ? "muted" : "on"}`);
  }, [stopPlayback]);

  /** Stop total (boton stop / comando stop): corta voz, chat y escucha. */
  const stopAll = useCallback(() => {
    clearTimer();
    turnRef.current += 1;
    chatDoneRef.current = true;
    stopPlayback();
    onInterruptRef.current();
    continuousRef.current = false;
    setContinuousState(false);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); recRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    setStatus("idle");
    closeMic();
  }, [clearTimer, closeMic, setStatus, stopPlayback]);

  /** Corta solo la voz/chat en curso (p.ej. el usuario mando texto nuevo). */
  const interrupt = useCallback(() => {
    turnRef.current += 1;
    chatDoneRef.current = true;
    stopPlayback();
    if (statusRef.current === "speaking" || statusRef.current === "thinking") settleRef.current();
  }, [stopPlayback]);

  useEffect(() => () => { clearTimer(); stopPlayback(); closeMic(); }, [clearTimer, closeMic, stopPlayback]);

  return { status, muted, setMuted, continuous, setContinuous, toggleTalk, speak, beginTurn, endTurn, interrupt, stopAll };
}

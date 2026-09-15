"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseCommand } from "./parseCommand";
import SettingsPanel from "./SettingsPanel";
import Wizard from "./Wizard";
import Ambient from "./Ambient";
import ErrorDock from "./ErrorDock";
import Providers from "./wallet/Providers";
import { useWallet } from "./wallet/context";
import { flog } from "./log";
import { useVoice } from "./useVoice";

// Vive lo que vive el modulo (no el componente): un remount no debe volver a
// pedir la firma del nonce a la wallet despues de un timeout o un rechazo.
let perkosDeclined = false;

type Team = "hibernated" | "waking" | "ready";

export default function FloorApp() {
  return (
    <Providers>
      <Shell />
    </Providers>
  );
}

function Shell() {
  const wallet = useWallet();
  const [listening, setListening] = useState(false);
  const [team, setTeam] = useState<Team>("hibernated");
  const [guest, setGuest] = useState(false);
  const [docs, setDocs] = useState(false);
  const [market, setMarket] = useState(false);
  // El prompt "Hey PerkOS" vive bajo el microfono (.whisper). Esta linea es solo
  // el transcript de lo hablado o tecleado, asi que arranca vacia.
  const [caption, setCaption] = useState("");
  const [splash, setSplash] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [wizardStart, setWizardStart] = useState(0);
  const [booted, setBooted] = useState(false);
  const [settings, setSettings] = useState(false);
  // Panel de debug (derecha). Oculto por defecto; persiste; Settings o Cmd/Ctrl+Shift+D.
  const [debug, setDebugState] = useState<boolean>(() => {
    try { return localStorage.getItem("floor.debug.open") === "1"; } catch { return false; }
  });
  const setDebug = useCallback((v: boolean) => {
    setDebugState(v);
    try { localStorage.setItem("floor.debug.open", v ? "1" : "0"); } catch {}
  }, []);
  const [who, setWho] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("grok-4.6");
  const [effort, setEffort] = useState<"low" | "medium" | "high">("low");
  // Split: al primer envio la esfera va a la derecha y el transcript ocupa la izquierda.
  type Msg = { id: number; role: "you" | "floor" | "team"; who?: string; text: string; streaming?: boolean };
  // Sesion PerkOS (firma del nonce con la wallet Privy) + flota Hermes en PerkOS infra.
  type FleetAgent = { role: "scout" | "risk" | "trader" | "auditor"; name: string; agentId?: string; state: "planned" | "provisioning" | "waking" | "ready" | "hibernated" | "failed"; detail?: string };
  type Fleet = { status: "none" | "provisioning" | "waking" | "ready" | "partial" | "hibernated"; agents: FleetAgent[] };
  // Espejo de DeskTemplate (app/lib/fleet.ts) sin importar codigo server-only.
  type DeskTemplate = { id: string; revision: number; name: string; description: string; idleMinutes: number; agents: Array<{ role: string; name: string; duty: string }> };
  const [perkos, setPerkos] = useState<{ connected: boolean; busy: boolean; fundingUrl: string; note: string }>({ connected: false, busy: false, fundingUrl: "", note: "" });
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const fleetRef = useRef<Fleet | null>(null);
  fleetRef.current = fleet;
  const perkosRef = useRef(perkos);
  perkosRef.current = perkos;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [split, setSplit] = useState(false);
  const idleTimer = useRef<number>(0);
  const voiceRef = useRef<{ continuous: boolean; listening: boolean } | null>(null);
  const touchRef = useRef<() => void>(() => undefined);
  const touch = useCallback(() => {
    setSplit(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      // En conversacion continua o hablando, la charla sigue viva: no volver a idle.
      if (voiceRef.current?.continuous || voiceRef.current?.listening) { touchRef.current(); return; }
      setSplit(false);
    }, 120_000);
  }, []);
  const askRef = useRef<HTMLInputElement | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const runRef = useRef<(t: string) => void>(() => undefined);

  // Voz con la cuenta del usuario (STT/TTS xAI, fallback a voces del sistema).
  // Maquina de estados (idle/listening/transcribing/thinking/speaking), como
  // Hermes Desktop. El chat avisa beginTurn/endTurn; la voz avisa onInterrupt
  // (barge-in) para abortar el stream en curso.
  const abortChat = useCallback(() => {
    chatAbort.current?.abort();
    chatAbort.current = null;
    setThinking(false);
    setStreaming(false);
  }, []);
  const voice = useVoice({
    onTranscript: (t) => runRef.current(t),
    onInterrupt: abortChat,
    onStatus: (s) => {
      setListening(s === "listening");
      setSpeaking(s === "speaking");
    }
  });
  const { speak, beginTurn, endTurn } = voice;
  voiceRef.current = { continuous: voice.continuous, listening: voice.status === "listening" };
  touchRef.current = touch;

  // Stop del composer / comando stop: corta chat, voz y escucha, y apaga el
  // continuo. Antes usaba interrupt(), cuyo settle() volvia a abrir el mic.
  const hush = useCallback(() => {
    abortChat();
    voice.stopAll();
  }, [abortChat, voice]);

  // Conversacion: POST /api/chat (Responses API via suscripcion de Grok),
  // SSE de deltas -> caption en vivo + se habla oracion por oracion.
  const chat = useCallback(async (text: string) => {
    abortChat();
    beginTurn();
    const ac = new AbortController();
    chatAbort.current = ac;
    setThinking(true);
    setStreaming(true);
    setCaption("");
    touch();
    const youId = Date.now();
    const floorId = youId + 1;
    setMessages((m) => [...m.slice(-40), { id: youId, role: "you", text }, { id: floorId, role: "floor", text: "", streaming: true }]);
    const setFloor = (t: string, streaming: boolean) =>
      setMessages((m) => m.map((x) => (x.id === floorId ? { ...x, text: t, streaming } : x)));
    flog("info", `chat -> ${text.slice(0, 80)}`);
    let full = "";
    let pending = "";
    try {
      // Con la flota despierta, primero responden los agentes (Hermes en PerkOS
      // infra) y Grok, la voz del Floor, resume. Sin flota: Grok solo.
      let fleetReplies: Array<{ role: string; ok: boolean; reply: string; detail?: string }> = [];
      const f = fleetRef.current;
      const readyRoles = f ? f.agents.filter((a) => a.state === "ready").map((a) => a.role) : [];
      if (readyRoles.length && teamRef.current !== "hibernated") {
        setCaption("Asking the desk…");
        const t1 = Date.now();
        const fr = await fetch("/api/fleet/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, roles: readyRoles }),
          signal: ac.signal
        });
        const fj = (await fr.json().catch(() => ({}))) as { replies?: typeof fleetReplies; error?: string; detail?: string };
        if (fr.ok && fj.replies) {
          fleetReplies = fj.replies;
          flog("info", `fleet: ${fleetReplies.filter((r) => r.ok).length}/${fleetReplies.length} answered · ${Date.now() - t1} ms`);
          for (const r of fleetReplies) {
            if (!r.ok) flog("warn", `fleet ${r.role}: ${r.detail || "no answer"}`);
          }
          const teamId = youId + 2;
          const lines = fleetReplies.filter((r) => r.ok && r.reply);
          if (lines.length) {
            setMessages((m) => [...m.filter((x) => x.id !== floorId), { id: teamId, role: "team", who: lines.map((r) => r.role).join(" · "), text: lines.map((r) => `${cap(r.role)}: ${r.reply}`).join("\n\n") }, { id: floorId, role: "floor", text: "", streaming: true }]);
          }
        } else {
          flog("warn", `fleet ask ${fr.status}: ${fj.error ?? ""} ${fj.detail ?? ""}`);
        }
        setCaption("");
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fleet: fleetReplies }),
        signal: ac.signal
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        const msg = j.error === "llm_not_connected" ? "Connect your LLM in Settings." : `${j.error ?? `HTTP ${res.status}`}${j.detail ? ` — ${j.detail}` : ""}`;
        setFloor(msg, false);
        flog("error", `chat ${res.status}: ${msg}`);
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf2 = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf2 += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf2.indexOf("\n\n")) >= 0) {
          const line = buf2.slice(0, idx).replace(/^data:\s*/, "");
          buf2 = buf2.slice(idx + 2);
          if (!line) continue;
          let ev: { delta?: string; done?: boolean; error?: string; info?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.info) flog("info", `chat: ${ev.info}`);
          if (ev.error) { setFloor(ev.error, false); throw new Error(ev.error); }
          if (typeof ev.delta === "string") {
            full += ev.delta;
            pending += ev.delta;
            setThinking(false);
            setFloor(full, true);
            touch();
            // Habla por oraciones completas, pero junta las muy cortas: cada
            // request a xAI cuesta ~1 s, y "Si." solo no vale un request.
            for (;;) {
              const m = pending.match(/^([\s\S]*?[.!?])(\s+|$)/);
              if (!m) break;
              const chunk = m[1].trim();
              if (chunk.length < 60 && pending.length > m[0].length + 1 && !/[.!?]\s*$/.test(pending.trim().slice(0, -1))) {
                // hay mas texto detras: esperar a que cierre la siguiente oracion
                const rest = pending.slice(m[0].length);
                const m2 = rest.match(/^([\s\S]*?[.!?])(\s+|$)/);
                if (!m2) break;
                speak(`${chunk} ${m2[1].trim()}`);
                pending = rest.slice(m2[0].length);
                continue;
              }
              if (chunk.length < 12) break;
              speak(chunk);
              pending = pending.slice(m[0].length);
            }
          }
        }
      }
      if (pending.trim()) speak(pending);
      setFloor(full, false);
      flog("info", `chat <- ${full.length} chars`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") flog("error", `chat: ${(e as Error).message}`);
      setMessages((m) => m.map((x) => (x.id === floorId ? { ...x, streaming: false } : x)));
    } finally {
      setThinking(false);
      setStreaming(false);
      if (chatAbort.current === ac) chatAbort.current = null;
      endTurn();
    }
  }, [abortChat, beginTurn, endTurn, speak, touch]);

  const teamRef = useRef<Team>("hibernated");
  teamRef.current = team;
  const pollRef = useRef(0);

  const applyFleet = useCallback((f: Fleet) => {
    setFleet(f);
    const ready = f.agents.filter((a) => a.state === "ready").length;
    flog("info", `fleet: ${f.status} · ${f.agents.map((a) => `${a.role}=${a.state}`).join(" ")}`);
    if (f.status === "ready") { setTeam("ready"); setCaption(`Team is up · ${ready}/4 on PerkOS`); }
    else if (f.status === "hibernated" || f.status === "none") { if (teamRef.current === "waking") setTeam("hibernated"); }
    // Mientras provisiona/despierta, seguir mirando.
    window.clearTimeout(pollRef.current);
    if (f.status === "provisioning" || f.status === "waking" || (f.status === "partial" && f.agents.some((a) => a.state === "provisioning" || a.state === "waking"))) {
      pollRef.current = window.setTimeout(() => void fleetAction("status"), 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Card del template (nombre, agentes, duty). La API la publica desde Admin;
  // sin ella el desk no se puede desplegar y la card lo dice.
  const [desk, setDesk] = useState<DeskTemplate | null>(null);
  const [deskNote, setDeskNote] = useState("");
  const loadDesk = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/template?lang=${encodeURIComponent((navigator.language || "en").slice(0, 2))}`);
      const j = (await res.json().catch(() => ({}))) as DeskTemplate & { error?: string; detail?: string };
      if (!res.ok) {
        setDesk(null);
        setDeskNote(res.status === 404 ? "Team template not published yet" : j.detail || j.error || "template unavailable");
        flog(res.status === 404 ? "warn" : "error", `desk template ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        return;
      }
      setDesk(j);
      setDeskNote("");
      flog("info", `desk template: ${j.id} r${j.revision} · ${j.agents.length} agents`);
    } catch (e) {
      flog("error", `desk template: ${(e as Error).message}`);
    }
  }, []);

  const fleetAction = useCallback(async (action: "status" | "wake" | "hibernate") => {
    try {
      const res = action === "status"
        ? await fetch("/api/fleet")
        : await fetch("/api/fleet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = (await res.json().catch(() => ({}))) as Fleet & { error?: string; detail?: string };
      if (!res.ok) {
        if (res.status === 402) { setPerkos((p) => ({ ...p, fundingUrl: "https://perkos.xyz" })); setCaption("Activate PerkOS infrastructure to run the team"); }
        if (res.status === 404) setCaption("Team template not published yet");
        flog(res.status === 402 ? "warn" : "error", `fleet ${action} ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        if (action === "wake") setTeam("hibernated");
        return;
      }
      applyFleet(j);
      if (action === "hibernate") setTeam("hibernated");
    } catch (e) {
      flog("error", `fleet ${action}: ${(e as Error).message}`);
    }
  }, [applyFleet]);

  // Sesion PerkOS: reutiliza la guardada para esta wallet o firma el nonce.
  const ensurePerkos = useCallback(async (force = false) => {
    const addr = wallet.address;
    if (!addr) return;
    setPerkos((p) => ({ ...p, busy: true, note: "" }));
    try {
      if (!force) {
        const cur = (await fetch(`/api/perkos/session?wallet=${encodeURIComponent(addr)}`).then((r) => r.json())) as { connected?: boolean; configured?: boolean };
        if (cur.configured === false) { flog("warn", "perkos: session not available on this build"); setPerkos({ connected: false, busy: false, fundingUrl: "", note: "not configured" }); return; }
        if (cur.connected) { flog("info", "perkos: session ok"); setPerkos({ connected: true, busy: false, fundingUrl: "", note: "" }); void loadDesk(); void fleetAction("status"); return; }
        // La firma automatica se pide una sola vez: tras un timeout o un rechazo
        // en la wallet, cada montaje volvia a mandar un pedido a MetaMask.
        if (perkosDeclined) { flog("info", "perkos: sign-in skipped (declined earlier · Settings > Reconnect)"); setPerkos({ connected: false, busy: false, fundingUrl: "", note: "Reconnect to sign in" }); return; }
      } else {
        perkosDeclined = false;
      }
      const n = await fetch(`/api/perkos/nonce?address=${encodeURIComponent(addr)}`);
      const nj = (await n.json().catch(() => ({}))) as { nonce?: string; message?: string; error?: string; detail?: string };
      if (!n.ok || !nj.nonce || !nj.message) { flog("error", `perkos nonce ${n.status}: ${nj.error ?? ""} ${nj.detail ?? ""}`); setPerkos({ connected: false, busy: false, fundingUrl: "", note: nj.detail || nj.error || "nonce failed" }); return; }
      flog("info", "perkos: signing nonce with your wallet");
      const signature = await wallet.signMessage(nj.message);
      const r = await fetch("/api/perkos/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, nonce: nj.nonce, signature, chainId: 8453 })
      });
      const rj = (await r.json().catch(() => ({}))) as { connected?: boolean; error?: string; detail?: string; url?: string };
      if (r.status === 402) {
        flog("warn", `perkos: infra not active for this wallet (${rj.detail ?? ""})`);
        setPerkos({ connected: false, busy: false, fundingUrl: rj.url || "https://perkos.xyz", note: "Activate PerkOS infrastructure" });
        setCaption("Activate PerkOS infrastructure at perkos.xyz to run your team");
        return;
      }
      if (!r.ok) { flog("error", `perkos signin ${r.status}: ${rj.error ?? ""} ${rj.detail ?? ""}`); setPerkos({ connected: false, busy: false, fundingUrl: "", note: rj.detail || rj.error || "sign-in failed" }); return; }
      flog("info", "perkos: signed in");
      setPerkos({ connected: true, busy: false, fundingUrl: "", note: "" });
      void loadDesk();
      void fleetAction("status");
    } catch (e) {
      perkosDeclined = true;
      flog("error", `perkos: ${(e as Error).message}`);
      setPerkos({ connected: false, busy: false, fundingUrl: "", note: (e as Error).message });
    }
  }, [wallet, fleetAction, loadDesk]);
  const ensurePerkosRef = useRef(ensurePerkos);
  ensurePerkosRef.current = ensurePerkos;

  const run = useCallback((raw: string) => {
    const spoken = raw.trim();
    const cmd = parseCommand(raw);
    // Todo lo que no es un comando del canvas es conversacion.
    if (cmd === "unknown" && spoken) {
      void chat(spoken);
      return;
    }
    if (spoken) setCaption(spoken);
    if (cmd === "listen") setListening(true);
    if (cmd === "wake") {
      setListening(true);
      setTeam("waking");
      if (perkosRef.current.connected) {
        setCaption("Waking the team on PerkOS…");
        void fleetAction("wake");
      } else {
        // Sin sesion PerkOS la flota es solo escena.
        window.setTimeout(() => setTeam("ready"), 700);
        setCaption(perkosRef.current.fundingUrl ? "Activate PerkOS infrastructure to run the team" : "Team is up (PerkOS not connected)");
      }
    }
    if (cmd === "invite") {
      setGuest(true);
      setCaption("Guest on the floor. No spend.");
    }
    if (cmd === "docs") {
      setDocs(true);
      setCaption("Project notes");
    }
    if (cmd === "market") {
      setMarket(true);
      setCaption("NVDAc on Base");
    }
    if (cmd === "settings") {
      setSettings(true);
      setCaption("Settings");
    }
    if (cmd === "stop") {
      setListening(false);
      setTeam("hibernated");
      setGuest(false);
      setDocs(false);
      setMarket(false);
      setSettings(false);
      setCaption("");
      voice.stopAll();
      window.clearTimeout(idleTimer.current);
      setSplit(false);
      if (perkosRef.current.connected && fleetRef.current?.agents.some((a) => a.state === "ready" || a.state === "waking")) void fleetAction("hibernate");
    }
  }, [chat, voice, fleetAction]);
  runRef.current = run;

  const listen = useCallback(() => {
    voice.toggleTalk();
  }, [voice]);

  function applyWho(s: { name?: string; wallet?: string; model?: string; effort?: "low" | "medium" | "high" }) {
    setWho(s.name || s.wallet || "");
    if (s.model) setModel(s.model);
    if (s.effort) setEffort(s.effort);
  }

  useEffect(() => {
    if (!wallet.loaded) return;
    if (wallet.connected) {
      // Privy OK. Si ya hay un LLM conectado en la maquina entramos directo;
      // si no, el wizard sigue en el paso LLM. El logout del wallet no toca el LLM.
      void fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.address })
      })
        .then(() => Promise.all([fetch("/api/settings").then((r) => r.json()), fetch("/api/llm/status").then((r) => r.json())]))
        .then(([s, llm]: [{ name?: string; wallet?: string }, { connected?: boolean }]) => {
          applyWho(s);
          flog("info", `llm status: ${llm?.connected ? "connected" : "not connected"}`);
          void ensurePerkosRef.current();
          if (llm?.connected) {
            setWizard(false);
          } else {
            setWizardStart(2);
            setWizard(true);
          }
          setSplash(false);
          setBooted(true);
        })
        .catch(() => {
          setWizardStart(2);
          setWizard(true);
          setBooted(true);
        });
      return;
    }
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((s: { onboarded?: boolean; name?: string; wallet?: string }) => {
        applyWho(s);
        setWizard(true);
        // El ident con el logo es el arranque siempre: es el punto de venta.
        setWizardStart(0);
        setBooted(true);
      })
      .catch(() => {
        setWizard(true);
        setBooted(true);
      });
  }, [wallet.loaded, wallet.connected, wallet.address]);

  useEffect(() => {
    // El long-poll del bridge de voz (apps/voice) ocupa una conexion 20 s por
    // vuelta. Mientras hay conversacion (split) se pausa: Chromium solo da 6
    // conexiones por host y el chat/TTS las necesitan.
    if (wizard || splash || !booted || split) return;
    let stop = false;
    let id = 0;
    const tick = async () => {
      while (!stop) {
        try {
          const res = await fetch(`/api/command?wait=1&since=${id}`);
          const data = (await res.json()) as { id: number; text: string };
          if (stop) return;
          if (data.id && data.id !== id) {
            id = data.id;
            run(data.text);
          }
        } catch {
          if (stop) return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [run, wizard, splash, booted, split]);

  const submitDraft = useCallback(() => {
    const text = draft.trim();
    setDraft("");
    if (text) run(text);
  }, [draft, run]);

  // Escribir en cualquier parte de la ventana va al input "Ask the floor".
  // Espacio con el input vacio = hablar (push-to-talk).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setDebug(!debug);
        return;
      }
      if (splash || settings || wizard || !booted) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const inInput = e.target === askRef.current;
      if (inInput) return; // el input maneja su propio tecleo
      if (e.key === " " && !draft) {
        e.preventDefault();
        listen();
        return;
      }
      if (e.key === "Enter") {
        submitDraft();
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        setDraft((d) => d + e.key);
        askRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listen, submitDraft, draft, splash, settings, wizard, booted, debug, setDebug]);

  function logout() {
    flog("info", "logout: privy + wallet + PerkOS session cleared, LLM kept");
    void fetch("/api/perkos/session", { method: "DELETE" });
    setPerkos({ connected: false, busy: false, fundingUrl: "", note: "" });
    setFleet(null);
    window.clearTimeout(pollRef.current);
    hush();
    wallet.logout();
    setWho("");
    // La conversacion es de la cuenta que se va: no debe quedar para la siguiente.
    setMessages([]);
    setSplit(false);
    setTeam("hibernated");
    setGuest(false);
    setDocs(false);
    setMarket(false);
    setSettings(false);
    setCaption("");
    // Solo el wallet: el LLM conectado queda en ~/.perkos-floor (como cualquier app de AI).
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: "" })
    });
    setWizardStart(1);
    setWizard(true);
  }

  const awake = team !== "hibernated";
  const orbState = (role: FleetAgent["role"]) => fleet?.agents.find((a) => a.role === role)?.state ?? (perkos.connected ? "planned" : "");
  // La conversacion esta activa mientras escuchamos o el equipo sigue despierto:
  // ahi el boton pasa de microfono a stop.
  const live = listening || awake;
  const coreClass = speaking ? "speak" : thinking ? "think" : listening ? "listen" : awake ? "work" : "";

  // Nada se dibuja hasta decidir wizard o stage; si no, la esfera parpadea
  // un instante antes del ident mientras Privy y /api/llm/status resuelven.
  if (!wallet.loaded || !booted) {
    return (
      <div className="gate">
        <div className="dragbar" />
      </div>
    );
  }

  if (wizard) {
    return (
      <div className={`gate${debug ? " with-debug" : ""}`}>
        <div className="dragbar" />
        {wallet.connected && who ? (
          // Ya autenticado (paso LLM): la cuenta se ve y se puede empezar de nuevo.
          <div className="who">
            <span>{who}</span>
            <button type="button" onClick={logout}>
              Log out
            </button>
          </div>
        ) : null}
        <Wizard
          start={wizardStart}
          onDone={() => {
            setWizard(false);
            setSplash(false);
            void fetch("/api/settings")
              .then((r) => r.json())
              .then(applyWho);
          }}
        />
        <ErrorDock open={debug} onOpen={setDebug} />
      </div>
    );
  }

  return (
    <div className={`stage${split ? " split" : ""}${debug ? " with-debug" : ""}`}>
      <div className="dragbar" />
      <div className="mark">
        <img src="/logo-name.png" alt="PerkOS" />
      </div>
      <button className="gear" type="button" onClick={() => setSettings(true)} aria-label="Settings" title="Settings">
        <GearIcon />
      </button>
      {who ? (
        <div className="who">
          <span>{who}</span>
          <em className={`pk${perkos.connected ? " on" : ""}`} title={perkos.connected ? "PerkOS session active" : perkos.note || "PerkOS not connected"}>PerkOS</em>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </div>
      ) : null}
      {settings ? (
        <SettingsPanel
          onClose={() => setSettings(false)}
          debug={debug}
          onDebug={setDebug}
          perkos={perkos}
          onReconnectPerkos={() => void ensurePerkos(true)}
        />
      ) : null}

      <div className="orbit">
        <Orb className="scout" label="Scout" on={awake} state={orbState("scout")} />
        <Orb className="risk" label="Risk" on={awake} state={orbState("risk")} />
        <Orb className="trader" label="Trader" on={awake} state={orbState("trader")} />
        <Orb className="auditor" label="Auditor" on={awake} state={orbState("auditor")} />
        <Orb className={`guest${guest ? "" : " dim"}`} label={guest ? "Grok Bot" : "Guest"} on={guest} />
      </div>

      <div className={`slab docs${docs ? " on" : ""}`}>
        <div className="k">PROJECT</div>
        <b>PerkOS Floor</b>
        <small>They draft. You approve. Base only.</small>
      </div>
      <div className={`slab market${market ? " on" : ""}`}>
        <div className="k">B20</div>
        <b>NVDAc</b>
        <small>0xb200…08108C · tokens, not shares</small>
      </div>

      {/* Template del desk: aparece con sesion PerkOS y sin flota creada.
          "Deploy" = instantiate en la API bajo la wallet del usuario; las orbs
          muestran el progreso y la card se retira cuando hay agentes. */}
      <div className={`slab desk${perkos.connected && !split && !settings && (desk || deskNote) && (!fleet || fleet.status === "none") ? " on" : ""}`}>
        <div className="k">PERKOS FLOOR · TEMPLATE</div>
        {desk ? (
          <>
            <b>{desk.name}</b>
            <small>{desk.description}</small>
            <ul className="desk-agents">
              {desk.agents.map((a) => (
                <li key={a.role}><span>{a.name}</span> {a.duty}</li>
              ))}
            </ul>
            <button
              type="button"
              className="cta"
              disabled={team === "waking"}
              onClick={() => { setTeam("waking"); setCaption("Deploying your team on PerkOS…"); void fleetAction("wake"); }}
            >
              {team === "waking" ? "Deploying…" : "Deploy on PerkOS"}
            </button>
            <small className="desk-foot">Runs under your account · sleeps after {desk.idleMinutes} min idle · they draft, you approve</small>
          </>
        ) : (
          <>
            <b>Team template</b>
            <small>{deskNote}</small>
          </>
        )}
      </div>

      <div className="core-wrap">
        <button className={`core ${coreClass}`} type="button" onClick={listen} aria-label="Talk to PerkOS" />
        <div className="mic-dock">
          <div className="whisper">{speaking ? "Speaking" : thinking ? "Thinking" : listening ? "Listening" : awake ? "The floor is live" : "Hey PerkOS"}</div>
        </div>
      </div>

      {/* Conversacion: transcript + composer viven en una sola columna (.convo)
          que es la unica duena de posicion y ancho. En idle es solo el composer
          centrado abajo; en split ocupa la izquierda con un separador. */}
      <div className={`convo${split ? " split" : ""}`}>
      <div className={`transcript${split ? " on" : ""}`} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`turn ${m.role}`}>
            <span className="turn-k">{m.role === "you" ? "You" : m.role === "team" ? `Team · ${m.who ?? ""}` : "Floor"}</span>
            <div className="bubble">
              {m.text}
              {m.streaming ? <i className="cursor" /> : null}
            </div>
          </div>
        ))}
      </div>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
      >
        <div className="ask-top">
        <select
          className="model-chip"
          value={model}
          onChange={(e) => {
            const m = e.target.value;
            setModel(m);
            flog("info", `model -> ${m}`);
            void fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m }) });
          }}
          aria-label="Model"
          title="Model"
        >
          <option value="grok-4.6">Grok 4.6</option>
          <option value="grok-4.6-fast">Grok 4.6 Fast</option>
          <option value="grok-4">Grok 4</option>
        </select>
        <select
          className="model-chip"
          value={effort}
          onChange={(e) => {
            const v = e.target.value as "low" | "medium" | "high";
            setEffort(v);
            flog("info", `reasoning -> ${v}`);
            void fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effort: v }) });
          }}
          aria-label="Reasoning effort"
          title="Reasoning effort"
        >
          <option value="low">Fast</option>
          <option value="medium">Med</option>
          <option value="high">Deep</option>
        </select>
        </div>
        <div className="ask-row">
        <input
          ref={askRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the floor"
          spellCheck={false}
          autoComplete="off"
          aria-label="Ask the floor"
        />
        <button
          type="button"
          className={`ask-btn${voice.status === "listening" ? " on" : ""}`}
          onClick={listen}
          aria-label={voice.status === "listening" ? "Stop listening" : "Talk"}
          title={voice.status === "listening" ? "Stop" : "Talk"}
        >
          {voice.status === "listening" ? <StopIcon /> : <MicIcon />}
        </button>
        <button
          type="button"
          className={`ask-btn${voice.muted ? "" : " on"}`}
          onClick={() => voice.setMuted(!voice.muted)}
          aria-label={voice.muted ? "Unmute voice" : "Mute voice"}
          title={voice.muted ? "Voice off" : "Voice on"}
        >
          {voice.muted ? <MutedIcon /> : <SpeakerIcon />}
        </button>
        <button
          type="button"
          className={`ask-btn${voice.continuous ? " on" : ""}`}
          onClick={() => voice.setContinuous(!voice.continuous)}
          aria-label="Continuous conversation"
          title="Continuous conversation"
        >
          <LiveIcon />
        </button>
        {streaming || speaking ? (
          // Como cualquier chat de LLM: mientras trabaja, cuadrado de stop.
          <button type="button" className="ask-btn send stop" onClick={hush} aria-label="Stop" title="Stop">
            <StopIcon />
          </button>
        ) : draft.trim() ? (
          <button type="submit" className="ask-btn send" aria-label="Send" title="Send">
            <SendIcon />
          </button>
        ) : null}
        </div>
      </form>
      </div>
      <div className="caption">{caption}</div>
      <ErrorDock open={debug} onOpen={setDebug} />
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="8" y1="7" x2="8" y2="17" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="16" y1="7" x2="16" y2="17" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

function Orb({ className, label, on, state = "" }: { className: string; label: string; on: boolean; state?: string }) {
  const sub = state === "ready" ? "PerkOS" : state === "provisioning" ? "provisioning…" : state === "waking" ? "waking…" : state === "hibernated" ? "asleep" : state === "failed" ? "failed" : state === "planned" ? "not created" : "";
  return (
    <div className={`orb ${className}${on ? " on" : ""}${state ? ` st-${state}` : ""}`} title={sub}>
      <div className="ball" />
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

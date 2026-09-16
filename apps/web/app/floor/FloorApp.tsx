"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseIntent } from "./parseCommand";
import DeskPanel, { type DeskScreen } from "./DeskPanel";
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
  // Pantallas propias del desk (Market / Portfolio) y el activo enfocado.
  const [deskScreen, setDeskScreen] = useState<DeskScreen | "">("");
  const [focusAsset, setFocusAsset] = useState("");
  // El prompt "Hey PerkOS" vive bajo el microfono (.whisper). Esta linea es solo
  // el transcript de lo hablado o tecleado, asi que arranca vacia.
  const [caption, setCaption] = useState("");
  const [splash, setSplash] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [wizardStart, setWizardStart] = useState(0);
  // Cambia en cada logout: fuerza el remount del wizard aunque el paso de
  // arranque no cambie (el wizard guarda el paso en su propio estado).
  const [wizardEpoch, setWizardEpoch] = useState(0);
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
  // "draft": carta del Trader (cotizacion Uniswap V3 Base + calldata) con la
  // orb Approve; la wallet de la persona firma approve + swap. `tx` es el
  // progreso de la firma; `draft` es lo que devolvio /api/trade/draft.
  type Draft = { id: string; chainId: number; side: "buy" | "sell"; stock: { symbol: string; ticker: string; name: string; issuer: string; address: string; decimals: number }; pool: string; fee: number; poolUsdcDepth: number; tokenIn: { symbol: string; decimals: number }; tokenOut: { symbol: string; decimals: number }; amountInHuman: string; amountInUsd: number; quoteOutHuman: string; minOut: string; slippageBps: number; impliedPriceUsd: number; deadline: number; quotedAt: string; needsApproval: boolean; balanceUsdc: string; balanceToken: string; txs: Array<{ label: "approve" | "swap"; to: `0x${string}`; data: `0x${string}`; value: "0x0" }> };
  type TradeIntent = { side: "buy" | "sell"; stock?: string; amountUsd?: number; amountToken?: number; fraction?: number };
  type DraftTx = { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; step?: "approve" | "swap"; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  type Brief = { at: string; stock: { symbol: string; ticker: string; name: string; issuer: string }; priceUsd?: number; change24hPct?: number; range24h?: { low: number; high: number; open: number; last: number }; volume24hUsd?: number; sparkline?: number[]; pool: { fee: number; usdcDepth: number; priceUsd?: number } | null; chainlink?: { priceUsd: number; ageMin: number; stale: boolean }; premiumPct?: number; swaps24h?: { count: number; usdcVolume: number; buys: number; sells: number }; holding?: { balance: string; valueUsd: number }; lines: string[] };
  type News = { text: string; sources: Array<{ url: string; title?: string }>; at: string };
  type Analysis = { brief: Brief; news?: News; scout?: string; risk?: string; verdict?: "GO" | "BLOCK"; prev?: { priceUsd?: number; at: string }; loadingNews?: boolean };
  type Msg = { id: number; role: "you" | "floor" | "team" | "draft" | "analysis"; who?: string; text: string; streaming?: boolean; draft?: Draft; tx?: DraftTx; verdict?: "GO" | "BLOCK"; analysis?: Analysis };
  // Memo de analisis por activo: dentro de 15 min, "analyze" solo refresca
  // el precio; el turno de mesa y las noticias se reusan.
  const memoRef = useRef<Map<string, { msgId: number; at: number; analysis: Analysis }>>(new Map());
  const briefRef = useRef<{ lines: string[]; news?: string; msgId?: number } | null>(null);
  // Turno de mesa: quien habla ahora, el haz entre orbs y el veredicto de Risk.
  const [talkingSet, setTalkingSet] = useState<string[]>([]);
  const setTalking = (role: string, on = true) => setTalkingSet((s) => (on ? (s.includes(role) ? s : [...s, role]) : s.filter((x) => x !== role)));
  const talking = { has: (r: string) => talkingSet.includes(r) };
  const [beams, setBeams] = useState<Array<{ from: string; to: string; done: boolean }>>([]);
  const [verdict, setVerdict] = useState<"GO" | "BLOCK" | "">("");
  const orbRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const orbitRef = useRef<HTMLDivElement | null>(null);
  // Sesion PerkOS (firma del nonce con la wallet Privy) + flota Hermes en PerkOS infra.
  // rail/railLinked: el rail de gasto 1Claw del template (Trader) y si ya esta vinculado.
  type FleetAgent = { role: "scout" | "risk" | "trader" | "auditor"; name: string; agentId?: string; state: "planned" | "provisioning" | "waking" | "ready" | "hibernated" | "failed"; detail?: string; rail?: { provider: "1claw"; lockUsd: number }; railLinked?: boolean };
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
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
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
  // Autoscroll del transcript al ultimo turno, salvo que la persona haya
  // subido a leer (mas de 80 px por encima del final).
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80 + 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const kbWriteRef = useRef<(p: { journal?: true; kind?: "journal" | "analysis" | "order" | "memory"; title?: string; body: string; ticker?: string }) => void>(() => undefined);
  const focusRef = useRef("");
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
      if (readyRoles.length) {
        // Turno de mesa secuencial (Scout -> Risk -> Trader/Auditor) por SSE:
        // cada agente habla en su orb y deja su burbuja; Risk decide.
        setCaption("The desk is working…");
        setBeams([]);
        setVerdict("");
        const t1 = Date.now();
        const quote = quoteRef.current;
        const fr = await fetch("/api/fleet/desk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, roles: readyRoles, quote, brief: briefRef.current?.lines ?? null, news: briefRef.current?.news ?? null }),
          signal: ac.signal
        });
        if (fr.ok && fr.body) {
          const rd = fr.body.getReader();
          const dc = new TextDecoder();
          let buf = "";
          const handed: string[] = [];
          let n = 0;
          for (;;) {
            const { value, done } = await rd.read();
            if (done) break;
            buf += dc.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const line = buf.slice(0, i).replace(/^data:\s*/, "");
              buf = buf.slice(i + 2);
              if (!line) continue;
              let ev: { step?: string; role?: string; ok?: boolean; reply?: string; detail?: string; ms?: number; verdict?: "GO" | "BLOCK"; replies?: typeof fleetReplies };
              try { ev = JSON.parse(line); } catch { continue; }
              if (ev.step === "start" && ev.role) {
                setTalking(ev.role, true);
                setCaption(`${cap(ev.role)} is thinking…`);
                // Scout y Risk entregan a Trader y Auditor: los haces salen de quien ya hablo.
                if (ev.role === "trader" || ev.role === "auditor") setBeams((b) => [...b, ...handed.map((from) => ({ from, to: ev.role!, done: false }))]);
              } else if (ev.step === "reply" && ev.role) {
                setTalking(ev.role, false);
                if (ev.ok && ev.reply) {
                  n += 1;
                  const id = youId + 2 + n;
                  const r = ev.role;
                  setMessages((m) => [...m.filter((x) => x.id !== floorId), { id, role: "team", who: r, text: ev.reply!, verdict: ev.verdict }, { id: floorId, role: "floor", text: "", streaming: true }]);
                  flog("info", `desk ${r}: ${ev.ms} ms${ev.verdict ? ` · ${ev.verdict}` : ""}`);
                  touch();
                  // La Analysis card del activo en foco recoge lo que dicen Scout y Risk.
                  const aid = briefRef.current?.msgId;
                  if (aid && (r === "scout" || r === "risk")) {
                    setMessages((m) => m.map((x) => (x.id === aid && x.analysis ? { ...x, analysis: { ...x.analysis, [r]: ev.reply, ...(ev.verdict ? { verdict: ev.verdict } : {}) } } : x)));
                    const memo = [...memoRef.current.values()].find((v) => v.msgId === aid);
                    if (memo) memo.analysis = { ...memo.analysis, [r]: ev.reply!, ...(ev.verdict ? { verdict: ev.verdict } : {}) };
                  }
                  if (r === "risk" || r === "scout") handed.push(r);
                  if (r === "trader" || r === "auditor") setBeams((b) => b.map((x) => (x.to === r ? { ...x, done: true } : x)));
                  if (ev.verdict) {
                    setVerdict(ev.verdict);
                    if (ev.verdict === "BLOCK") {
                      const why = ev.reply!.replace(/^\s*VERDICT\s*[:\-]\s*BLOCK\s*/i, "").trim();
                      setMessages((m) => m.map((x) => (x.role === "draft" && x.tx && (x.tx.stage === "idle") ? { ...x, tx: { ...x.tx, stage: "blocked", note: `Risk blocked: ${why.slice(0, 200)}` } } : x)));
                      setCaption("Risk blocked the order.");
                      const qd = quoteRef.current;
                      if (qd) kbWriteRef.current({ kind: "order", ticker: qd.symbol.replace(/c$/i, ""), title: `blocked ${qd.side} ${qd.amountIn} ${qd.tokenIn} ${qd.symbol} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, body: `- ${qd.side} ${qd.amountIn} ${qd.tokenIn} -> ${qd.quoteOut} ${qd.tokenOut} at $${qd.priceUsd.toFixed(2)}\n- Risk: BLOCK. ${why.slice(0, 600)}` });
                    }
                  }
                } else {
                  flog("warn", `desk ${ev.role}: ${ev.detail || "no answer"}`);
                }
              } else if (ev.step === "done") {
                fleetReplies = ev.replies ?? [];
                setBeams((b) => b.map((x) => ({ ...x, done: true })));
                flog("info", `desk: ${fleetReplies.filter((r) => r.ok).length}/${fleetReplies.length} answered · ${Date.now() - t1} ms · verdict ${ev.verdict ?? "-"}`);
              } else if (ev.step === "error") {
                flog("error", `desk: ${ev.detail}`);
              }
            }
          }
        } else {
          const fj = await fr.json().catch(() => ({}));
          flog("warn", `desk ${fr.status}: ${fj.error ?? ""} ${fj.detail ?? ""}`);
        }
        setTalkingSet([]);
        setCaption("");
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fleet: fleetReplies, desk: deskRef.current ? { name: deskRef.current.name, roles: deskRef.current.agents.map((a) => a.name) } : undefined, brief: briefRef.current?.lines ?? null, news: briefRef.current?.news ?? null, focus: focusRef.current || null }),
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
      // Diario del desk: la pregunta, lo que dijo el equipo y la respuesta.
      const teamLines = fleetReplies.filter((r) => r.ok && r.reply).map((r) => `- **${cap(r.role)}**: ${r.reply.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
      kbWriteRef.current({ journal: true, body: `**You**: ${text}\n${teamLines ? `${teamLines}\n` : ""}- **Floor**: ${full.replace(/\s+/g, " ").slice(0, 900)}` });
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
  const pollSinceRef = useRef(0);

  const applyFleet = useCallback((f: Fleet) => {
    setFleet(f);
    const ready = f.agents.filter((a) => a.state === "ready").length;
    flog("info", `fleet: ${f.status} · ${f.agents.map((a) => `${a.role}=${a.state}`).join(" ")}`);
    if (f.status === "ready" || (ready > 0 && !f.agents.some((a) => a.state === "provisioning" || a.state === "waking"))) { setTeam("ready"); setCaption(ready === f.agents.length ? `Team is up · ${ready}/${f.agents.length} on PerkOS` : `${ready}/${f.agents.length} awake on PerkOS`); }
    else if (f.status === "hibernated" || f.status === "none") { if (teamRef.current === "waking") setTeam("hibernated"); }
    // Mientras provisiona/despierta, seguir mirando; con backoff (5 s los
    // primeros 2 min, luego 20 s) para no martillar la API si algo se traba.
    window.clearTimeout(pollRef.current);
    const inFlight = f.agents.some((a) => a.state === "provisioning" || a.state === "waking");
    if (inFlight) {
      if (!pollSinceRef.current) pollSinceRef.current = Date.now();
      const slow = Date.now() - pollSinceRef.current > 120_000;
      pollRef.current = window.setTimeout(() => void fleetAction("status"), slow ? 20_000 : 5000);
    } else {
      pollSinceRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Templates fleet publicados en PerkOS (una card por template; hoy solo
  // floor-desk). `deskId` es la card elegida; `desk` la derivada.
  const [desks, setDesks] = useState<DeskTemplate[]>([]);
  const [deskId, setDeskId] = useState("floor-desk");
  const [deskNote, setDeskNote] = useState("");
  const desk = desks.find((d) => d.id === deskId) ?? desks[0] ?? null;
  const deskRef = useRef<DeskTemplate | null>(null);
  deskRef.current = desk;
  // Quick switch de desk (header): guarda la eleccion, recarga la flota y
  // cierra las pantallas del desk anterior. La esfera habla desde el nuevo.
  const [deskMenu, setDeskMenu] = useState(false);
  const selectDesk = useCallback(async (id: string) => {
    setDeskMenu(false);
    if (id === deskId) return;
    setDeskId(id);
    setFleet(null);
    setDeskScreen("");
    setFocusAsset("");
    try {
      const res = await fetch("/api/fleet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select", templateId: id }) });
      const j = (await res.json().catch(() => ({}))) as Fleet & { error?: string; detail?: string };
      if (res.ok && j.agents) { applyFleet(j); setCaption(`${desks.find((d) => d.id === id)?.name ?? id} desk`); }
      else flog("warn", `desk select ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
    } catch (e) {
      flog("error", `desk select: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskId, desks]);
  const loadDesks = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/templates?lang=${encodeURIComponent((navigator.language || "en").slice(0, 2))}`);
      const j = (await res.json().catch(() => ({}))) as { templates?: DeskTemplate[]; selected?: string; error?: string; detail?: string };
      if (!res.ok) {
        setDesks([]);
        setDeskNote(j.detail || j.error || "templates unavailable");
        flog("error", `desk templates ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        return;
      }
      const list = j.templates ?? [];
      setDesks(list);
      if (j.selected && list.some((d) => d.id === j.selected)) setDeskId(j.selected);
      else if (list[0]) setDeskId(list[0].id);
      setDeskNote(list.length ? "" : "No team template published yet");
      flog(list.length ? "info" : "warn", `desk templates: ${list.map((d) => `${d.id} r${d.revision} (${d.agents.length})`).join(", ") || "none"}`);
    } catch (e) {
      flog("error", `desk templates: ${(e as Error).message}`);
    }
  }, []);

  // Pago: tras un 402, pedir una billing session a PerkOS y abrirla en el
  // browser del sistema (main.cjs manda pay.perkos.xyz afuera). Mientras la
  // persona paga, polling del saldo; cuando la infra queda habilitada, se
  // reintenta el deploy solo. Sin deep link de vuelta: el polling alcanza.
  const payPollRef = useRef(0);
  const fleetActionRef = useRef<(a: "status" | "wake" | "hibernate") => Promise<void>>(async () => undefined);
  const wizardRef = useRef(false);
  wizardRef.current = wizard;
  const deskIdRef = useRef("floor-desk");
  deskIdRef.current = deskId;
  const [paying, setPaying] = useState(false);
  const stopPayPoll = useCallback(() => { window.clearTimeout(payPollRef.current); payPollRef.current = 0; setPaying(false); }, []);
  const openPay = useCallback(async () => {
    try {
      const res = await fetch("/api/perkos/pay-session", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; detail?: string };
      if (!res.ok || !j.url) { flog("error", `pay session ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`); setCaption("Could not open the payment page"); return; }
      flog("info", `pay: opening ${j.url}`);
      window.open(j.url, "_blank", "noopener");
      setPaying(true);
      setCaption("Waiting for your payment on pay.perkos.xyz…");
      const started = Date.now();
      const tick = async () => {
        try {
          const b = await fetch("/api/perkos/billing");
          const bj = (await b.json().catch(() => ({}))) as { creditsUsd?: number; allowed?: boolean; reason?: string };
          if (b.ok && bj.allowed) {
            flog("info", `pay: infra allowed · $${(bj.creditsUsd ?? 0).toFixed(2)} credits`);
            stopPayPoll();
            setPerkos((p) => ({ ...p, fundingUrl: "", note: "" }));
            setTeam("waking");
            setCaption("Payment received · deploying your team on PerkOS…");
            void fleetActionRef.current("wake");
            return;
          }
        } catch {}
        if (Date.now() - started > 30 * 60_000) { flog("warn", "pay: gave up waiting after 30 min"); stopPayPoll(); setCaption("Payment window closed · press Deploy again"); return; }
        payPollRef.current = window.setTimeout(() => void tick(), 5000);
      };
      payPollRef.current = window.setTimeout(() => void tick(), 5000);
    } catch (e) {
      flog("error", `pay: ${(e as Error).message}`);
    }
  }, [stopPayPoll]);

  const fleetAction = useCallback(async (action: "status" | "wake" | "hibernate") => {
    try {
      const res = action === "status"
        ? await fetch("/api/fleet")
        : await fetch("/api/fleet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, templateId: deskIdRef.current }) });
      const j = (await res.json().catch(() => ({}))) as Fleet & { error?: string; detail?: string };
      if (!res.ok) {
        if (res.status === 402) {
          setPerkos((p) => ({ ...p, fundingUrl: "https://pay.perkos.xyz", note: "Activate PerkOS infrastructure" }));
          setCaption("Activate PerkOS infrastructure to run the team");
          // Desde la escena (comando "wake") no hay boton: abrir el pago directo.
          // En el wizard el paso "Your team" muestra el boton y la persona decide.
          if (action === "wake" && !wizardRef.current) void openPay();
        }
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
  fleetActionRef.current = fleetAction;

  // Sesion PerkOS: reutiliza la guardada para esta wallet o firma el nonce.
  const ensurePerkos = useCallback(async (force = false) => {
    const addr = wallet.address;
    if (!addr) return;
    setPerkos((p) => ({ ...p, busy: true, note: "" }));
    try {
      if (!force) {
        const cur = (await fetch(`/api/perkos/session?wallet=${encodeURIComponent(addr)}`).then((r) => r.json())) as { connected?: boolean; configured?: boolean };
        if (cur.configured === false) { flog("warn", "perkos: session not available on this build"); setPerkos({ connected: false, busy: false, fundingUrl: "", note: "not configured" }); return; }
        if (cur.connected) { flog("info", "perkos: session ok"); setPerkos({ connected: true, busy: false, fundingUrl: "", note: "" }); void loadDesks(); void fleetAction("status"); return; }
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
      void loadDesks();
      void fleetAction("status");
    } catch (e) {
      perkosDeclined = true;
      flog("error", `perkos: ${(e as Error).message}`);
      setPerkos({ connected: false, busy: false, fundingUrl: "", note: (e as Error).message });
    }
  }, [wallet, fleetAction, loadDesks]);
  const ensurePerkosRef = useRef(ensurePerkos);
  ensurePerkosRef.current = ensurePerkos;

  // Draft del Trader: "buy $5 of NVIDIA" → /api/trade/draft cotiza en Uniswap
  // V3 (Base) y arma approve + swap; la carta aparece en el transcript con la
  // orb Approve. La conversacion sigue en paralelo (equipo + Grok comentan).
  // La orden en la mesa este turno (para el prompt de Risk/Trader/Auditor).
  const quoteRef = useRef<{ side: string; symbol: string; name: string; amountIn: string; tokenIn: string; quoteOut: string; tokenOut: string; priceUsd: number; pool: string; fee: number; poolUsdcDepth: number; minOut: string } | null>(null);
  const tradeDraft = useCallback(async (intent: TradeIntent) => {
    const id = Date.now() + 3;
    const what = intent.stock ?? "NVDAc";
    const size = intent.side === "buy" ? `$${intent.amountUsd}` : intent.fraction === 1 ? "all your" : intent.fraction ? `${Math.round(intent.fraction * 100)}% of your` : intent.amountToken ? `${intent.amountToken}` : `$${intent.amountUsd} of`;
    setMessages((m) => [...m.slice(-40), { id, role: "draft", who: "trader", text: `Drafting: ${intent.side} ${size} ${what}…`, streaming: true }]);
    touch();
    try {
      const res = await fetch("/api/trade/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent) });
      const j = (await res.json().catch(() => ({}))) as Draft & { error?: string; detail?: string };
      if (!res.ok || !j.txs) {
        flog("error", `trade draft ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: `Could not draft the trade: ${j.detail ?? j.error ?? res.status}`, streaming: false } : x)));
        return;
      }
      flog("info", `trade draft: ${j.side} ${j.amountInHuman} ${j.tokenIn.symbol} → ${j.quoteOutHuman} ${j.tokenOut.symbol} @ $${j.impliedPriceUsd.toFixed(2)} · pool $${j.poolUsdcDepth.toFixed(0)} · ${j.txs.length} tx · balances $${j.balanceUsdc} / ${j.balanceToken} ${j.stock.symbol}`);
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: "", streaming: false, draft: j, tx: { stage: "idle", hashes: [] } } : x)));
      quoteRef.current = { side: j.side, symbol: j.stock.symbol, name: j.stock.name, amountIn: j.amountInHuman, tokenIn: j.tokenIn.symbol, quoteOut: j.quoteOutHuman, tokenOut: j.tokenOut.symbol, priceUsd: j.impliedPriceUsd, pool: j.pool, fee: j.fee, poolUsdcDepth: j.poolUsdcDepth, minOut: (Number(j.minOut) / 10 ** j.tokenOut.decimals).toFixed(6) };
      setCaption(`Trader drafted: ${j.amountInHuman} ${j.tokenIn.symbol} → ${j.quoteOutHuman} ${j.tokenOut.symbol}. Hold Approve to sign.`);
    } catch (e) {
      flog("error", `trade draft: ${(e as Error).message}`);
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: "Could not draft the trade.", streaming: false } : x)));
    }
  }, [touch]);

  // Approve: la persona firma en su wallet (MetaMask por WalletConnect) cada
  // tx del draft en orden; Floor espera el receipt en Base y muestra el hash.
  const approveDraft = useCallback(async (msgId: number) => {
    const msg = messagesRef.current.find((x) => x.id === msgId);
    const d = msg?.draft;
    if (!d || (msg?.tx && msg.tx.stage !== "idle" && msg.tx.stage !== "failed")) return;
    const patch = (tx: Partial<DraftTx>) => setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, tx: { ...(x.tx ?? { stage: "idle", hashes: [] }), ...tx } as DraftTx } : x)));
    if (Date.now() / 1000 > d.deadline - 60) { patch({ stage: "failed", note: "Quote expired. Ask for a new draft." }); return; }
    const hashes: DraftTx["hashes"] = [];
    try {
      for (const t of d.txs) {
        patch({ stage: "signing", step: t.label, hashes: [...hashes], note: "" });
        setCaption(t.label === "approve" ? "Confirm the USDC approval in your wallet…" : "Confirm the swap in your wallet…");
        flog("info", `trade ${t.label}: waiting for signature`);
        const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: t.value, chainId: d.chainId });
        flog("info", `trade ${t.label}: sent ${hash}`);
        hashes.push({ label: t.label, hash, status: "pending", explorer: `https://basescan.org/tx/${hash}` });
        patch({ stage: "pending", step: t.label, hashes: [...hashes] });
        setCaption(t.label === "approve" ? "Approval sent · waiting for Base…" : "Swap sent · waiting for Base…");
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 4000));
          const r = await fetch(`/api/trade/receipt?hash=${hash}`);
          const rj = (await r.json().catch(() => ({}))) as { status?: string };
          if (rj.status === "success") { hashes[hashes.length - 1].status = "success"; patch({ hashes: [...hashes] }); break; }
          if (rj.status === "reverted") throw new Error(`${t.label} reverted on Base`);
          if (Date.now() - started > 3 * 60_000) throw new Error(`${t.label} not confirmed after 3 min`);
        }
        flog("info", `trade ${t.label}: confirmed`);
      }
      patch({ stage: "done", step: undefined, hashes: [...hashes] });
      kbWriteRef.current({ kind: "order", ticker: d.stock.ticker, title: `${d.side} ${d.side === "buy" ? `$${d.amountInUsd}` : d.amountInHuman} ${d.stock.symbol} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, body: `- Side: ${d.side}\n- Asset: ${d.stock.name} (${d.stock.symbol}, ${d.stock.issuer})\n- Paid: ${d.amountInHuman} ${d.tokenIn.symbol}\n- Received (quoted): ${d.quoteOutHuman} ${d.tokenOut.symbol}\n- Price: $${d.impliedPriceUsd.toFixed(2)} per share\n- Pool: ${d.pool} (${d.fee / 10_000}%)\n- Signed by the human in their wallet.\n${hashes.map((h) => `- ${h.label}: ${h.explorer}`).join("\n")}` });
      setCaption(d.side === "buy" ? `Bought ${d.quoteOutHuman} ${d.stock.symbol} for $${d.amountInUsd} on Base.` : `Sold ${d.amountInHuman} ${d.stock.symbol} for $${d.quoteOutHuman} on Base.`);
      speak(d.side === "buy" ? `Done. You now hold ${Number(d.quoteOutHuman).toFixed(4)} ${d.stock.name} on Base, and the receipt is on chain.` : `Done. ${d.amountInHuman} ${d.stock.name} sold for ${Number(d.quoteOutHuman).toFixed(2)} dollars on Base, receipt on chain.`);
      touch();
    } catch (e) {
      const m = (e as Error).message || "signature failed";
      flog("error", `trade: ${m}`);
      patch({ stage: "failed", hashes: [...hashes], note: /reject|denied|4001/i.test(m) ? "You declined in the wallet." : m });
      setCaption(/reject|denied|4001/i.test(m) ? "Trade cancelled in the wallet." : "Trade failed.");
    }
  }, [wallet, speak, touch]);

  // Cotizacion inmediata (sin agentes): "price of Apple".
  const quoteAsset = useCallback(async (asset: string) => {
    const id = Date.now() + 5;
    setMessages((m) => [...m.slice(-40), { id, role: "floor", text: "", streaming: true }]);
    touch();
    try {
      const r = await fetch(`/api/market/stocks?depth=1&limit=40&q=${encodeURIComponent(asset)}`);
      const j = (await r.json().catch(() => ({}))) as { stocks?: Array<{ symbol: string; name: string; issuer: string; priceUsd?: number; priceChange24hPct?: number; pool: { usdcDepth: number; fee: number } | null; tradeable: boolean }> };
      const pick = (j.stocks ?? []).find((x) => x.issuer === "coinbase") ?? (j.stocks ?? [])[0];
      const text = !pick
        ? `I don't see "${asset}" among the tokenized stocks on Base.`
        : `${pick.name} (${pick.symbol}, ${pick.issuer === "coinbase" ? "Coinbase B20" : pick.issuer}) is $${(pick.priceUsd ?? 0).toFixed(2)}${pick.priceChange24hPct !== undefined ? ` (${pick.priceChange24hPct > 0 ? "+" : ""}${pick.priceChange24hPct.toFixed(2)}% today)` : ""}. ${pick.pool ? `The USDC pool on Uniswap holds $${pick.pool.usdcDepth.toFixed(0)}${pick.tradeable ? ", enough for a small order." : ", too thin to trade."}` : "There is no USDC pool on Uniswap V3 Base for it."}`;
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text, streaming: false } : x)));
      speak(text);
      setCaption(text.slice(0, 90));
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: "Could not fetch the quote.", streaming: false } : x)));
      flog("error", `quote: ${(e as Error).message}`);
    }
  }, [speak, touch]);

  // Cierre del dia: el diario del desk se resume en memory.md (hechos,
  // decisiones, preferencias, preguntas abiertas). Por voz o desde Notes.
  const summarizeDay = useCallback(async (date?: string, quiet = false) => {
    if (!quiet) setCaption("Summarizing the day into the desk's memory…");
    try {
      const r = await fetch("/api/kb/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(date ? { date } : { force: true }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; cached?: boolean; reason?: string; text?: string; error?: string; detail?: string };
      if (!r.ok) { flog("warn", `summarize: ${j.error ?? r.status} ${j.detail ?? ""}`); if (!quiet) setCaption("Could not summarize the day."); return; }
      if (j.reason === "nothing_to_summarize") { if (!quiet) { setCaption("Nothing to summarize yet."); speak("Nothing to summarize yet; talk to the desk first."); } return; }
      flog("info", `summarize ${date ?? "today"}: ${j.cached ? "already done" : `${(j.text ?? "").length} chars`}`);
      if (quiet) return;
      const id = Date.now() + 9;
      setMessages((m) => [...m.slice(-40), { id, role: "floor", text: j.text ?? "Saved to the desk's memory." }]);
      touch();
      setCaption("Saved to the desk's memory.");
      speak("Done. I kept the facts, decisions and open questions in the desk's memory.");
    } catch (e) {
      flog("error", `summarize: ${(e as Error).message}`);
    }
  }, [speak, touch]);

  // Al entrar con sesion PerkOS: si el diario de ayer quedo sin resumir, se
  // resume en silencio (una vez por arranque).
  const bootSummaryRef = useRef(false);
  useEffect(() => {
    if (!perkos.connected || bootSummaryRef.current) return;
    bootSummaryRef.current = true;
    const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    void summarizeDay(y, true);
  }, [perkos.connected, summarizeDay]);

  // "Analyze X": market brief instantaneo (on-chain + API) -> Analysis card
  // -> noticias con fuentes (Grok web_search) -> turno de mesa con ambos.
  // Memo de 15 min: repetir solo refresca el precio.
  const analyzeAsset = useCallback(async (asset: string, spoken: string, force = false) => {
    setFocusAsset(asset);
    setDeskScreen("market");
    touch();
    const key = asset.toLowerCase();
    const memo = memoRef.current.get(key);
    const fresh = memo && Date.now() - memo.at < 15 * 60_000 && !force;
    setCaption(fresh ? `Refreshing ${asset}…` : `Reading the market for ${asset}…`);
    let brief: Brief | null = null;
    try {
      const r = await fetch(`/api/market/brief?asset=${encodeURIComponent(asset)}`);
      const j = (await r.json().catch(() => ({}))) as Brief & { error?: string; detail?: string };
      if (!r.ok || !j.stock) { flog("warn", `brief ${r.status}: ${j.error ?? ""} ${j.detail ?? ""}`); setCaption(j.detail ?? `I don't see "${asset}" among the tokenized stocks on Base.`); return; }
      brief = j;
    } catch (e) {
      flog("error", `brief: ${(e as Error).message}`);
      return;
    }
    const b = brief!;
    flog("info", `brief ${b.stock.symbol}: $${b.priceUsd?.toFixed(2)} ${b.change24hPct?.toFixed(2)}% · pool $${b.pool?.usdcDepth.toFixed(0) ?? "-"} · chainlink $${b.chainlink?.priceUsd.toFixed(2) ?? "-"} (${b.chainlink?.ageMin ?? "-"} min) · premium ${b.premiumPct?.toFixed(2) ?? "-"}% · swaps24h ${b.swaps24h?.count ?? "-"}`);
    if (fresh && memo) {
      // Solo el precio cambia a cada momento: actualizar la card y decirlo.
      const prev = memo.analysis.brief.priceUsd;
      const next = { ...memo.analysis, brief: b, prev: { priceUsd: prev, at: memo.analysis.brief.at } };
      memo.analysis = next;
      setMessages((m) => m.map((x) => (x.id === memo.msgId ? { ...x, analysis: next } : x)));
      const delta = prev && b.priceUsd ? ((b.priceUsd / prev) - 1) * 100 : undefined;
      const line = `${b.stock.name} is $${b.priceUsd?.toFixed(2)}${delta !== undefined ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(2)}% since the last look)` : ""}${b.premiumPct !== undefined ? `, pool ${b.premiumPct > 0 ? "+" : ""}${b.premiumPct.toFixed(2)}% vs Chainlink` : ""}. The rest of the analysis stands.`;
      setCaption(line.slice(0, 100));
      speak(line);
      briefRef.current = { lines: b.lines, news: memo.analysis.news?.text, msgId: memo.msgId };
      return;
    }
    const id = Date.now() + 7;
    const analysis: Analysis = { brief: b, loadingNews: true };
    memoRef.current.set(key, { msgId: id, at: Date.now(), analysis });
    setMessages((m) => [...m.slice(-40), { id, role: "analysis", who: b.stock.symbol, text: "", analysis }]);
    briefRef.current = { lines: b.lines, msgId: id };
    setCaption(`${b.stock.name} $${b.priceUsd?.toFixed(2)} · asking the desk…`);
    // Noticias con fuentes (Grok web_search), en paralelo con el turno de mesa.
    const newsP = fetch("/api/market/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: b.stock.ticker, name: b.stock.name }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        const news: News | undefined = ok && j.text ? { text: j.text, sources: j.sources ?? [], at: j.at } : undefined;
        if (!ok) flog("warn", `news: ${j.error ?? ""} ${j.detail ?? ""}`); else flog("info", `news ${b.stock.ticker}: ${String(j.text).length} chars · ${(j.sources ?? []).length} sources${j.cached ? " · cached" : ""}`);
        const memo2 = memoRef.current.get(key);
        if (memo2) memo2.analysis = { ...memo2.analysis, news, loadingNews: false };
        // Nota de analisis: hechos + noticias con fuentes (Scout/Risk van al diario).
        kbWriteRef.current({ kind: "analysis", ticker: b.stock.ticker, title: `${b.stock.name} (${b.stock.symbol}) · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, body: `${b.lines.map((l) => `- ${l}`).join("\n")}${news ? `\n\n## News\n${news.text}\n${news.sources.map((s, i) => `[${i + 1}] ${s.url}`).join("\n")}` : ""}` });
        setMessages((m) => m.map((x) => (x.id === id && x.analysis ? { ...x, analysis: { ...x.analysis, news, loadingNews: false } } : x)));
        if (briefRef.current?.msgId === id && news) briefRef.current = { ...briefRef.current, news: news.text };
        return news;
      })
      .catch((e) => { flog("error", `news: ${(e as Error).message}`); return undefined; });
    // Dar hasta 12 s a las noticias para que entren en el prompt de la mesa.
    await Promise.race([newsP, new Promise((r) => setTimeout(r, 12_000))]);
    await chat(spoken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, speak, touch]);

  // Conocimiento local: cada turno deja rastro en ~/.perkos-floor/knowledge
  // (diario, analisis, ordenes). Best effort; nunca bloquea la escena.
  const kbWrite = useCallback((payload: { journal?: true; kind?: "journal" | "analysis" | "order" | "memory"; title?: string; body: string; ticker?: string }) => {
    void fetch("/api/kb/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => r.json().then((j) => { if (!r.ok) flog("warn", `kb: ${j.error ?? r.status}`); }))
      .catch((e) => flog("warn", `kb: ${(e as Error).message}`));
  }, []);
  kbWriteRef.current = kbWrite;
  focusRef.current = focusAsset;

  const run = useCallback((raw: string) => {
    const spoken = raw.trim();
    const it = parseIntent(raw);
    const cmd = it.kind;
    flog("info", `intent: ${it.kind}${"asset" in it && it.asset ? ` · ${it.asset}` : ""}`);
    if (cmd === "chat" && spoken) {
      quoteRef.current = null;
      briefRef.current = null;
      void chat(spoken);
      return;
    }
    if (cmd === "buy" || cmd === "sell") {
      quoteRef.current = null;
      if (it.asset) setFocusAsset(it.asset);
      // Primero la cotizacion (la orden en la mesa), despues el turno de mesa.
      void tradeDraft({ side: cmd, stock: it.asset, amountUsd: it.amountUsd, amountToken: "amountToken" in it ? it.amountToken : undefined, fraction: "fraction" in it ? it.fraction : undefined }).then(() => chat(spoken));
      return;
    }
    if (cmd === "analyze") {
      quoteRef.current = null;
      if (it.asset) void analyzeAsset(it.asset, spoken, /\b(again|deep|fresh|de nuevo|otra vez|a fondo)\b/i.test(spoken));
      else void chat(spoken);
      return;
    }
    if (cmd === "quote") {
      if (it.asset) { setFocusAsset(it.asset); setDeskScreen("market"); void quoteAsset(it.asset); }
      else void chat(spoken);
      return;
    }
    if (cmd === "portfolio") { setDeskScreen("portfolio"); setCaption("Your positions on Base"); return; }
    if (cmd === "docs") { setDeskScreen("notes"); setCaption("What this desk remembers"); return; }
    if (cmd === "summarize") { void summarizeDay(); return; }
    if (cmd === "approve") {
      const d = [...messagesRef.current].reverse().find((m) => m.role === "draft" && m.tx?.stage === "idle");
      if (d) { setCaption("Approving in your wallet…"); void approveDraft(d.id); } else setCaption("Nothing to approve.");
      return;
    }
    if (cmd === "cancel") {
      setMessages((m) => m.map((x) => (x.role === "draft" && x.tx && (x.tx.stage === "idle" || x.tx.stage === "blocked") ? { ...x, tx: { ...x.tx, stage: "failed", note: "Cancelled." } } : x)));
      setCaption("Draft discarded.");
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
    if (cmd === "market") {
      setDeskScreen("market");
      setCaption("Tokenized stocks on Base");
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
      setDeskScreen("");
      setSettings(false);
      setCaption("");
      voice.stopAll();
      window.clearTimeout(idleTimer.current);
      setSplit(false);
      if (perkosRef.current.connected && fleetRef.current?.agents.some((a) => a.state === "ready" || a.state === "waking")) void fleetAction("hibernate");
    }
  }, [summarizeDay, analyzeAsset, approveDraft, quoteAsset, chat, voice, fleetAction]);
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
          // Con LLM, el wizard sigue en el paso del equipo (3): se cierra solo
          // en cuanto la flota existe (ver effect mas abajo) o al saltarlo.
          setWizardStart(llm?.connected ? 3 : 2);
          setWizard(true);
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

  // El paso "Your team" termina cuando hay flota (aunque este provisionando):
  // la escena con las orbs es donde se ve el progreso.
  const [teamSkipped, setTeamSkipped] = useState(false);

  // Rail de gasto (1Claw) del Trader: paso 4 del wizard, recien desplegada la
  // flota. Opcional: se entra sin rail y se vuelve desde la orb del Trader.
  // La API enrola con su app partner y devuelve el claimUrl; Floor lo abre en
  // el browser del sistema y hace polling hasta `linked`. La key nunca llega.
  type RailState = { status: "unknown" | "not_configured" | "not_connected" | "claim_pending" | "linked"; claimUrl?: string; vaultId?: string; oneclawAgentId?: string; linkedRoles?: string[]; busy: boolean; note: string };
  const [rail, setRail] = useState<RailState>({ status: "unknown", busy: false, note: "" });
  const [railSkipped, setRailSkipped] = useState(false);
  const railPollRef = useRef(0);
  const railStatus = useCallback(async () => {
    window.clearTimeout(railPollRef.current);
    try {
      const res = await fetch("/api/fleet/rail");
      const j = (await res.json().catch(() => ({}))) as { status?: RailState["status"]; claimUrl?: string; vaultId?: string; oneclawAgentId?: string; linkedRoles?: string[]; error?: string; detail?: string };
      if (!res.ok || !j.status) { flog("warn", `rail status ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`); return; }
      flog("info", `rail: ${j.status}${j.vaultId ? ` · vault ${j.vaultId.slice(0, 8)}` : ""}${j.linkedRoles?.length ? ` · ${j.linkedRoles.join("/")}` : ""}`);
      setRail((p) => ({ ...p, status: j.status!, vaultId: j.vaultId, oneclawAgentId: j.oneclawAgentId, linkedRoles: j.linkedRoles, claimUrl: j.claimUrl ?? p.claimUrl, note: j.status === "linked" ? "" : p.note }));
      if (j.status === "claim_pending") railPollRef.current = window.setTimeout(() => void railStatus(), 5000);
    } catch (e) {
      flog("error", `rail status: ${(e as Error).message}`);
    }
  }, []);
  const railEnrol = useCallback(async (email: string) => {
    setRail((p) => ({ ...p, busy: true, note: "" }));
    try {
      const res = await fetch("/api/fleet/rail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const j = (await res.json().catch(() => ({}))) as { status?: RailState["status"]; claimUrl?: string; authorizeUrl?: string; vaultId?: string; error?: string; detail?: string };
      if (!res.ok || !j.status) {
        flog("error", `rail enrol ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        setRail((p) => ({ ...p, busy: false, note: j.detail || "Could not link 1Claw. Try again." }));
        return;
      }
      flog("info", `rail enrol: ${j.status}${j.claimUrl ? " · claim url" : ""}${j.authorizeUrl ? " · authorize url" : ""}`);
      if (j.authorizeUrl) {
        // Cuenta 1Claw existente: primero autoriza PerkOS, despues Link de nuevo.
        window.open(j.authorizeUrl, "_blank", "noopener");
        setRail((p) => ({ ...p, busy: false, status: "not_connected", note: "Authorize PerkOS in your 1Claw account, then press Link 1Claw again." }));
        return;
      }
      if (j.claimUrl) window.open(j.claimUrl, "_blank", "noopener");
      setRail({ status: j.status, claimUrl: j.claimUrl, vaultId: j.vaultId, busy: false, note: "" });
      if (j.status === "claim_pending") railPollRef.current = window.setTimeout(() => void railStatus(), 5000);
    } catch (e) {
      flog("error", `rail enrol: ${(e as Error).message}`);
      setRail((p) => ({ ...p, busy: false, note: "Could not link 1Claw. Try again." }));
    }
  }, [railStatus]);
  // En la escena, el estado del rail se lee una vez por flota (Settings y el
  // badge del Trader lo muestran); el wizard lo refresca por su cuenta.
  useEffect(() => {
    if (rail.status !== "unknown" || !fleet?.agents.some((a) => a.rail) || !perkos.connected) return;
    void railStatus();
  }, [fleet, rail.status, perkos.connected, railStatus]);
  const openRailStep = useCallback(() => {
    setRailSkipped(false);
    setWizardStart(4);
    setWizard(true);
    void railStatus();
  }, [railStatus]);

  // El paso "Your team" termina cuando hay flota (aunque este provisionando).
  // Si el template trae rail y aun no esta vinculado sigue el paso 4; si no,
  // la escena con las orbs es donde se ve el progreso.
  useEffect(() => {
    if (!wizard || wizardStart !== 3) return;
    if (teamSkipped) { setWizard(false); setSplash(false); return; }
    if (fleet && fleet.status !== "none") {
      const railed = fleet.agents.find((a) => a.rail);
      if (railed && !railed.railLinked && !railSkipped) { setWizardStart(4); void railStatus(); return; }
      setWizard(false);
      setSplash(false);
    }
  }, [wizard, wizardStart, fleet, teamSkipped, railSkipped, railStatus]);
  useEffect(() => {
    if (!wizard || wizardStart !== 4) return;
    if (railSkipped || rail.status === "linked") {
      window.clearTimeout(railPollRef.current);
      setWizard(false);
      setSplash(false);
      if (rail.status === "linked") { setCaption("1Claw rail linked · the Trader spends only within your limits"); void fleetActionRef.current("status"); }
    }
  }, [wizard, wizardStart, rail.status, railSkipped]);

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
    perkosDeclined = false;
    setFleet(null);
    setDesks([]);
    setDeskNote("");
    setTeamSkipped(false);
    setRail({ status: "unknown", busy: false, note: "" });
    setRailSkipped(false);
    window.clearTimeout(railPollRef.current);
    window.clearTimeout(pollRef.current);
    stopPayPoll();
    hush();
    // Privy tarda varios segundos en cerrar la sesion; no esperarlo: la
    // bienvenida con el logo aparece ya, y el wizard se remonta en el paso 0.
    wallet.logout();
    setWizardStart(0);
    setWizardEpoch((e) => e + 1);
    setWizard(true);
    setSplash(false);
    setWho("");
    // La conversacion es de la cuenta que se va: no debe quedar para la siguiente.
    setMessages([]);
    setSplit(false);
    setTeam("hibernated");
    setGuest(false);
    setDocs(false);
    setMarket(false);
    setDeskScreen("");
    setFocusAsset("");
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
  // Badge 1Claw: solo para roles con rail en el template (Trader). Vinculado = a color.
  const orbRail = (role: FleetAgent["role"]) => { const a = fleet?.agents.find((x) => x.role === role); return a?.rail ? { linked: Boolean(a.railLinked), lockUsd: a.rail.lockUsd } : undefined; };
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
          key={`${wizardStart}:${wizardEpoch}`}
          start={wizardStart}
          onDone={() => {
            setWizard(false);
            setSplash(false);
            void fetch("/api/settings")
              .then((r) => r.json())
              .then(applyWho);
          }}
          team={{
            desks,
            desk,
            deskNote,
            onSelect: (id: string) => { setDeskId(id); setFleet(null); void fleetActionRef.current("status"); },
            perkosConnected: perkos.connected,
            perkosBusy: perkos.busy,
            perkosNote: perkos.note,
            fundingUrl: perkos.fundingUrl,
            paying,
            deploying: team === "waking",
            onDeploy: () => { setTeam("waking"); setCaption("Deploying your team on PerkOS…"); void fleetAction("wake"); },
            onPay: () => void openPay(),
            onReconnect: () => void ensurePerkos(true),
            onSkip: () => { setTeamSkipped(true); void fetch("/api/settings").then((r) => r.json()).then(applyWho); }
          }}
          rail={{
            status: rail.status,
            traderName: fleet?.agents.find((a) => a.rail)?.name ?? "",
            traderState: fleet?.agents.find((a) => a.rail)?.state ?? "",
            lockUsd: fleet?.agents.find((a) => a.rail)?.rail?.lockUsd ?? 0,
            busy: rail.busy,
            note: rail.note,
            claimUrl: rail.claimUrl,
            onLink: (email: string) => void railEnrol(email),
            onOpenClaim: () => { if (rail.claimUrl) window.open(rail.claimUrl, "_blank", "noopener"); },
            onSkip: () => setRailSkipped(true)
          }}
        />
        <ErrorDock open={debug} onOpen={setDebug} />
      </div>
    );
  }

  return (
    <div className={`stage${split ? " split" : ""}${debug ? " with-debug" : ""}${deskScreen ? " desk-open" : ""}`}>
      <div className="dragbar" />
      <div className="mark">
        <img src="/logo-name.png" alt="PerkOS" />
      </div>
      <button className="gear" type="button" onClick={() => setSettings(true)} aria-label="Settings" title="Settings">
        <GearIcon />
      </button>
      {who ? (
        <div className="who">
          {/* Desk actual + quick switch (como org/proyecto en PerkOS App). */}
          {desks.length ? (
            <div className={`deskpick${deskMenu ? " open" : ""}`}>
              <button type="button" className="desk-cur" onClick={() => setDeskMenu((v) => !v)} aria-haspopup="listbox" aria-expanded={deskMenu} title="Switch desk">
                <i className={`dot ${fleet?.status ?? "none"}`} />
                {desk?.name ?? "No desk"}
                <b>▾</b>
              </button>
              {deskMenu ? (
                <ul role="listbox" className="desk-menu">
                  {desks.map((d) => (
                    <li key={d.id} role="option" aria-selected={d.id === deskId}>
                      <button type="button" className={d.id === deskId ? "on" : ""} onClick={() => void selectDesk(d.id)}>
                        <span>{d.name}</span>
                        <small>{d.agents.length} agents{d.id === deskId && fleet ? ` · ${fleet.status}` : ""}</small>
                      </button>
                    </li>
                  ))}
                  <li className="add">
                    <button type="button" onClick={() => { setDeskMenu(false); setWizardStart(3); setWizard(true); }}>+ Add a desk</button>
                  </li>
                </ul>
              ) : null}
            </div>
          ) : null}
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
          rail={{ status: rail.status, oneclawAgentId: rail.oneclawAgentId, vaultId: rail.vaultId, linkedRoles: rail.linkedRoles, hasRail: Boolean(fleet?.agents.some((a) => a.rail)) }}
          onLinkRail={() => { setSettings(false); openRailStep(); }}
        />
      ) : null}

      <div className="orbit" ref={orbitRef}>
        <Beams beams={beams} orbitRef={orbitRef} orbRefs={orbRefs} />
        <Orb className="scout" label="Scout" on={awake} state={orbState("scout")} talking={talking.has("scout")} refCb={(el) => { orbRefs.current.scout = el; }} />
        <Orb className="risk" label="Risk" on={awake} state={orbState("risk")} talking={talking.has("risk")} verdict={verdict} refCb={(el) => { orbRefs.current.risk = el; }} />
        <Orb className="trader" label="Trader" on={awake} state={orbState("trader")} rail={orbRail("trader")} onRail={openRailStep} talking={talking.has("trader")} refCb={(el) => { orbRefs.current.trader = el; }} />
        <Orb className="auditor" label="Auditor" on={awake} state={orbState("auditor")} talking={talking.has("auditor")} refCb={(el) => { orbRefs.current.auditor = el; }} />
        <Orb className={`guest${guest ? "" : " dim"}`} label={guest ? "Grok Bot" : "Guest"} on={guest} />
      </div>

      <div className={`slab docs${docs ? " on" : ""}`}>
        <div className="k">PROJECT</div>
        <b>PerkOS Floor</b>
        <small>They draft. You approve. Base only.</small>
      </div>
      {/* Dock del desk: las pantallas propias del desk activo, a un clic
          (tambien por voz: "show the market", "show my portfolio"). */}
      {desk && !wizard ? (
        <nav className="desk-dock" aria-label="Desk screens">
          <button type="button" className={deskScreen === "market" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "market" ? "" : "market")} title="Market · tokenized stocks on Base">
            <ChartIcon /><span>Market</span>
          </button>
          <button type="button" className={deskScreen === "portfolio" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "portfolio" ? "" : "portfolio")} title="Portfolio · your positions on Base">
            <WalletIcon /><span>Portfolio</span>
          </button>
          <button type="button" className={deskScreen === "notes" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "notes" ? "" : "notes")} title="Notes · what this desk remembers (local, Obsidian-compatible)">
            <NotesIcon /><span>Notes</span>
          </button>
        </nav>
      ) : null}
      {deskScreen ? (
        <DeskPanel screen={deskScreen} focus={focusAsset} onScreen={setDeskScreen} onClose={() => setDeskScreen("")} onSay={(t) => runRef.current(t)} onSummarize={() => void summarizeDay()} />
      ) : null}

      {/* El template del desk vive en el wizard (paso "Your team"): la escena
          solo se ve con equipo. Un "wake" por voz con 402 abre el pago directo. */}

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
      <div className={`transcript${split ? " on" : ""}`} aria-live="polite" ref={transcriptRef}>
        {messages.map((m) => (
          <div key={m.id} className={`turn ${m.role}`}>
            <span className="turn-k">
              {m.role === "you" ? "You" : m.role === "team" ? `${cap(m.who ?? "team")} · PerkOS` : m.role === "draft" ? "Trader · draft" : m.role === "analysis" ? `Desk · ${m.who ?? "analysis"}` : "Floor"}
              {m.verdict ? <em className={`vchip ${m.verdict.toLowerCase()}`}>{m.verdict}</em> : null}
            </span>
            {m.role === "draft" && m.draft ? (
              <DraftCard draft={m.draft} tx={m.tx ?? { stage: "idle", hashes: [] }} onApprove={() => void approveDraft(m.id)} />
            ) : m.role === "analysis" && m.analysis ? (
              <AnalysisCard a={m.analysis} onSay={(t) => runRef.current(t)} />
            ) : (
              <div className="bubble">
                {m.text}
                {m.streaming ? <i className="cursor" /> : null}
              </div>
            )}
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

function Orb({ className, label, on, state = "", rail, onRail, talking, verdict, refCb }: { className: string; label: string; on: boolean; state?: string; rail?: { linked: boolean; lockUsd: number }; onRail?: () => void; talking?: boolean; verdict?: "GO" | "BLOCK" | ""; refCb?: (el: HTMLDivElement | null) => void }) {
  const sub = talking ? "thinking…" : state === "ready" ? "PerkOS" : state === "provisioning" ? "provisioning…" : state === "waking" ? "waking…" : state === "hibernated" ? "asleep" : state === "failed" ? "failed" : state === "planned" ? "not created" : "";
  return (
    <div ref={refCb} className={`orb ${className}${on ? " on" : ""}${state ? ` st-${state}` : ""}${talking ? " talking" : ""}`} title={sub}>
      <div className="ball" />
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
      {verdict ? <em className={`verdict ${verdict.toLowerCase()}`}>{verdict}</em> : null}
      {rail ? (
        // Rail de gasto 1Claw (patron EQLTY): a color cuando esta vinculado; atenuado
        // cuando el template lo exige y aun no se conecto. Solo Trader lo tiene.
        // Sin vincular, el badge abre el paso "Spend rail" del wizard.
        <em
          className={`rail${rail.linked ? " on" : ""}`}
          title={rail.linked ? `1Claw rail linked · lock $${rail.lockUsd}` : `1Claw rail required above $${rail.lockUsd} · not linked · click to link`}
          onClick={!rail.linked && onRail ? onRail : undefined}
        >
          <img src="/1claw.svg" alt="" />1Claw
        </em>
      ) : null}
    </div>
  );
}

/** Haces entre orbs durante el turno de mesa (quien entrega -> quien recibe).
 *  Posiciones leidas del DOM para que sirvan en split y en compacto. */
function Beams({ beams, orbitRef, orbRefs }: { beams: Array<{ from: string; to: string; done: boolean }>; orbitRef: React.RefObject<HTMLDivElement | null>; orbRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const [, force] = useState(0);
  useEffect(() => {
    const onResize = () => force((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (!beams.length) return null;
  const box = orbitRef.current?.getBoundingClientRect();
  if (!box) return null;
  const center = (role: string) => {
    const el = orbRefs.current[role]?.querySelector(".ball") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  };
  return (
    <svg className="beams" aria-hidden>
      {beams.map((b, i) => {
        const a = center(b.from);
        const c = center(b.to);
        if (!a || !c) return null;
        return <line key={`${b.from}-${b.to}-${i}`} className={b.done ? "done" : ""} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />;
      })}
    </svg>
  );
}

/** Analysis card: lo verificado por Floor (precio, 24 h, pool vs Chainlink,
 *  swaps, tenencia), las noticias con fuentes y la lectura de Scout/Risk. */
function AnalysisCard({ a, onSay }: {
  a: { brief: { at: string; stock: { symbol: string; ticker: string; name: string; issuer: string }; priceUsd?: number; change24hPct?: number; range24h?: { low: number; high: number; open: number; last: number }; volume24hUsd?: number; sparkline?: number[]; pool: { fee: number; usdcDepth: number; priceUsd?: number } | null; chainlink?: { priceUsd: number; ageMin: number; stale: boolean }; premiumPct?: number; swaps24h?: { count: number; usdcVolume: number; buys: number; sells: number }; holding?: { balance: string; valueUsd: number } }; news?: { text: string; sources: Array<{ url: string; title?: string }> }; scout?: string; risk?: string; verdict?: "GO" | "BLOCK"; prev?: { priceUsd?: number; at: string }; loadingNews?: boolean };
  onSay: (t: string) => void;
}) {
  const b = a.brief;
  const sp = b.sparkline ?? [];
  const w = 420, h = 64;
  let path = "";
  if (sp.length >= 2) {
    const min = Math.min(...sp), max = Math.max(...sp), span = max - min || 1, step = w / (sp.length - 1);
    path = sp.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  }
  const up = (b.change24hPct ?? 0) >= 0;
  const ago = Math.max(0, Math.round((Date.now() - Date.parse(b.at)) / 60_000));
  const issuer = b.stock.issuer === "coinbase" ? "Coinbase B20" : b.stock.issuer;
  const tradeable = Boolean(b.pool && b.pool.usdcDepth >= 100);
  return (
    <div className={`analysis-card${a.verdict ? ` v-${a.verdict.toLowerCase()}` : ""}`}>
      <div className="an-head">
        <div>
          <b>{b.stock.name} <span>{b.stock.symbol} · {issuer}</span></b>
          <small>{b.pool ? `Uniswap V3 ${b.pool.fee / 10_000}% · $${Math.round(b.pool.usdcDepth).toLocaleString("en-US")} USDC deep` : "no USDC pool on Base"}{b.chainlink ? ` · Chainlink $${b.chainlink.priceUsd.toFixed(2)}${b.chainlink.stale ? ` (market closed, ${Math.round(b.chainlink.ageMin / 60)} h)` : ""}` : ""}{b.premiumPct !== undefined ? ` · pool ${b.premiumPct > 0 ? "+" : ""}${b.premiumPct.toFixed(2)}%` : ""}</small>
        </div>
        <div className="num">
          <b>${b.priceUsd?.toFixed(2) ?? "–"}</b>
          <small className={up ? "up" : "down"}>{b.change24hPct !== undefined ? `${b.change24hPct > 0 ? "+" : ""}${b.change24hPct.toFixed(2)}% · 24 h` : "24 h"}{a.prev?.priceUsd && b.priceUsd ? ` · ${((b.priceUsd / a.prev.priceUsd - 1) * 100) >= 0 ? "+" : ""}${((b.priceUsd / a.prev.priceUsd - 1) * 100).toFixed(2)}% since last look` : ""}</small>
        </div>
      </div>
      {path ? (
        <svg className={`spark big ${up ? "up" : "down"}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          <path className="fill" d={`${path} L${w},${h} L0,${h} Z`} />
          <path d={path} />
        </svg>
      ) : null}
      <dl className="draft-rows">
        {b.range24h ? <><dt>24 h range</dt><dd>${b.range24h.low.toFixed(2)} – ${b.range24h.high.toFixed(2)} <small>open ${b.range24h.open.toFixed(2)}</small></dd></> : null}
        {b.volume24hUsd !== undefined ? <><dt>Volume</dt><dd>${Math.round(b.volume24hUsd).toLocaleString("en-US")} <small>24 h, all venues</small></dd></> : null}
        {b.swaps24h ? <><dt>On the pool</dt><dd>{b.swaps24h.count} swaps · ${b.swaps24h.usdcVolume.toLocaleString("en-US")} <small>{b.swaps24h.buys} buys / {b.swaps24h.sells} sells</small></dd></> : null}
        <dt>You hold</dt><dd>{b.holding ? `${b.holding.balance} ${b.stock.symbol} (~$${b.holding.valueUsd.toFixed(2)})` : "none"}</dd>
      </dl>
      <div className="an-block">
        <span className="k">NEWS · GROK SEARCH</span>
        {a.loadingNews ? <p className="hint-line">Searching what moved it…</p> : a.news ? (
          <>
            <p>{a.news.text}</p>
            {a.news.sources.length ? <p className="sources">{a.news.sources.map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">[{i + 1}] {s.title || new URL(s.url).hostname}</a>)}</p> : null}
          </>
        ) : <p className="hint-line">No news found.</p>}
      </div>
      {(a.scout || a.risk) ? (
        <div className="an-block">
          <span className="k">DESK</span>
          {a.scout ? <p><b>Scout</b> {a.scout}</p> : null}
          {a.risk ? <p><b>Risk</b>{a.verdict ? <em className={`vchip ${a.verdict.toLowerCase()}`}>{a.verdict}</em> : null} {a.risk.replace(/^\s*VERDICT\s*[:\-]\s*(GO|BLOCK)\s*/i, "")}</p> : null}
        </div>
      ) : null}
      <div className="an-foot">
        <small>Updated {ago < 1 ? "just now" : `${ago} min ago`} · Uniswap Data API · Chainlink · Base RPC</small>
        <div className="draft-actions" style={{ gap: 6 }}>
          <button type="button" onClick={() => onSay(`analyze ${b.stock.ticker} again`)}>Refresh</button>
          <button type="button" disabled={!tradeable} onClick={() => onSay(`buy $5 of ${b.stock.symbol}`)}>Buy $5</button>
          {b.holding ? <button type="button" onClick={() => onSay(`sell half of my ${b.stock.symbol}`)}>Sell half</button> : null}
        </div>
      </div>
    </div>
  );
}

/** Carta del draft del Trader + orb Approve (se mantiene 2 s para firmar).
 *  Sin llaves aqui: Approve manda las tx a la wallet de la persona. */
function DraftCard({ draft, tx, onApprove }: {
  draft: { side: "buy" | "sell"; stock: { symbol: string; ticker: string; name: string; issuer: string }; tokenIn: { symbol: string; decimals: number }; tokenOut: { symbol: string; decimals: number }; amountInHuman: string; amountInUsd: number; quoteOutHuman: string; minOut: string; slippageBps: number; impliedPriceUsd: number; pool: string; fee: number; poolUsdcDepth: number; deadline: number; needsApproval: boolean; balanceUsdc: string; balanceToken: string; txs: Array<{ label: string }> };
  tx: { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; step?: string; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  onApprove: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const armed = tx.stage === "idle" || tx.stage === "failed";
  const buy = draft.side === "buy";
  const short = buy ? Number(draft.balanceUsdc) < draft.amountInUsd : Number(draft.balanceToken) < Number(draft.amountInHuman);
  const start = () => {
    if (!armed || short) return;
    setHolding(true);
    holdRef.current = window.setTimeout(() => { setHolding(false); onApprove(); }, 2000);
  };
  const cancel = () => { window.clearTimeout(holdRef.current); setHolding(false); };
  const minOutHuman = (Number(draft.minOut) / 10 ** draft.tokenOut.decimals).toFixed(buy ? 6 : 2);
  const issuer = draft.stock.issuer === "coinbase" ? "Coinbase B20" : draft.stock.issuer;
  return (
    <div className={`draft-card st-${tx.stage}`}>
      <div className="draft-head">
        <b>{buy ? `Buy $${draft.amountInUsd} of ${draft.stock.symbol}` : `Sell ${draft.amountInHuman} ${draft.stock.symbol}`}</b>
        <span className="tag">Uniswap V3 · Base</span>
      </div>
      <dl className="draft-rows">
        <dt>Asset</dt><dd>{draft.stock.name} <small>({draft.stock.ticker} · {issuer})</small></dd>
        <dt>You pay</dt><dd>{buy ? `$${draft.amountInUsd.toFixed(2)} USDC` : `${draft.amountInHuman} ${draft.stock.symbol}`}</dd>
        <dt>You get</dt><dd>≈ {draft.quoteOutHuman} {draft.tokenOut.symbol} <small>(min {minOutHuman}, {draft.slippageBps / 100}% slippage)</small></dd>
        <dt>Price</dt><dd>${draft.impliedPriceUsd.toFixed(2)} / share</dd>
        <dt>Route</dt><dd>{draft.tokenIn.symbol} → {draft.tokenOut.symbol} · pool {draft.pool.slice(0, 6)}…{draft.pool.slice(-4)} · {draft.fee / 10_000}% · ${draft.poolUsdcDepth.toFixed(0)} USDC deep</dd>
        <dt>Signatures</dt><dd>{draft.txs.map((t) => t.label).join(" + ")}{draft.needsApproval ? "" : ` (${draft.tokenIn.symbol} already approved)`}</dd>
      </dl>
      {short ? <p className="hint-line err">{buy ? `Wallet holds $${Number(draft.balanceUsdc).toFixed(2)} USDC on Base; the draft needs $${draft.amountInUsd.toFixed(2)}.` : `Wallet holds ${draft.balanceToken} ${draft.stock.symbol}; the draft needs ${draft.amountInHuman}.`}</p> : null}
      {tx.note ? <p className="hint-line err">{tx.note}</p> : null}
      {tx.hashes.length ? (
        <ul className="draft-tx">
          {tx.hashes.map((h) => (
            <li key={h.hash} className={h.status}>
              <span>{h.label}</span>
              <a href={h.explorer} target="_blank" rel="noreferrer">{h.hash.slice(0, 10)}…{h.hash.slice(-6)}</a>
              <em>{h.status === "success" ? "confirmed" : "pending"}</em>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="draft-actions">
        <button
          type="button"
          className={`approve${holding ? " holding" : ""}${tx.stage === "done" ? " done" : ""}${tx.stage === "signing" || tx.stage === "pending" ? " busy" : ""}`}
          disabled={!armed || short}
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          aria-label="Hold to approve"
        >
          <span className="ring" />
          <span className="lbl">
            {tx.stage === "done" ? "Done" : tx.stage === "blocked" ? "Blocked" : tx.stage === "signing" ? `Sign ${tx.step}…` : tx.stage === "pending" ? `${cap(tx.step ?? "")} on Base…` : tx.stage === "failed" ? "Retry" : "Hold to approve"}
          </span>
        </button>
        <small>{tx.stage === "done" ? "Receipt on Base. Your keys, your trade." : tx.stage === "blocked" ? "Risk said no. Nothing to sign." : "They draft. You sign in your wallet."}</small>
      </div>
    </div>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l5-6 4 3 4-6 5 4" />
      <path d="M3 21h18" />
    </svg>
  );
}
function NotesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h7M9 8h3" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16 14h2" />
    </svg>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

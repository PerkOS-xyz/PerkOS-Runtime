"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./apiToken";
import { parseIntent } from "./parseCommand";
import DeskPanel, { shareLaunchUrl, type DeskScreen } from "./DeskPanel";
import ChatsDrawer from "./ChatsDrawer";
import KnowledgeMap, { type GraphNode } from "./KnowledgeMap";
import { CHAINS, chainOf, ChainMark, deskManifest } from "./ChainMark";
import AgentCards, { applyTurnEvent, newTurn, type DeskTurn, type Role as AgentRole } from "./AgentCards";
import AgentAvatar, { type AgentAvatarState } from "./AgentAvatar";
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

// Burbujas de arranque sobre el compositor. En ingles, y cada una cae en un intent real:
// chat con brief de mercado, chat con la lista de pares de Bankr, analisis de la mesa (despierta al equipo), portafolio.
const STARTERS = [
  "Which tokenized stock looks best to go long today?",
  "Which stock token can I pair a new token launch with?",
  "Analyze NVDAc",
  "What is in my portfolio?"
];

export default function FloorApp() {
  return (
    <Providers>
      <Shell />
    </Providers>
  );
}

function Shell() {
  const wallet = useWallet();
  // Donde aparece la firma, en palabras: con login por QR es el celular.
  const signHint = wallet.signWhere === "phone" ? `Open ${wallet.walletName || "your wallet app"} on your phone to confirm. The request only shows while the app is open.` : wallet.signWhere === "embedded" ? "Your PerkOS wallet signs here." : "Confirm in your wallet.";
  const signShort = wallet.signWhere === "phone" ? `in ${wallet.walletName || "your wallet"} on your phone` : "in your wallet";
  useEffect(() => { if (wallet.signWhere) flog("info", `wallet signs: ${wallet.signWhere}${wallet.walletName ? ` · ${wallet.walletName}` : ""}`); }, [wallet.signWhere, wallet.walletName]);
  // Sesion viva pero sin wallet enlazada a esta ventana: se avisa antes de cualquier firma.
  const linkLost = wallet.connected && wallet.loaded && !wallet.busy && !wallet.canSign;
  useEffect(() => { if (linkLost) flog("warn", "wallet: session is alive but no wallet is linked to this window (reconnect needed)"); }, [linkLost]);
  // El texto "RPC 0x2105 Custom ...: RPC endpoint returned HTTP client error" no existe en
  // nuestras dependencias: lo emite la app de la wallet (MetaMask Mobile) cuando SU RPC de
  // Base falla, y vuelve por WalletConnect. La peticion llego al celular; el arreglo es alla.
  const WALLET_RPC = `The request reached ${wallet.walletName || "your wallet app"}, but the wallet could not reach its own RPC for Base. In the wallet: Settings, Networks, Base, set the RPC URL to https://mainnet.base.org (or remove Base and add it again), then press Retry.`;
  const LINK_LOST = "Your wallet is signed in but not linked to this window, so nothing can be signed. Sign in again with the QR, then ask for it again.";
  const [listening, setListening] = useState(false);
  const [team, setTeam] = useState<Team>("hibernated");
  // Los agentes no se muestran hasta que el equipo despierta por primera vez en la sesion:
  // tras entrar solo esta Sparky. Cuando vuelven a dormir, se quedan (ya se conocen).
  const [teamSeen, setTeamSeen] = useState(false);
  useEffect(() => { if (team !== "hibernated") setTeamSeen(true); }, [team]);
  const [guest, setGuest] = useState(false);
  const [docs, setDocs] = useState(false);
  const [market, setMarket] = useState(false);
  // Pantallas propias del desk (Market / Portfolio) y el activo enfocado.
  const [deskScreen, setDeskScreen] = useState<DeskScreen | "">("");
  // El panel del desk recarga cuando algo fuera de el movio los datos (claim, orden firmada).
  const [deskRefresh, setDeskRefresh] = useState(0);
  const [claimedTokens, setClaimedTokens] = useState<string[]>([]);
  const [deskMax, setDeskMax] = useState(false);
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
  type Draft = { id: string; chainId: number; recipient?: string; side: "buy" | "sell"; stock: { symbol: string; ticker: string; name: string; issuer: string; address: string; decimals: number }; pool: string; fee: number; poolUsdcDepth: number; tokenIn: { symbol: string; decimals: number }; tokenOut: { symbol: string; decimals: number }; amountInHuman: string; amountInUsd: number; quoteOutHuman: string; minOut: string; slippageBps: number; impliedPriceUsd: number; deadline: number; quotedAt: string; needsApproval: boolean; balanceUsdc: string; balanceToken: string; txs: Array<{ label: "approve" | "swap"; to: `0x${string}`; data: `0x${string}`; value: "0x0" }>; bankr?: { impliedPriceUsd: number; outHuman: string; outSymbol: string; feeBps: number; priceImpactBps?: number } | null; venue?: "uniswap" | "aerodrome"; venueLabel?: string; venues?: Array<{ venue: string; label: string; priceUsd: number; outHuman: string; usdcDepth: number; fee: number }> };
  type TradeIntent = { side: "buy" | "sell"; stock?: string; amountUsd?: number; amountToken?: number; fraction?: number };
  type DraftTx = { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; step?: "approve" | "swap"; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  // Launch (Bankr): un token nuevo emparejado con una accion tokenizada; la
  // persona lo despliega con Hold to launch. Las fees (95%) van a su wallet.
  type LaunchDraft = { id: string; name: string; symbol: string; description?: string; pair: { address: string; symbol: string; name: string; kind?: string; illiquid?: boolean }; recipient: { type: "wallet" | "x" | "farcaster" | "ens"; value: string }; recipientLabel: string; resolvedRecipient?: string; feeRecipient: string; ownRecipient: boolean; options: { vesting: "on" | "off"; feesIn: "both" | "quote"; degen: boolean; description?: string; image?: string; websiteUrl?: string; tweetUrl?: string }; chain: string; provider: string; deployer: string | null; ownKey: boolean; disableVesting: boolean; checks: Array<{ label: string; ok: boolean; note: string }>; ready: boolean; sim: { tokenAddress: string; poolId: string } | null; simError?: string; wallet: { evm: string; ethBase: number; club: boolean } | null; last24h: number; facts: string[]; draftedAt: string; receipt?: { tokenAddress: string; poolId: string; txHash: string; explorer: string; bankrUrl: string } };
  // Fees del creador (Bankr): lo que ganan los tokens que la persona lanzo; el claim lo firma ella.
  type FeeToken = { tokenAddress: string; name: string; symbol: string; share: string; token0Label: string; token1Label: string; claimable: { token0: string; token1: string }; claimed: { token0: string; token1: string; count: number } };
  type FeesInfo = { address: string; tokens: FeeToken[]; totals: { claimableWeth: string; claimedWeth: string; claimCount: number }; lifetimeEarnedWeth: string; at: string; only?: string };
  // Automation (Bankr): DCA, stop loss o limit que corre en Bankr desde la wallet Bankr de la persona.
  type AutoRec = { id: string; kind: "dca" | "stop" | "limit" | "schedule"; asset?: string; amountUsd?: number; interval?: string; price?: number; text: string; prompt: string; createdAt: string; status: "active" | "paused" | "cancelled"; reply?: string };
  type Brief = { at: string; stock: { symbol: string; ticker: string; name: string; issuer: string }; priceUsd?: number; change24hPct?: number; range24h?: { low: number; high: number; open: number; last: number }; volume24hUsd?: number; sparkline?: number[]; pool: { fee: number; usdcDepth: number; priceUsd?: number } | null; chainlink?: { priceUsd: number; ageMin: number; stale: boolean }; premiumPct?: number; swaps24h?: { count: number; usdcVolume: number; buys: number; sells: number }; holding?: { balance: string; valueUsd: number }; lines: string[] };
  type News = { text: string; sources: Array<{ url: string; title?: string }>; at: string };
  type Analysis = { brief: Brief; news?: News; scout?: string; risk?: string; verdict?: "GO" | "BLOCK"; prev?: { priceUsd?: number; at: string }; loadingNews?: boolean };
  type Msg = { id: number; role: "you" | "floor" | "team" | "draft" | "analysis"; who?: string; text: string; streaming?: boolean; draft?: Draft; launch?: LaunchDraft; auto?: AutoRec; fees?: FeesInfo; tx?: DraftTx; verdict?: "GO" | "BLOCK"; analysis?: Analysis; turnId?: number; kind?: "open" | "side" | "status" };
  // Agent graph del turno en curso (cards bajo las esferas) y turnos plegados.
  const [turn, setTurn] = useState<DeskTurn | null>(null);
  const turnRef = useRef<DeskTurn | null>(null);
  turnRef.current = turn;
  const turnLiveRef = useRef(false);
  // Modo del turno: orden / analisis de un activo / asesoria abierta / charla (sin mesa).
  const modeRef = useRef<"order" | "analyze" | "advise" | "launch" | "chat">("chat");
  const lastRepliesRef = useRef<Array<{ role: string; ok: boolean; reply: string }>>([]);
  const [openTurns, setOpenTurns] = useState<number[]>([]);
  const decisionRef = useRef<{ turnId: number; noteId?: string; draftId?: number } | null>(null);
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
  type DeskTemplate = { id: string; revision: number; name: string; description: string; idleMinutes: number; chain?: string; agents: Array<{ role: string; name: string; duty: string }> };
  const [perkos, setPerkos] = useState<{ connected: boolean; busy: boolean; fundingUrl: string; note: string }>({ connected: false, busy: false, fundingUrl: "", note: "" });
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const fleetRef = useRef<Fleet | null>(null);
  fleetRef.current = fleet;
  const fleetAtRef = useRef(0);
  const fleetActionRef = useRef<(action: "status" | "wake" | "hibernate") => Promise<Fleet | null | undefined>>(async () => null);
  const perkosRef = useRef(perkos);
  perkosRef.current = perkos;
  const [messages, setMessages] = useState<Msg[]>([]);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  // Historial de chat como en cualquier app de chat: hilos guardados en disco (cifrados
  // con la llave de la wallet, ver lib/chatKey.ts), autoguardado, chat nuevo y lista para
  // reabrir. Al abrir el app vuelve el ultimo hilo, cerrado detras de "Show chat".
  const [threadId, setThreadId] = useState("");
  const threadRef = useRef("");
  threadRef.current = threadId;
  const [historyLocked, setHistoryLocked] = useState(false);
  const [chatsKey, setChatsKey] = useState(0);
  const [chatsOpen, setChatsOpen] = useState(false);
  const savedSigRef = useRef("");
  const keepable = (list: Msg[]) => list.filter((x) => !x.streaming && (x.text || x.draft || x.launch || x.auto || x.fees || x.analysis)).slice(-200);
  // Los drafts sin aprobar de otra sesion vuelven vencidos: su cotizacion ya no vale.
  const restoreMsgs = (saved: Msg[]): Msg[] => saved.filter((x) => x && typeof x.id === "number").map((x) => ({ ...x, streaming: false, ...(x.role === "draft" && x.tx && ["idle", "signing", "pending"].includes(x.tx.stage) && (x.draft || x.launch || x.auto) ? { tx: { ...x.tx, stage: "failed" as const, note: "From an earlier session. Ask for it again to get a fresh draft." } } : {}) }));
  const openChat = useCallback(async (id: string, show = true) => {
    const r = await fetch(`/api/chats?id=${encodeURIComponent(id)}`).catch(() => null);
    if (!r) return;
    if (r.status === 428) { setHistoryLocked(true); return; }
    const t = (await r.json().catch(() => ({}))) as { messages?: Msg[]; title?: string };
    if (!Array.isArray(t.messages)) return;
    const back = restoreMsgs(t.messages);
    savedSigRef.current = JSON.stringify(keepable(back));
    setMessages(back);
    setThreadId(id);
    flog("info", `chat: opened "${t.title ?? id}" · ${back.length} messages`);
    if (show) touchRef.current();
  }, []);
  const chatsLoadedFor = useRef("");
  const loadLatestChat = useCallback(async () => {
    const r = await fetch("/api/chats").catch(() => null);
    if (!r) return;
    if (r.status === 428) { setHistoryLocked(true); flog("info", "chat history: locked, waiting for the wallet to unlock it once on this computer"); return; }
    setHistoryLocked(false);
    // Tras entrar, la escena arranca limpia: el ultimo hilo no se reabre solo (queda
    // en Chats, a un clic). Revision del 2026-09-17.
    await r.json().catch(() => ({}));
  }, []);
  useEffect(() => {
    const addr = wallet.address.toLowerCase();
    if (!addr || chatsLoadedFor.current === addr) return;
    chatsLoadedFor.current = addr;
    void loadLatestChat();
  }, [wallet.address, loadLatestChat]);
  // Autoguardado: 1.2 s despues del ultimo cambio, solo si el contenido cambio.
  useEffect(() => {
    if (!wallet.address || historyLocked || chatsLoadedFor.current !== wallet.address.toLowerCase()) return;
    const t = window.setTimeout(() => {
      const keep = keepable(messages);
      const sig = JSON.stringify(keep);
      if (!keep.length || sig === savedSigRef.current) return;
      let id = threadRef.current;
      if (!id) { id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; threadRef.current = id; setThreadId(id); }
      void fetch(`/api/chats?id=${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: keep, desk: deskRef.current?.id ?? "floor-desk" }) })
        .then((r) => { if (r.status === 428) setHistoryLocked(true); else if (r.ok) { savedSigRef.current = sig; setChatsKey((n) => n + 1); } })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [messages, wallet.address, historyLocked]);
  // Una firma, una vez por computadora: deriva la llave del historial (queda en el Llavero).
  const unlockHistory = useCallback(async () => {
    try {
      const probe = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (probe.ok) { setHistoryLocked(false); void loadLatestChat(); return; }
      const need = (await probe.json().catch(() => ({}))) as { message?: string };
      if (!need.message) return;
      setCaption(wallet.signWhere === "phone" ? `Confirm the history key in ${wallet.walletName || "your wallet"} on your phone…` : "Confirm the history key in your wallet…");
      const signature = await wallet.signMessage(need.message);
      const r = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature }) });
      if (r.ok) { setHistoryLocked(false); setCaption("Chat history unlocked. It is saved encrypted on this computer."); flog("info", "chat history: unlocked with a wallet signature"); void loadLatestChat(); setChatsKey((n) => n + 1); }
      else { const e = (await r.json().catch(() => ({}))) as { detail?: string }; setCaption(e.detail ?? "Could not unlock the chat history."); }
    } catch (e) { flog("warn", `chat history unlock: ${(e as Error).message}`); setCaption("The history key was not signed."); }
  }, [wallet, loadLatestChat]);
  // Chat nuevo: el hilo actual ya esta guardado; la escena vuelve a reposo con el tablero limpio.
  const newChatRef = useRef<() => void>(() => undefined);
  const [split, setSplit] = useState(false);
  const idleTimer = useRef<number>(0);
  const voiceRef = useRef<{ continuous: boolean; listening: boolean } | null>(null);
  const touchRef = useRef<() => void>(() => undefined);
  // Mientras Floor trabaja (scan, noticias, warm-up, turno, respuesta) el chat
  // no se cierra: antes el temporizador de 2 min lo cerraba a mitad de un
  // turno largo y las cards quedaban sin transcript.
  const busyRef = useRef(false);
  const touch = useCallback(() => {
    setSplit(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      // En conversacion continua o hablando, la charla sigue viva: no volver a idle.
      if (voiceRef.current?.continuous || voiceRef.current?.listening || busyRef.current) { touchRef.current(); return; }
      // Con una card esperando a la persona (orden, launch, claim o automatizacion sin aprobar,
      // o una firma en curso) el chat no se esconde: ahi esta el boton.
      const waiting = messagesRef.current.some((x) => x.role === "draft" && x.tx && ["idle", "signing", "pending"].includes(x.tx.stage) && (x.draft || x.launch || x.auto || (x.fees && x.fees.tokens.some((t) => Number(t.claimable.token0) > 0 || Number(t.claimable.token1) > 0))));
      if (waiting) { touchRef.current(); return; }
      setSplit(false);
    }, 120_000);
  }, []);
  const askRef = useRef<HTMLInputElement | null>(null);
  // Autoscroll del transcript (patron de chat): pegado al final mientras la
  // persona no suba a leer; si sube, aparece el boton circular "ir al final".
  // Observadores de mutacion y tamano cubren el streaming y las cards que
  // crecen despues de montarse (draft, analysis), no solo los turnos nuevos.
  // Solo un gesto de la persona (rueda, touch, teclado) despega el
  // transcript del final: el scroll programatico tambien dispara "scroll" y
  // leerlo como intencion hacia arriba era lo que cortaba el seguimiento.
  // Seguimiento suave (scrollTo smooth, coalescido por frame) y un
  // asentamiento 2 s despues del ultimo cambio, cuando ya termino de tipear.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const observedRef = useRef<HTMLDivElement | null>(null);
  const userGestureAt = useRef(0);
  const followRaf = useRef(0);
  const settleTimer = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const followLatest = useCallback((smooth = true) => {
    const el = transcriptRef.current;
    if (!el || !stickRef.current) return;
    if (followRaf.current) return;
    followRaf.current = requestAnimationFrame(() => {
      followRaf.current = 0;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => { if (stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, 2000);
  }, []);
  const scrollToLatest = useCallback(() => {
    stickRef.current = true;
    setShowJump(false);
    followLatest(true);
  }, [followLatest]);
  const markUserGesture = useCallback(() => { userGestureAt.current = Date.now(); }, []);
  const onTranscriptKey = useCallback((e: React.KeyboardEvent) => { if (["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End"].includes(e.key)) userGestureAt.current = Date.now(); }, []);
  const onTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 48) { stickRef.current = true; setShowJump(false); return; }
    if (Date.now() - userGestureAt.current < 600) { stickRef.current = false; setShowJump(true); }
  }, []);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    followLatest(true);
    if (observedRef.current === el) return;
    observedRef.current = el;
    const mo = new MutationObserver(() => followLatest(true));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(() => followLatest(true));
    ro.observe(el);
    return () => { mo.disconnect(); ro.disconnect(); observedRef.current = null; };
  }, [messages, followLatest]);

  const kbWriteRef = useRef<(p: { journal?: true; kind?: "journal" | "analysis" | "order" | "memory" | "decision"; title?: string; body: string; ticker?: string }) => void>(() => undefined);
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
  const chat = useCallback(async (text: string, opts: { youId?: number } = {}) => {
    abortChat();
    beginTurn();
    const ac = new AbortController();
    chatAbort.current = ac;
    setThinking(true);
    setStreaming(true);
    setCaption("");
    busyRef.current = true;
    touch();
    // Si el pedido ya esta en el hilo (advise lo muestra antes del scan), se reutiliza.
    const youId = opts.youId ?? Date.now();
    const floorId = Date.now() + 1;
    setMessages((m) => [...m.filter((x) => !(x.id === youId + 1 && x.role === "floor" && x.kind === "status")).slice(-60), ...(opts.youId ? [] : [{ id: youId, role: "you" as const, text, turnId: youId }]), { id: floorId, role: "floor" as const, text: "", streaming: true, turnId: youId }]);
    const setFloor = (t: string, streaming: boolean) =>
      setMessages((m) => m.map((x) => (x.id === floorId ? { ...x, text: t, streaming } : x)));
    flog("info", `chat -> ${text.slice(0, 80)}`);
    stickRef.current = true;
    setShowJump(false);
    let full = "";
    let pending = "";
    try {
      // Con la flota despierta, primero responden los agentes (Hermes en PerkOS
      // infra) y Grok, la voz del Floor, resume. Sin flota: Grok solo.
      let fleetReplies: Array<{ role: string; ok: boolean; reply: string; detail?: string }> = [];
      // Warm-up: el curator hiberna la flota a los 15 min y el snapshot local
      // puede ser viejo. Refrescar, despertar si duerme y esperar a que los
      // agentes esten listos antes de preguntar; si no, el turno son 4 timeouts.
      let f0 = fleetRef.current;
      if (f0 && Date.now() - fleetAtRef.current > 60_000) f0 = (await fleetActionRef.current("status")) ?? f0;
      const asleep = (x: Fleet | null | undefined) => Boolean(x && x.agents.some((a) => a.state === "hibernated" || a.state === "waking"));
      // Regla: los agentes solo se despiertan cuando se les asigna una tarea (analyze, advise,
      // una orden, un launch). En modo chat Sparky contesta cualquier consulta por su cuenta y
      // el equipo sigue dormido: despertarlo cuesta infra y tiempo, y no aporta a la respuesta.
      if (asleep(f0) && modeRef.current === "chat") {
        flog("info", "chat: Sparky answers on its own; the team stays asleep (no task assigned)");
      } else if (asleep(f0)) {
        setCaption("Waking the team on PerkOS…");
        setTeam("waking");
        f0 = (await fleetActionRef.current("wake")) ?? f0;
        const t0 = Date.now();
        while (asleep(f0) && Date.now() - t0 < 240_000 && !ac.signal.aborted) {
          await new Promise((r) => setTimeout(r, 5000));
          f0 = (await fleetActionRef.current("status")) ?? f0;
        }
        if (!asleep(f0) && !ac.signal.aborted) {
          // ECS ya corre; Hermes tarda ~40 s mas en unirse al relay.
          setCaption("Team is booting…");
          await new Promise((r) => setTimeout(r, 40_000));
        }
      }
      const f = f0;
      // Charla sin hechos (small talk, preguntas sobre el desk): responde solo Floor.
      const readyRoles = modeRef.current === "chat" ? [] : f ? f.agents.filter((a) => a.state === "ready").map((a) => a.role) : [];
      if (readyRoles.length) {
        // Turno de mesa secuencial (Scout -> Risk -> Trader/Auditor) por SSE:
        // cada agente habla en su orb y deja su burbuja; Risk decide.
        setCaption("The desk is working…");
        setBeams([]);
        setVerdict("");
        const t1 = Date.now();
        const quote = quoteRef.current;
        // Agent graph: una card por rol bajo su esfera, movida por los eventos reales.
        const latestBrief = [...messagesRef.current].reverse().find((m) => m.role === "analysis")?.analysis?.brief;
        const facts = latestBrief ? { premiumPct: latestBrief.premiumPct, change24hPct: latestBrief.change24hPct, swaps24h: latestBrief.swaps24h?.count, chainlinkUsd: latestBrief.chainlink?.priceUsd } : null;
        let turnLocal = newTurn(youId, text, readyRoles, quote ? { side: quote.side, symbol: quote.symbol, name: quote.name, amountIn: quote.amountIn, tokenIn: quote.tokenIn, quoteOut: quote.quoteOut, tokenOut: quote.tokenOut, priceUsd: quote.priceUsd, bankr: quote.bankr ? { priceUsd: quote.bankr.priceUsd } : null, venue: quote.venue } : null, facts);
        setTurn(turnLocal);
        turnLiveRef.current = true;
        decisionRef.current = { turnId: youId, draftId: heldDraftRef.current?.id ?? [...messagesRef.current].reverse().find((m) => m.role === "draft" && m.tx?.stage === "idle")?.id };
        // Floor abre el hilo como principal: a quien le habla y con que hechos.
        const held = heldDraftRef.current?.launch;
        const factBits = [held ? `launch ${held.symbol} paired with ${held.pair.symbol}, ${held.checks.filter((c) => c.ok).length}/${held.checks.length} checks pass` : "", quote ? `Uniswap $${quote.priceUsd.toFixed(2)}` : "", quote?.bankr ? `Bankr $${quote.bankr.priceUsd.toFixed(2)}` : "", facts?.chainlinkUsd ? `Chainlink $${facts.chainlinkUsd.toFixed(2)}` : "", facts?.swaps24h !== undefined ? `${facts.swaps24h} swaps in 24h` : ""].filter(Boolean);
        const openLine = `@Scout @Risk ${text}${factBits.length ? `. Facts attached: ${factBits.join(", ")}.` : "."}`;
        setMessages((m) => [...m.filter((x) => x.id !== floorId), { id: youId + 90, role: "floor", kind: "open", text: openLine, turnId: youId }, { id: floorId, role: "floor", text: "", streaming: true, turnId: youId }]);
        const fr = await fetch("/api/fleet/desk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, roles: readyRoles, quote, brief: briefRef.current?.lines ?? null, news: briefRef.current?.news ?? null, mode: modeRef.current }),
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
              let ev: { step?: string; role?: string; ok?: boolean; reply?: string; detail?: string; ms?: number; verdict?: "GO" | "BLOCK"; replies?: typeof fleetReplies; flags?: string[] };
              try { ev = JSON.parse(line); } catch { continue; }
              const phId = (role: string) => youId + 100 + ["scout", "risk", "trader", "auditor"].indexOf(role);
              if (ev.step === "start" || ev.step === "reply" || ev.step === "done") {
                turnLocal = applyTurnEvent(turnLocal, ev);
                const snap = turnLocal;
                setTurn((t) => (t && t.id === youId ? snap : t));
              }
              if (ev.step === "start" && ev.role) {
                setTalking(ev.role, true);
                setCaption(`${cap(ev.role)} is thinking…`);
                // Burbuja "escribiendo" del agente hasta que llegue su respuesta.
                const pid = phId(ev.role);
                const who = ev.role;
                setMessages((m) => [...m.filter((x) => x.id !== floorId && x.id !== pid), { id: pid, role: "team", who, text: "", streaming: true, turnId: youId }, { id: floorId, role: "floor", text: "", streaming: true, turnId: youId }]);
                // Scout y Risk entregan a Trader y Auditor: los haces salen de quien ya hablo.
                if (ev.role === "trader" || ev.role === "auditor") setBeams((b) => [...b, ...handed.map((from) => ({ from, to: ev.role!, done: false }))]);
              } else if (ev.step === "reply" && ev.role) {
                setTalking(ev.role, false);
                { const pid = phId(ev.role); setMessages((m) => m.filter((x) => x.id !== pid)); }

                if (ev.ok && ev.reply) {
                  n += 1;
                  const id = youId + 2 + n;
                  const r = ev.role;
                  setMessages((m) => [...m.filter((x) => x.id !== floorId), { id, role: "team", who: r, text: ev.reply!, verdict: ev.verdict, turnId: youId }, { id: floorId, role: "floor", text: "", streaming: true, turnId: youId }]);
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
                      if (heldDraftRef.current?.tx?.stage === "idle") heldDraftRef.current = { ...heldDraftRef.current, tx: { ...heldDraftRef.current.tx, stage: "blocked", note: `Risk blocked: ${why.slice(0, 200)}` } };
                      setMessages((m) => m.map((x) => (x.role === "draft" && x.tx && (x.tx.stage === "idle") ? { ...x, tx: { ...x.tx, stage: "blocked", note: `Risk blocked: ${why.slice(0, 200)}` } } : x)));
                      setCaption(modeRef.current === "launch" ? "Risk blocked the launch." : "Risk blocked the order.");
                      const qd = quoteRef.current;
                      if (qd) kbWriteRef.current({ kind: "order", ticker: qd.symbol.replace(/c$/i, ""), title: `blocked ${qd.side} ${qd.amountIn} ${qd.tokenIn} ${qd.symbol} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, body: `- ${qd.side} ${qd.amountIn} ${qd.tokenIn} -> ${qd.quoteOut} ${qd.tokenOut} at $${qd.priceUsd.toFixed(2)}\n- Risk: BLOCK. ${why.slice(0, 600)}` });
                    }
                  }
                } else {
                  flog("warn", `desk ${ev.role}: ${ev.detail || "no answer"}`);
                }
              } else if (ev.step === "done") {
                fleetReplies = ev.replies ?? [];
                lastRepliesRef.current = fleetReplies;
                if (ev.flags && ev.flags.length) flog("warn", `desk quality: ${ev.flags.join(" · ")}`); else flog("info", "desk quality: clean");
                turnLiveRef.current = false;
                // Las cards se leen 2 s y se contraen a chips; la decision queda guardada.
                window.setTimeout(() => setTurn((t) => (t && t.id === youId ? { ...t, collapsed: true } : t)), 2000);
                {
                  const d = turnLocal;
                  const q = d.quote;
                  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
                  const title = q ? `${stamp} ${q.side} ${q.amountIn} ${q.tokenIn} ${q.symbol}` : `${stamp} ${text.slice(0, 40)}`;
                  const who = (["scout", "risk", "trader", "auditor"] as const).map((r) => `- **${cap(r)}** (${d.agents[r].state}${d.agents[r].ms ? `, ${(d.agents[r].ms! / 1000).toFixed(1)} s` : ""}): ${(d.agents[r].text ?? "").replace(/\s+/g, " ").slice(0, 700)}`).join("\n");
                  const body = `**Asked**: ${text}\n**Verdict**: ${d.verdict ?? "none"}\n${q ? `**Order**: ${q.side} ${q.amountIn} ${q.tokenIn} -> ${q.quoteOut} ${q.tokenOut} at $${q.priceUsd.toFixed(2)}${q.bankr ? ` (Bankr $${q.bankr.priceUsd.toFixed(2)})` : ""}\n` : ""}\n${who}\n\n\`\`\`json\n${JSON.stringify({ ...d, live: false, collapsed: true })}\n\`\`\``;
                  kbWriteRef.current({ kind: "decision", title, body, ticker: q?.symbol?.replace(/c$/i, "") });
                }
                setBeams((b) => b.map((x) => ({ ...x, done: true })));
                // Los haces se apagan solos al cerrar el turno (antes quedaban dibujados).
                window.setTimeout(() => setBeams([]), 1500);
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
      // La tarjeta de decision cierra el turno: entra cuando Floor termino su evaluacion.
      releaseDraft(youId);
      // Diario del desk: la pregunta, lo que dijo el equipo y la respuesta.
      const teamLines = fleetReplies.filter((r) => r.ok && r.reply).map((r) => `- **${cap(r.role)}**: ${r.reply.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
      kbWriteRef.current({ journal: true, body: `**You**: ${text}\n${teamLines ? `${teamLines}\n` : ""}- **Sparky**: ${full.replace(/\s+/g, " ").slice(0, 900)}` });
    } catch (e) {
      if ((e as Error).name !== "AbortError") flog("error", `chat: ${(e as Error).message}`);
      setMessages((m) => m.map((x) => (x.id === floorId ? { ...x, streaming: false } : x)));
      releaseDraft(youId);
    } finally {
      setThinking(false);
      setStreaming(false);
      busyRef.current = false;
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
    fleetAtRef.current = Date.now();
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
      // Latido lento: si el curator duerme la flota, los tags pasan a Hibernating.
      if (f.status === "ready") pollRef.current = window.setTimeout(() => void fleetAction("status"), 60_000);
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
  // El menu del desk se cierra con click fuera o Escape, como cualquier dropdown.
  useEffect(() => {
    if (!deskMenu) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.(".deskpick")) setDeskMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDeskMenu(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [deskMenu]);
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
      return j;
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
  const quoteRef = useRef<{ side: string; symbol: string; name: string; amountIn: string; tokenIn: string; quoteOut: string; tokenOut: string; priceUsd: number; pool: string; fee: number; poolUsdcDepth: number; minOut: string; bankr?: { priceUsd: number; outHuman: string; outSymbol: string; feeBps: number; priceImpactBps?: number } | null; venue?: string; venues?: Array<{ label: string; priceUsd: number; usdcDepth: number }> } | null>(null);
  // El draft se retiene hasta que Trader entrega (o el turno cierra): la
  // tarjeta de compra se lee al final del analisis, no antes.
  const heldDraftRef = useRef<Msg | null>(null);
  const releaseDraft = useCallback((turnId?: number, floorId?: number) => {
    const d = heldDraftRef.current;
    if (!d) return;
    heldDraftRef.current = null;
    const msg = { ...d, turnId };
    setMessages((m) => {
      const rest = floorId ? m.filter((x) => x.id !== floorId) : m;
      const floor = floorId ? m.find((x) => x.id === floorId) : undefined;
      return floor ? [...rest, msg, floor] : [...rest, msg];
    });
    if (d.draft) setCaption(`Trader drafted: ${d.draft.amountInHuman} ${d.draft.tokenIn.symbol} → ${d.draft.quoteOutHuman} ${d.draft.tokenOut.symbol}. Hold Approve to sign.`);
  }, []);
  const tradeDraft = useCallback(async (intent: TradeIntent) => {
    const id = Date.now() + 3;
    const what = intent.stock ?? "NVDAc";
    const size = intent.side === "buy" ? `$${intent.amountUsd}` : intent.fraction === 1 ? "all your" : intent.fraction ? `${Math.round(intent.fraction * 100)}% of your` : intent.amountToken ? `${intent.amountToken}` : `$${intent.amountUsd} of`;
    heldDraftRef.current = null;
    setCaption(`Trader is drafting: ${intent.side} ${size} ${what}…`);
    touch();
    try {
      const res = await fetch("/api/trade/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent) });
      const j = (await res.json().catch(() => ({}))) as Draft & { error?: string; detail?: string };
      if (!res.ok || !j.txs) {
        flog("error", `trade draft ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: `Could not draft the trade: ${j.detail ?? j.error ?? res.status}` }]);
        return;
      }
      flog("info", `trade draft: ${j.side} ${j.amountInHuman} ${j.tokenIn.symbol} → ${j.quoteOutHuman} ${j.tokenOut.symbol} @ $${j.impliedPriceUsd.toFixed(2)} · pool $${j.poolUsdcDepth.toFixed(0)} · ${j.txs.length} tx · balances $${j.balanceUsdc} / ${j.balanceToken} ${j.stock.symbol}`);
      heldDraftRef.current = { id, role: "draft", who: "trader", text: "", draft: j, tx: { stage: "idle", hashes: [] } };
      quoteRef.current = { side: j.side, symbol: j.stock.symbol, name: j.stock.name, amountIn: j.amountInHuman, tokenIn: j.tokenIn.symbol, quoteOut: j.quoteOutHuman, tokenOut: j.tokenOut.symbol, priceUsd: j.impliedPriceUsd, pool: j.pool, fee: j.fee, poolUsdcDepth: j.poolUsdcDepth, minOut: (Number(j.minOut) / 10 ** j.tokenOut.decimals).toFixed(6), bankr: j.bankr ? { priceUsd: j.bankr.impliedPriceUsd, outHuman: j.bankr.outHuman, outSymbol: j.bankr.outSymbol, feeBps: j.bankr.feeBps, priceImpactBps: j.bankr.priceImpactBps } : null, venue: j.venueLabel, venues: (j.venues ?? []).map((v) => ({ label: v.label, priceUsd: v.priceUsd, usdcDepth: v.usdcDepth })) };
      flog("info", `venue: ${j.venueLabel ?? "?"} · ${(j.venues ?? []).map((v) => `${v.label} $${v.priceUsd.toFixed(2)} ($${Math.round(v.usdcDepth)} deep)`).join(" · ")}`);
      if (j.bankr) flog("info", `bankr quote: ${j.bankr.outHuman} ${j.bankr.outSymbol} @ $${j.bankr.impliedPriceUsd.toFixed(2)} vs uniswap $${j.impliedPriceUsd.toFixed(2)}`);
      setCaption("Order on the table. The desk is reviewing it…");
    } catch (e) {
      flog("error", `trade draft: ${(e as Error).message}`);
      setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: "Could not draft the trade." }]);
    }
  }, [touch]);

  // Launch: Bankr simula el token emparejado (nombre, simbolo, accion) y la
  // mesa lo revisa; la card se libera cuando Trader entrega, como una orden.
  const launchDraft = useCallback(async (it: { name?: string; symbol?: string; pair?: string; recipient?: string; vesting?: "on" | "off"; feesIn?: "quote"; degen?: boolean }): Promise<boolean> => {
    const id = Date.now() + 4;
    const symbol = (it.symbol ?? (it.name ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8)).toUpperCase();
    const name = it.name ?? symbol;
    heldDraftRef.current = null;
    setCaption(`Trader is drafting the launch: ${name} (${symbol}) paired with ${it.pair}${it.recipient ? `, fees to ${it.recipient}` : ""}…`);
    touch();
    try {
      const res = await fetch("/api/launch/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, symbol, pair: it.pair, recipient: it.recipient, vesting: it.vesting, feesIn: it.feesIn, degen: it.degen === true }) });
      const j = (await res.json().catch(() => ({}))) as LaunchDraft & { error?: string; detail?: string };
      if (!res.ok || !j.checks) {
        flog("error", `launch draft ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: `Could not draft the launch: ${j.detail ?? j.error ?? res.status}` }]);
        setCaption("");
        return false;
      }
      flog("info", `launch draft: ${j.symbol} paired with ${j.pair.symbol} · fees to ${j.recipientLabel}${j.resolvedRecipient ? ` (${j.resolvedRecipient.slice(0, 8)})` : ""} · vesting ${j.options.vesting} · fees in ${j.options.feesIn}${j.options.degen ? " · degen" : ""} · checks ${j.checks.filter((c) => c.ok).length}/${j.checks.length} · sim ${j.sim ? j.sim.tokenAddress : j.simError ?? "skipped"} · ${j.ownKey ? "own key" : "operator key"}`);
      heldDraftRef.current = { id, role: "draft", who: "trader", text: "", launch: j, tx: { stage: "idle", hashes: [] } };
      quoteRef.current = null;
      briefRef.current = { lines: j.facts };
      setCaption(j.ready ? `Launch on the table, fees to ${j.ownRecipient ? "your wallet" : j.recipientLabel}. The desk is reviewing it…` : "Launch drafted, a check failed. The desk is reviewing it…");
      return true;
    } catch (e) {
      flog("error", `launch draft: ${(e as Error).message}`);
      setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: "Could not draft the launch." }]);
      return false;
    }
  }, [touch]);
  const deployLaunch = useCallback(async (msgId: number) => {
    const msg = messagesRef.current.find((x) => x.id === msgId);
    const d = msg?.launch;
    if (!d || (msg?.tx && msg.tx.stage !== "idle" && msg.tx.stage !== "failed")) return;
    const patch = (tx: Partial<DraftTx>, more?: Partial<Msg>) => setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, ...more, tx: { ...(x.tx ?? { stage: "idle", hashes: [] }), ...tx } as DraftTx } : x)));
    patch({ stage: "pending", note: undefined });
    setCaption(`Bankr is deploying ${d.symbol} on Base…`);
    try {
      const res = await fetch("/api/launch/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: d.name, symbol: d.symbol, pairAddress: d.pair.address, recipient: d.recipient, options: d.options, description: d.description }) });
      const j = (await res.json().catch(() => ({}))) as { tokenAddress?: string; poolId?: string; txHash?: string; explorer?: string; bankrUrl?: string; error?: string; detail?: string };
      if (!res.ok || !j.tokenAddress) {
        flog("error", `launch deploy ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        patch({ stage: "failed", note: `Bankr could not deploy: ${j.detail ?? j.error ?? res.status}` });
        setCaption("Launch failed. Nothing deployed.");
        return;
      }
      flog("info", `launched ${d.symbol}: ${j.tokenAddress} · tx ${j.txHash}`);
      patch({ stage: "done", hashes: j.txHash ? [{ label: "deploy", hash: j.txHash, status: "success", explorer: j.explorer ?? `https://basescan.org/tx/${j.txHash}` }] : [] }, { launch: { ...d, receipt: { tokenAddress: j.tokenAddress, poolId: j.poolId ?? "", txHash: j.txHash ?? "", explorer: j.explorer ?? "", bankrUrl: j.bankrUrl ?? "" } } });
      setCaption(`${d.symbol} is live on Base, paired with ${d.pair.symbol}. Fees pay to ${d.ownRecipient ? "your wallet" : d.recipientLabel}.`);
    } catch (e) {
      flog("error", `launch deploy: ${(e as Error).message}`);
      patch({ stage: "failed", note: "Bankr did not answer." });
    }
  }, []);
  // Automation: Floor redacta el prompt para Bankr (DCA, stop, limit); la
  // persona lo crea con Hold to create. Sin turno de mesa: es una regla, no una decision.
  const automationDraft = useCallback(async (text: string) => {
    const id = Date.now() + 5;
    setCaption("Trader is drafting the automation…");
    touch();
    try {
      const res = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", text }) });
      const j = (await res.json().catch(() => ({}))) as AutoRec & { error?: string; detail?: string };
      if (!res.ok || !j.prompt) {
        flog("warn", `automation draft ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: `Could not draft the automation: ${j.detail ?? j.error ?? res.status}` }]);
        setCaption("");
        return;
      }
      flog("info", `automation draft: ${j.prompt}`);
      setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: "", auto: j, tx: { stage: "idle", hashes: [] } }]);
      setCaption("Automation on the table. Hold to create it in Bankr.");
    } catch (e) {
      flog("error", `automation draft: ${(e as Error).message}`);
      setCaption("");
    }
  }, [touch]);
  const createAutomation = useCallback(async (msgId: number) => {
    const msg = messagesRef.current.find((x) => x.id === msgId);
    const a = msg?.auto;
    if (!a || (msg?.tx && msg.tx.stage !== "idle" && msg.tx.stage !== "failed")) return;
    const patch = (tx: Partial<DraftTx>, more?: Partial<Msg>) => setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, ...more, tx: { ...(x.tx ?? { stage: "idle", hashes: [] }), ...tx } as DraftTx } : x)));
    patch({ stage: "pending", note: undefined });
    setCaption("Bankr is setting up the automation…");
    try {
      const res = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", draft: a }) });
      const j = (await res.json().catch(() => ({}))) as AutoRec & { error?: string; detail?: string };
      if (!res.ok || !j.id) {
        flog("error", `automation create ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        patch({ stage: "failed", note: `Bankr could not set it up: ${j.detail ?? j.error ?? res.status}` });
        setCaption("Automation not created.");
        return;
      }
      flog("info", `automation ${j.status}: ${j.prompt} · Bankr: ${(j.reply ?? "").slice(0, 160)}`);
      patch({ stage: j.status === "active" ? "done" : "failed", note: j.status === "active" ? undefined : `Bankr said: ${(j.reply ?? "").slice(0, 300)}` }, { auto: j });
      setCaption(j.status === "active" ? "Automation is live in Bankr." : "Bankr could not set it up. Read its reply.");
    } catch (e) {
      flog("error", `automation create: ${(e as Error).message}`);
      patch({ stage: "failed", note: "Bankr did not answer." });
    }
  }, []);

  // Fees card: lectura publica de Bankr para la wallet conectada; una card por consulta.
  const feesCard = useCallback(async (msgId?: number, only?: string): Promise<number | undefined> => {
    const id = msgId ?? Date.now() + 6;
    if (!msgId) { setCaption("Reading your creator fees…"); touch(); }
    try {
      const res = await fetch("/api/fees");
      const j = (await res.json().catch(() => ({}))) as FeesInfo & { error?: string; detail?: string };
      // Una sola card para un token: "claim fees for OWL" o el boton Claim de la pantalla Launches.
      const filter = only ?? (msgId ? messagesRef.current.find((x) => x.id === msgId)?.fees?.only : undefined);
      if (Array.isArray(j.tokens) && filter) {
        const f = filter.toLowerCase();
        j.tokens = j.tokens.filter((t) => t.symbol.toLowerCase() === f || t.tokenAddress.toLowerCase() === f);
        j.totals = { claimableWeth: j.totals?.claimableWeth ?? "0", claimedWeth: j.totals?.claimedWeth ?? "0", claimCount: j.tokens.reduce((n, t) => n + (t.claimed?.count ?? 0), 0) };
      }
      if (!res.ok || !Array.isArray(j.tokens)) {
        flog("warn", `fees ${res.status}: ${j.error ?? ""} ${j.detail ?? ""}`);
        if (!msgId) setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: `Could not read your fees: ${j.detail ?? j.error ?? res.status}` }]);
        setCaption("");
        return undefined;
      }
      const info: FeesInfo = { ...j, at: new Date().toISOString(), only: filter };
      const claimable = info.tokens.filter((t) => Number(t.claimable.token0) > 0 || Number(t.claimable.token1) > 0).length;
      flog("info", `fees: ${info.tokens.length} tokens · ${claimable} claimable · ${info.totals.claimableWeth} WETH claimable · ${info.totals.claimedWeth} claimed`);
      if (msgId) setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, fees: info } : x)));
      else setMessages((m) => [...m.slice(-60), { id, role: "draft", who: "trader", text: "", fees: info, tx: { stage: "idle", hashes: [] } }]);
      if (!msgId) setCaption(info.tokens.length === 0 ? "No launches paying fees to this wallet yet." : claimable ? `${claimable} token${claimable > 1 ? "s" : ""} with fees to claim. Hold to claim.` : "Fees are accruing. Nothing to claim yet.");
      return id;
    } catch (e) {
      flog("error", `fees: ${(e as Error).message}`);
      setCaption("");
      return undefined;
    }
  }, [touch]);
  // Claim: Bankr construye las txs (sin auth), la persona las firma aqui; paga gas en Base.
  const claimFees = useCallback(async (msgId: number) => {
    const msg = messagesRef.current.find((x) => x.id === msgId);
    const f = msg?.fees;
    if (!f || (msg?.tx && msg.tx.stage !== "idle" && msg.tx.stage !== "failed")) return;
    const patch = (tx: Partial<DraftTx>) => setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, tx: { ...(x.tx ?? { stage: "idle", hashes: [] }), ...tx } as DraftTx } : x)));
    if (!wallet.address || f.address.toLowerCase() !== wallet.address.toLowerCase()) { patch({ stage: "blocked", note: "These fees belong to a wallet other than the one connected here." }); return; }
    if (!wallet.canSign) { flog("warn", "fees claim: wallet link lost, nothing sent"); patch({ stage: "failed", note: LINK_LOST }); setCaption("Reconnect your wallet first."); return; }
    const hashes: DraftTx["hashes"] = [];
    try {
      patch({ stage: "signing", note: "" });
      setCaption("Building the claim with Bankr…");
      const res = await fetch("/api/fees/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: f.tokens.filter((t) => Number(t.claimable.token0) > 0 || Number(t.claimable.token1) > 0).map((t) => t.tokenAddress) }) });
      const j = (await res.json().catch(() => ({}))) as { recipient?: string; txs?: Array<{ tokenSymbol: string; to: `0x${string}`; data: `0x${string}`; chainId: number }>; errors?: Array<{ message?: string; error?: string }>; error?: string; detail?: string };
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
      if (!j.recipient || j.recipient.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("claim built for another wallet");
      if (!j.txs?.length) { patch({ stage: "failed", note: j.errors?.[0]?.message ?? j.errors?.[0]?.error ?? j.detail ?? "Nothing to claim yet." }); setCaption("Nothing to claim yet."); return; }
      for (const t of j.txs) {
        setCaption(`Confirm the ${t.tokenSymbol} fee claim ${signShort}…`);
        flog("info", `fees claim ${t.tokenSymbol}: waiting for signature`);
        const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: "0x0", chainId: t.chainId });
        hashes.push({ label: `claim ${t.tokenSymbol}`, hash, status: "pending", explorer: `https://basescan.org/tx/${hash}` });
        patch({ stage: "pending", hashes: [...hashes] });
        setCaption(`${t.tokenSymbol} claim sent · waiting for Base…`);
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 4000));
          const r = await fetch(`/api/trade/receipt?hash=${hash}`);
          const rj = (await r.json().catch(() => ({}))) as { status?: string };
          if (rj.status === "success") { hashes[hashes.length - 1].status = "success"; patch({ hashes: [...hashes] }); break; }
          if (rj.status === "reverted") throw new Error(`claim ${t.tokenSymbol} reverted on Base`);
          if (Date.now() - started > 3 * 60_000) throw new Error(`claim ${t.tokenSymbol} not confirmed after 3 min`);
        }
        flog("info", `fees claim ${t.tokenSymbol}: confirmed ${hash}`);
      }
      patch({ stage: "done", hashes: [...hashes] });
      // Bankr cachea lo reclamable 2 min: la card y la pantalla Launches lo muestran ya en cero.
      const claimedNow = j.txs.map((t) => (t as { tokenAddress?: string }).tokenAddress ?? "").filter(Boolean).map((a) => a.toLowerCase());
      const zero = f.tokens.map((t) => (claimedNow.length === 0 || claimedNow.includes(t.tokenAddress.toLowerCase()) ? { ...t, claimable: { token0: "0", token1: "0" }, claimed: { ...t.claimed, count: (t.claimed?.count ?? 0) + 1 } } : t));
      setMessages((m) => m.map((x) => (x.id === msgId && x.fees ? { ...x, fees: { ...x.fees, tokens: zero } } : x)));
      setClaimedTokens((c) => [...new Set([...c, ...(claimedNow.length ? claimedNow : f.tokens.map((t) => t.tokenAddress.toLowerCase()))])]);
      setDeskRefresh((n) => n + 1);
      window.setTimeout(() => { setClaimedTokens([]); setDeskRefresh((n) => n + 1); }, 135_000);
      kbWriteRef.current({ kind: "order", title: `claim fees ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, body: `- Claimed creator fees for ${j.txs.map((t) => t.tokenSymbol).join(", ")} to ${wallet.address}\n- Signed by the human in their wallet.\n${hashes.map((h) => `- ${h.label}: ${h.explorer}`).join("\n")}` });
      setCaption(`Fees claimed for ${j.txs.map((t) => t.tokenSymbol).join(", ")}. Receipt on Base.`);
      speak(`Done. Your creator fees are in your wallet, receipt on chain.`);
      touch();
      // Bankr cachea 2 min: la card se refresca cuando el saldo baje.
      window.setTimeout(() => { void feesCard(msgId); }, 130_000);
    } catch (e) {
      const m = (e as Error).message || "signature failed";
      flog("error", `fees claim: ${m}`);
      const timedOut = /timeout|timed out|expired/i.test(m);
      patch({ stage: "failed", hashes: [...hashes], note: /reject|denied|4001/i.test(m) ? "You declined in the wallet." : /wallet_link_lost|No wallet connected/i.test(m) ? LINK_LOST : /RPC endpoint|RPC 0x[0-9a-f]+/i.test(m) ? WALLET_RPC : timedOut ? `The wallet did not answer in time. ${signHint} Then press Retry.` : m });
      setCaption(/reject|denied|4001/i.test(m) ? "Claim cancelled in the wallet." : timedOut ? "The wallet did not answer. Nothing was claimed." : "Claim failed.");
    }
  }, [wallet, speak, touch, feesCard, signHint, signShort]);

  // Approve: la persona firma en su wallet (MetaMask por WalletConnect) cada
  // tx del draft en orden; Floor espera el receipt en Base y muestra el hash.
  const approveDraft = useCallback(async (msgId: number) => {
    const msg = messagesRef.current.find((x) => x.id === msgId);
    const d = msg?.draft;
    if (!d || (msg?.tx && msg.tx.stage !== "idle" && msg.tx.stage !== "failed")) return;
    const patch = (tx: Partial<DraftTx>) => setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, tx: { ...(x.tx ?? { stage: "idle", hashes: [] }), ...tx } as DraftTx } : x)));
    if (Date.now() / 1000 > d.deadline - 60) { patch({ stage: "failed", note: "Quote expired. Ask for a new draft." }); return; }
    if (!wallet.canSign) { flog("warn", "trade: wallet link lost, nothing sent"); patch({ stage: "failed", note: LINK_LOST }); setCaption("Reconnect your wallet first."); return; }
    // El swap paga a `recipient`: tiene que ser la wallet conectada en esta ventana.
    if (!d.recipient || !wallet.address || d.recipient.toLowerCase() !== wallet.address.toLowerCase()) {
      flog("error", `trade: recipient ${d.recipient ?? "missing"} is not the connected wallet`);
      patch({ stage: "blocked", note: "This draft pays out to a wallet other than the one connected here. Ask for a new draft." });
      return;
    }
    const hashes: DraftTx["hashes"] = [];
    try {
      for (const t of d.txs) {
        patch({ stage: "signing", step: t.label, hashes: [...hashes], note: "" });
        setCaption(t.label === "approve" ? `Confirm the approval ${signShort}…` : `Confirm the swap ${signShort}…`);
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
      setDeskRefresh((n) => n + 1);
      {
        const last = hashes[hashes.length - 1];
        setTurn((t) => (t ? { ...t, receipt: { hash: last?.hash, explorer: last?.explorer, status: "signed" } } : t));
      }
      kbWriteRef.current({ kind: "order", ticker: d.stock.ticker, title: `${d.side} ${d.side === "buy" ? `$${d.amountInUsd}` : d.amountInHuman} ${d.stock.symbol} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, body: `- Side: ${d.side}\n- Asset: ${d.stock.name} (${d.stock.symbol}, ${d.stock.issuer})\n- Paid: ${d.amountInHuman} ${d.tokenIn.symbol}\n- Received (quoted): ${d.quoteOutHuman} ${d.tokenOut.symbol}\n- Price: $${d.impliedPriceUsd.toFixed(2)} per share\n- Pool: ${d.pool} (${d.fee / 10_000}%)\n- Signed by the human in their wallet.\n${hashes.map((h) => `- ${h.label}: ${h.explorer}`).join("\n")}` });
      setCaption(d.side === "buy" ? `Bought ${d.quoteOutHuman} ${d.stock.symbol} for $${d.amountInUsd} on Base.` : `Sold ${d.amountInHuman} ${d.stock.symbol} for $${d.quoteOutHuman} on Base.`);
      speak(d.side === "buy" ? `Done. You now hold ${Number(d.quoteOutHuman).toFixed(4)} ${d.stock.name} on Base, and the receipt is on chain.` : `Done. ${d.amountInHuman} ${d.stock.name} sold for ${Number(d.quoteOutHuman).toFixed(2)} dollars on Base, receipt on chain.`);
      touch();
    } catch (e) {
      const m = (e as Error).message || "signature failed";
      flog("error", `trade: ${m}`);
      const timedOut = /timeout|timed out|expired/i.test(m);
      patch({ stage: "failed", hashes: [...hashes], note: /reject|denied|4001/i.test(m) ? "You declined in the wallet." : /wallet_link_lost|No wallet connected/i.test(m) ? LINK_LOST : /RPC endpoint|RPC 0x[0-9a-f]+/i.test(m) ? WALLET_RPC : timedOut ? `The wallet did not answer in time. ${signHint} Then press Retry.` : m });
      setCaption(/reject|denied|4001/i.test(m) ? "Trade cancelled in the wallet." : timedOut ? "The wallet did not answer. Nothing was traded." : "Trade failed.");
    }
  }, [wallet, speak, touch, signHint, signShort]);

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
    // Perfil de valuacion (cache 24 h / Knowledge / Grok): entra a los hechos y a la nota.
    let profileLine = "";
    const profileP = fetch("/api/market/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: b.stock.ticker, name: b.stock.name }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && typeof j.line === "string") { profileLine = j.line; flog("info", `profile ${b.stock.ticker}: ${j.from}${j.cached ? " · cached" : ""}`); if (briefRef.current?.msgId === id) briefRef.current = { ...briefRef.current, lines: [...b.lines, profileLine] }; }
        else flog("warn", `profile: ${j.error ?? ""} ${j.detail ?? ""}`);
      })
      .catch((e) => flog("warn", `profile: ${(e as Error).message}`));
    // Noticias con fuentes (Grok web_search), en paralelo con el turno de mesa.
    const newsP = fetch("/api/market/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: b.stock.ticker, name: b.stock.name }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        const news: News | undefined = ok && j.text ? { text: j.text, sources: j.sources ?? [], at: j.at } : undefined;
        if (!ok) flog("warn", `news: ${j.error ?? ""} ${j.detail ?? ""}`); else flog("info", `news ${b.stock.ticker}: ${String(j.text).length} chars · ${(j.sources ?? []).length} sources${j.cached ? " · cached" : ""}`);
        const memo2 = memoRef.current.get(key);
        if (memo2) memo2.analysis = { ...memo2.analysis, news, loadingNews: false };
        // Nota de analisis: hechos + noticias con fuentes (Scout/Risk van al diario).
        kbWriteRef.current({ kind: "analysis", ticker: b.stock.ticker, title: `${b.stock.name} (${b.stock.symbol}) · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, body: `${[...b.lines, ...(profileLine ? [profileLine] : [])].map((l) => `- ${l}`).join("\n")}${news ? `\n\n## News\n${news.text}\n${news.sources.map((s, i) => `[${i + 1}] ${s.url}`).join("\n")}` : ""}` });
        setMessages((m) => m.map((x) => (x.id === id && x.analysis ? { ...x, analysis: { ...x.analysis, news, loadingNews: false } } : x)));
        if (briefRef.current?.msgId === id && news) briefRef.current = { ...briefRef.current, news: news.text };
        return news;
      })
      .catch((e) => { flog("error", `news: ${(e as Error).message}`); return undefined; });
    // Las noticias entran al prompt de la mesa: esperar hasta 25 s (Grok search
    // tarda 10-16 s; la mesa sin noticia opina a ciegas sobre el catalizador).
    const got = await Promise.race([Promise.all([newsP, profileP]).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 25_000))]);
    if (!got) flog("warn", "news or profile: not ready before the desk turn");
    modeRef.current = "analyze";
    await chat(spoken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, speak, touch]);

  // Conocimiento local: cada turno deja rastro en ~/.perkos-xyz/knowledge
  // (diario, analisis, ordenes). Best effort; nunca bloquea la escena.
  const kbWrite = useCallback((payload: { journal?: true; kind?: "journal" | "analysis" | "order" | "memory" | "decision"; title?: string; body: string; ticker?: string }) => {
    void fetch("/api/kb/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => r.json().then((j) => { if (!r.ok) flog("warn", `kb: ${j.error ?? r.status}`); }))
      .catch((e) => flog("warn", `kb: ${(e as Error).message}`));
  }, []);
  kbWriteRef.current = kbWrite;
  focusRef.current = focusAsset;

  // Pregunta lateral mientras la mesa trabaja: solo Floor (principal) responde,
  // sin cortar el turno de los agentes. Sin voz: la mesa ya esta hablando.
  const sideChat = useCallback(async (text: string) => {
    const tid = turnRef.current?.id;
    const youId = Date.now();
    const fid = youId + 1;
    setMessages((m) => [...m, { id: youId, role: "you", text, turnId: tid }, { id: fid, role: "floor", kind: "side", text: "", streaming: true, turnId: tid }]);
    stickRef.current = true;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, fleet: [], side: true, desk: deskRef.current ? { name: deskRef.current.name, roles: deskRef.current.agents.map((a) => a.name) } : undefined, brief: briefRef.current?.lines ?? null, news: briefRef.current?.news ?? null, focus: focusRef.current || null }) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).replace(/^data:\s*/, "");
          buf = buf.slice(i + 2);
          if (!line) continue;
          let ev: { delta?: string; error?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.error) throw new Error(ev.error);
          if (typeof ev.delta === "string") { full += ev.delta; setMessages((m) => m.map((x) => (x.id === fid ? { ...x, text: full } : x))); }
        }
      }
      setMessages((m) => m.map((x) => (x.id === fid ? { ...x, text: full, streaming: false } : x)));
      flog("info", `side chat <- ${full.length} chars`);
    } catch (e) {
      flog("warn", `side chat: ${(e as Error).message}`);
      setMessages((m) => m.map((x) => (x.id === fid ? { ...x, text: x.text || "Still working on it.", streaming: false } : x)));
    }
  }, []);

  // Pregunta abierta de inversion: scan del mercado (todos los activos operables)
  // + noticias de los que mas se movieron, turno de mesa en modo "advise" y un
  // documento fechado con el ranking para revisarlo al mes.
  const adviseMarket = useCallback(async (text: string) => {
    setCaption("Scanning the market…");
    busyRef.current = true;
    touch();
    // El pedido y el estado se ven desde el primer segundo (en split la caption se oculta).
    const youId = Date.now();
    const statusId = youId + 1;
    const status = (t: string) => setMessages((m) => m.map((x) => (x.id === statusId ? { ...x, text: t } : x)));
    setMessages((m) => [...m.slice(-60), { id: youId, role: "you", text, turnId: youId }, { id: statusId, role: "floor", kind: "status", text: "Scanning the market…", turnId: youId }]);
    try {
      const r = await fetch("/api/market/scan");
      const scan = (await r.json()) as { at: string; lines: string[]; rows: Array<{ symbol: string; ticker: string; name: string; change24hPct?: number }>; error?: string };
      if (!r.ok || !Array.isArray(scan.lines)) { setCaption(`Could not scan the market: ${scan.error ?? r.status}`); return; }
      flog("info", `scan: ${scan.rows.length} stocks`);
      // Todos los activos del scan: noticias (cache 15 min) y perfil de
      // valuacion (cache 24 h) en paralelo; lo que no llega en 35 s queda fuera.
      const all = scan.rows;
      setCaption(`Reading the news and valuation on ${all.length} stocks…`);
      status(`Scanned ${all.length} stocks with their 30-day range. Reading the news and the valuation on each…`);
      const newsBy = new Map<string, string>();
      const profBy = new Map<string, string>();
      const jobs = all.flatMap((t) => [
        fetch("/api/market/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t.ticker, name: t.name }) }).then((x) => x.json()).then((j) => { if (j.text) newsBy.set(t.symbol, `${t.symbol}: ${String(j.text).slice(0, 320)}`); }).catch(() => undefined),
        fetch("/api/market/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t.ticker, name: t.name }) }).then((x) => x.json()).then((j) => { if (typeof j.line === "string") profBy.set(t.symbol, j.line); }).catch(() => undefined)
      ]);
      await Promise.race([Promise.all(jobs), new Promise<void>((res) => setTimeout(res, 35_000))]);
      flog("info", `advise: news ${newsBy.size}/${all.length} · profiles ${profBy.size}/${all.length}`);
      status(`News on ${newsBy.size} of ${all.length}, valuation on ${profBy.size}. Handing to the desk.`);
      const news = all.map((t) => newsBy.get(t.symbol) ?? "").filter(Boolean).join(" ");
      const lines = scan.lines.map((l) => { const sym = l.match(/^([A-Z]{2,6}c)\b/)?.[1]; const p = sym ? profBy.get(sym) : undefined; return p ? `${l} ${p}` : l; });
      briefRef.current = { lines, news: news || undefined };
      quoteRef.current = null;
      setFocusAsset("");
      modeRef.current = "advise";
      await chat(text, { youId });
      const replies = lastRepliesRef.current;
      const who = replies.filter((x) => x.ok && x.reply).map((x) => `- **${cap(x.role)}**: ${x.reply.replace(/\s+/g, " ")}`).join("\n");
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      kbWriteRef.current({ kind: "analysis", ticker: "MARKET", title: `Market outlook · ${stamp} UTC`, body: `**Asked**: ${text}\n\n## Market scan\n${lines.map((l) => `- ${l}`).join("\n")}${news ? `\n\n## News\n${news}` : ""}\n\n## Desk\n${who || "(the desk did not answer)"}\n\n_Review in one month._` });
    } catch (e) {
      flog("error", `advise: ${(e as Error).message}`);
      setCaption("Could not scan the market.");
    }
  }, [chat, touch]);

  // Precalentar el mercado (scan, noticias, valuacion de los 10 activos) al
  // arrancar y cada 15 min: una pregunta abierta no debe esperar a Grok.
  useEffect(() => {
    const warm = () => fetch("/api/market/warm", { method: "POST" }).then((r) => r.json()).then((j) => flog("info", `warm: ${j.started ? "started" : "running"}${j.last ? ` · last ${j.last.news} news, ${j.last.profiles} profiles in ${(j.last.ms / 1000).toFixed(0)} s` : ""}`)).catch(() => undefined);
    const t = window.setTimeout(warm, 20_000);
    const id = window.setInterval(warm, 15 * 60_000);
    return () => { window.clearTimeout(t); window.clearInterval(id); };
  }, []);

  // Outlooks vencidos: al mes la mesa revisa sus llamadas sola. Una vez por
  // sesion, 30 s despues de arrancar para no competir con el warm-up.
  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/desk/review");
        const j = (await r.json()) as { due?: number };
        if (!r.ok || !j.due) return;
        const done = await fetch("/api/desk/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json()) as { reviewed?: number };
        flog("info", `outlook review: ${done.reviewed ?? 0}/${j.due}`);
        if (done.reviewed) setCaption(`Reviewed ${done.reviewed} market outlook${done.reviewed > 1 ? "s" : ""} from a month ago. See History.`);
      } catch (e) { flog("warn", `outlook review: ${(e as Error).message}`); }
    }, 30_000);
    return () => window.clearTimeout(t);
  }, []);

  newChatRef.current = () => {
    savedSigRef.current = "";
    threadRef.current = "";
    setThreadId("");
    setMessages([]);
    quoteRef.current = null;
    briefRef.current = null;
    heldDraftRef.current = null;
    modeRef.current = "chat";
    setTurn(null);
    setBeams([]);
    setVerdict("");
    window.clearTimeout(idleTimer.current);
    setSplit(false);
    setCaption("New chat. The last one is saved in Chats.");
    flog("info", "chat: new thread");
  };
  const run = useCallback((raw: string) => {
    const spoken = raw.trim();
    const it = parseIntent(raw);
    const cmd = it.kind;
    flog("info", `intent: ${it.kind}${"asset" in it && it.asset ? ` · ${it.asset}` : ""}`);
    if (cmd === "chat" && spoken) {
      if (turnLiveRef.current) { void sideChat(spoken); return; }
      quoteRef.current = null;
      briefRef.current = null;
      modeRef.current = "chat";
      void chat(spoken);
      return;
    }
    if (cmd === "advise") { void adviseMarket(spoken); return; }
    if (cmd === "history") { setDeskScreen("history"); setCaption("Every decision the desk made"); return; }
    if (cmd === "launch") {
      quoteRef.current = null;
      if (!it.symbol && !it.name) { setCaption("What is the token called? Say: launch Night Owl (OWL) paired with NVDA."); return; }
      if (!it.pair) { setCaption(`Pair ${it.name ?? it.symbol} with what? A tokenized stock like NVDA or TSLA, or WETH. Add fees to @handle if someone else should earn.`); return; }
      modeRef.current = "launch";
      setFocusAsset(it.pair);
      // Primero el draft simulado en Bankr (el launch en la mesa), despues el turno de mesa.
      void launchDraft(it).then((ok) => (ok ? chat(spoken) : undefined));
      return;
    }
    if (cmd === "automate") { quoteRef.current = null; void automationDraft(it.text); return; }
    if (cmd === "automations") { setDeskScreen("automations"); setCaption("Your Bankr automations"); return; }
    if (cmd === "fees") { quoteRef.current = null; void feesCard(undefined, it.token); return; }
    if (cmd === "launches") { setDeskScreen("launches"); setCaption("Your tokens on Base"); return; }
    if (cmd === "chats") { setChatsOpen(true); setCaption("Your conversations"); return; }
    if (cmd === "newchat") { newChatRef.current(); return; }
    if (cmd === "buy" || cmd === "sell") {
      quoteRef.current = null;
      // Sin activo reconocido no se asume NVDAc: se usa el activo en foco o se pregunta.
      if (!it.asset && !focusRef.current) { setCaption("Which stock? Say: buy $5 of Apple."); return; }
      if (!it.asset) it.asset = focusRef.current;
      modeRef.current = "order";
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
    if (cmd === "map") { setDeskScreen("map"); setCaption("The desk as a graph"); return; }
    if (cmd === "summarize") { void summarizeDay(); return; }
    if (cmd === "approve") {
      const d = [...messagesRef.current].reverse().find((m) => m.role === "draft" && m.tx?.stage === "idle");
      if (d?.launch) { setCaption("Deploying with Bankr…"); void deployLaunch(d.id); }
      else if (d?.fees) { setCaption("Claiming in your wallet…"); void claimFees(d.id); }
      else if (d?.auto) { setCaption("Creating in Bankr…"); void createAutomation(d.id); }
      else if (d) { setCaption("Approving in your wallet…"); void approveDraft(d.id); } else setCaption("Nothing to approve.");
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
    if (cmd === "sleep") {
      // Dormir al equipo en PerkOS (el curator lo haria a los 15 min igual).
      setListening(false);
      setTeam("hibernated");
      setGuest(false);
      setCaption("Putting the team to sleep on PerkOS…");
      voice.stopAll();
      if (perkosRef.current.connected && fleetRef.current?.agents.some((a) => a.state === "ready" || a.state === "waking")) void fleetAction("hibernate");
      return;
    }
    if (cmd === "stop") {
      // Solo corta voz, escucha y paneles: el equipo sigue despierto.
      setListening(false);
      setDocs(false);
      setMarket(false);
      setDeskScreen("");
      setSettings(false);
      setCaption("");
      voice.stopAll();
      window.clearTimeout(idleTimer.current);
      setSplit(false);
    }
  }, [summarizeDay, analyzeAsset, approveDraft, quoteAsset, chat, voice, fleetAction, adviseMarket]);
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
            // El canal externo (bridge de voz) nunca compra, vende ni aprueba:
            // eso solo desde la ventana, con la wallet a la vista.
            const k = parseIntent(data.text).kind;
            if (k === "buy" || k === "sell" || k === "approve") { flog("warn", `command channel: "${k}" ignored`); continue; }
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
    // bienvenida aparece ya. Mientras cierra, el provider reporta connected=false
    // y busy=true, y el boton del hero espera a que termine antes de abrir el login.
    void wallet.logout();
    setWizardStart(0);
    setWizardEpoch((e) => e + 1);
    setWizard(true);
    setSplash(false);
    setWho("");
    // La conversacion es de la cuenta que se va: no debe quedar para la siguiente (sigue guardada, cifrada, para ella).
    savedSigRef.current = "";
    chatsLoadedFor.current = "";
    setThreadId("");
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
    // Solo el wallet: el LLM conectado queda en ~/.perkos-xyz (como cualquier app de AI).
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
    <div className={`stage${teamSeen ? " team-seen" : ""}${messages.length === 0 && !turn ? " fresh" : ""}${split ? " split" : ""}${debug ? " with-debug" : ""}${deskScreen ? " desk-open" : ""}${deskScreen && deskMax ? " desk-max" : ""}${turn && !turn.collapsed ? " turn-live" : ""}${turn?.collapsed ? " turn-chips" : ""}`}>
      <div className="dragbar" />
      {/* Lockup de partnership invertido (brand.base.org/partnerships: el
          partner lidera cuando es su lanzamiento): PerkOS + la cadena del desk.
          El wordmark es del shell; la marca de la cadena cambia con el desk. */}
      <div className="mark">
        <img src="/logo-name.png" alt="PerkOS" />
        {desk ? <><span className="plus" aria-hidden="true">+</span><ChainMark chain={chainOf(desk)} big /></> : null}
      </div>
      <button className="gear" type="button" onClick={() => setSettings(true)} aria-label="Settings" title="Settings">
        <GearIcon />
      </button>
      {/* Identidad del desk, centrada: el desk es el producto y la cadena es parte de su identidad. */}
      {who && desks.length ? (
        <div className="desk-id">
          {/* Desk actual + quick switch (como org/proyecto en PerkOS App). */}
          {desks.length ? (
            <div className={`deskpick${deskMenu ? " open" : ""}`}>
              <button type="button" className={`desk-cur st-${fleet?.status ?? "none"}`} onClick={() => setDeskMenu((v) => !v)} aria-haspopup="listbox" aria-expanded={deskMenu} title={`Switch desk · team ${fleet?.status ?? "not loaded"}`}>
                <ChainMark chain={chainOf(desk)} />
                {desk?.name ?? "No desk"}
                <b>▾</b>
              </button>
              {deskMenu ? (
                <ul role="listbox" className="desk-menu">
                  {desks.map((d) => (
                    <li key={d.id} role="option" aria-selected={d.id === deskId}>
                      <button type="button" className={d.id === deskId ? "on" : ""} onClick={() => void selectDesk(d.id)}>
                        <span><ChainMark chain={chainOf(d)} small />{d.name}</span>
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
          <small>{deskManifest(desk).tagline}</small>
        </div>
      ) : null}
      {who ? (
        <div className="who">
          <span title={wallet.signWhere === "phone" ? `${wallet.walletName || "External wallet"} over WalletConnect: approvals show up on your phone` : wallet.signWhere === "embedded" ? "PerkOS wallet (Privy): signs inside this app" : undefined}>{who}</span>
          {wallet.signWhere && !linkLost ? <em className="wk" title={wallet.signWhere === "phone" ? "Approvals show up in your wallet app on your phone" : wallet.signWhere === "embedded" ? "Signs inside this app" : "Signs in your browser wallet"}>{wallet.signWhere === "phone" ? "phone wallet" : wallet.signWhere === "embedded" ? "app wallet" : "browser wallet"}</em> : null}
          <em className={`pk${perkos.connected ? " on" : ""}`} title={perkos.connected ? "PerkOS session active" : perkos.note || "PerkOS not connected"}>PerkOS</em>
          {linkLost ? <button type="button" className="relink" onClick={logout} title="You are signed in, but no wallet is linked to this window. Nothing can be signed until you sign in again and scan the QR.">Wallet not linked · sign in again</button> : null}
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
          rail={{ status: rail.status, oneclawAgentId: rail.oneclawAgentId, vaultId: rail.vaultId, linkedRoles: rail.linkedRoles, lockUsd: fleet?.agents.find((a) => a.rail)?.rail?.lockUsd, hasRail: Boolean(fleet?.agents.some((a) => a.rail)) }}
          onLinkRail={() => { setSettings(false); openRailStep(); }}
          onLogout={logout}
          desk={desk ? { name: desk.name, chain: CHAINS[chainOf(desk)].name, builtOn: CHAINS[chainOf(desk)].builtOn, agents: desk.agents.map((a) => a.name), revision: desk.revision, fleetStatus: fleet?.status } : undefined}
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
      {turn && awake ? (
        <div className={`ag-layer${turn.collapsed ? " chips" : ""}`}>
          <AgentCards
            turn={turn}
            mode={turn.collapsed ? "chips" : "live"}
            onExpand={() => setTurn((t) => (t ? { ...t, collapsed: false } : t))}
            onFocus={(r: AgentRole) => { const els = document.querySelectorAll(`.turn.team[data-who="${r}"]`); const el = els[els.length - 1]; if (el) { stickRef.current = false; setShowJump(true); el.scrollIntoView({ behavior: "smooth", block: "center" }); } }}
            canApprove={turn.verdict === "GO" && messages.some((m) => m.role === "draft" && m.tx?.stage === "idle")}
            onApprove={() => { const d = [...messagesRef.current].reverse().find((m) => m.role === "draft" && m.tx?.stage === "idle"); if (d?.launch) void deployLaunch(d.id); else if (d?.fees) void claimFees(d.id); else if (d?.auto) void createAutomation(d.id); else if (d) void approveDraft(d.id); }}
          />
          {!turn.collapsed && !turn.live ? <button type="button" className="ag-collapse" onClick={() => setTurn((t) => (t ? { ...t, collapsed: true } : t))} aria-label="Collapse">×</button> : null}
        </div>
      ) : null}

      <div className={`slab docs${docs ? " on" : ""}`}>
        <div className="k">PROJECT</div>
        <b>PerkOS</b>
        <small>They draft. You approve. Base only.</small>
      </div>
      {desk && !wizard ? <div className="venue-line">{deskManifest(desk).venues}</div> : null}
      {/* Sonda de tamano (ancho x alto): descomentar para calibrar breakpoints. */}
      {/* <SizeProbe /> */}
      {/* Dock del desk: las pantallas propias del desk activo, a un clic
          (tambien por voz: "show the market", "show my portfolio"). Primero
          las del desk (Market, Portfolio), luego las del shell (Notes, Map, History). */}
      {desk && !wizard ? (
        <nav className="desk-dock" aria-label="Desk and app screens">
          <button type="button" className={deskScreen === "market" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "market" ? "" : "market")} title="Market · tokenized stocks on Base">
            <ChartIcon /><span>Market</span>
          </button>
          <button type="button" className={deskScreen === "portfolio" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "portfolio" ? "" : "portfolio")} title="Portfolio · your positions on Base">
            <WalletIcon /><span>Portfolio</span>
          </button>
          <button type="button" className={deskScreen === "launches" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "launches" ? "" : "launches")} title="Launches · tokens that pay fees to your wallet, with Bankr and claim">
            <RocketIcon /><span>Launches</span>
          </button>
          <button type="button" className={deskScreen === "automations" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "automations" ? "" : "automations")} title="Automations · DCA, stop loss and limit rules running in Bankr">
            <LoopIcon /><span>Automations</span>
          </button>
          <i className="dock-sep" aria-hidden="true" />
          <button type="button" className={deskScreen === "notes" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "notes" ? "" : "notes")} title="Notes · what this desk remembers (local, Obsidian-compatible)">
            <NotesIcon /><span>Notes</span>
          </button>
          <button type="button" className={deskScreen === "map" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "map" ? "" : "map")} title="Map · the desk as a graph">
            <MapIcon /><span>Map</span>
          </button>
          <button type="button" className={deskScreen === "history" ? "on" : ""} onClick={() => setDeskScreen(deskScreen === "history" ? "" : "history")} title="History · every decision the desk made">
            <HistoryIcon /><span>History</span>
          </button>
        </nav>
      ) : null}
      {deskScreen ? (
        <DeskPanel
          screen={deskScreen}
          focus={focusAsset}
          onScreen={setDeskScreen}
          onClose={() => { setDeskScreen(""); setDeskMax(false); }}
          onSay={(t) => runRef.current(t)}
          onSummarize={() => void summarizeDay()}
          refreshKey={deskRefresh}
          claimedTokens={claimedTokens}
          max={deskMax}
          onMax={setDeskMax}
          map={(
            <KnowledgeMap
              focus={focusAsset}
              onPick={(n: GraphNode) => {
                if (n.type === "asset" && n.ticker) { setFocusAsset(n.ticker); runRef.current(`analyze ${n.ticker}`); }
                else if (n.type === "decision") setDeskScreen("history");
                else if (n.type === "note") setDeskScreen("notes");
                else if (n.type === "agent") { const r = n.id.replace("agent:", ""); const els = document.querySelectorAll(`.turn.team[data-who="${r}"]`); const el = els[els.length - 1]; if (el) { setDeskMax(false); el.scrollIntoView({ behavior: "smooth", block: "center" }); } }
              }}
            />
          )}
        />
      ) : null}

      {/* El template del desk vive en el wizard (paso "Your team"): la escena
          solo se ve con equipo. Un "wake" por voz con 402 abre el pago directo. */}

      <div className="core-wrap">
        <button className={`core ${coreClass}`} type="button" onClick={listen} aria-label="Talk to Sparky" />
        <div className="mic-dock">
          <div className="whisper">{speaking ? "Speaking" : thinking ? "Thinking" : listening ? "Listening" : "They draft. You approve."}</div>
        </div>
      </div>

      {/* Conversacion: transcript + composer viven en una sola columna (.convo)
          que es la unica duena de posicion y ancho. En idle es solo el composer
          centrado abajo; en split ocupa la izquierda con un separador. */}
      <div className={`convo${split ? " split" : ""}`}>
      {split && showJump ? (
        <button type="button" className="jump-latest" onClick={scrollToLatest} aria-label="Jump to latest" title="Jump to latest">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      ) : null}
      <div className={`transcript${split ? " on" : ""}`} aria-live="polite" ref={transcriptRef} onScroll={onTranscriptScroll} onWheel={markUserGesture} onTouchMove={markUserGesture} onKeyDown={onTranscriptKey} tabIndex={-1}>
        {(() => {
          // Turnos anteriores plegados en una linea (patron de hilo de grupo);
          // el turno en curso y los abiertos a mano se ven completos.
          const latestTurn = turn?.id ?? [...messages].reverse().find((x) => x.turnId)?.turnId;
          const out: React.ReactNode[] = [];
          const folded = new Set<number>();
          for (const m of messages) {
            const tid = m.turnId;
            if (tid && tid !== latestTurn && !openTurns.includes(tid)) {
              if (folded.has(tid)) continue;
              folded.add(tid);
              const ask = messages.find((x) => x.turnId === tid && x.role === "you")?.text ?? "turn";
              const v = messages.find((x) => x.turnId === tid && x.verdict)?.verdict;
              out.push(
                <button type="button" key={`fold-${tid}`} className="turn-fold" onClick={() => setOpenTurns((o) => [...o, tid])}>
                  ▸ {ask.slice(0, 60)}{v ? <em className={`vchip ${v.toLowerCase()}`}>{v}</em> : null}<small>{new Date(tid).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                </button>
              );
              continue;
            }
            out.push(
          <div key={m.id} className={`turn ${m.role}${m.kind ? ` ${m.kind}` : ""}`} data-who={m.who ?? (m.role === "floor" ? "floor" : undefined)}>
            <span className="turn-k">
              {m.role === "you" ? "You" : m.role === "team" ? `${cap(m.who ?? "team")} · PerkOS` : m.role === "draft" ? "Desk · decision" : m.role === "analysis" ? `Desk · ${m.who ?? "analysis"}` : m.kind === "open" ? "Sparky · principal" : m.kind === "side" ? "Sparky · to you" : "Sparky"}
              {m.verdict ? <em className={`vchip ${m.verdict.toLowerCase()}`}>{m.verdict}</em> : null}
            </span>
            {m.role === "draft" && m.draft ? (
              <DraftCard draft={m.draft} tx={m.tx ?? { stage: "idle", hashes: [] }} onApprove={() => void approveDraft(m.id)} signHint={signHint} onPhone={wallet.signWhere === "phone"} onReconnect={logout} linkLost={linkLost} />
            ) : m.role === "draft" && m.launch ? (
              <LaunchCard launch={m.launch} tx={m.tx ?? { stage: "idle", hashes: [] }} onLaunch={() => void deployLaunch(m.id)} onFees={() => void feesCard()} />
            ) : m.role === "draft" && m.fees ? (
              <FeesCard fees={m.fees} tx={m.tx ?? { stage: "idle", hashes: [] }} onClaim={() => void claimFees(m.id)} onRefresh={() => void feesCard(m.id)} signHint={signHint} onPhone={wallet.signWhere === "phone"} onReconnect={logout} linkLost={linkLost} />
            ) : m.role === "draft" && m.auto ? (
              <AutomationCard auto={m.auto} tx={m.tx ?? { stage: "idle", hashes: [] }} onCreate={() => void createAutomation(m.id)} onOpen={() => setDeskScreen("automations")} />
            ) : m.role === "analysis" && m.analysis ? (
              <AnalysisCard a={m.analysis} onSay={(t) => runRef.current(t)} />
            ) : (
              <div className="bubble">
                {m.streaming && !m.text ? <span className="typing" aria-label="typing"><i /><i /><i /></span> : mentions(m.text)}
                {m.streaming && m.text ? <i className="cursor" /> : null}
              </div>
            )}
          </div>
            );
          }
          return out;
        })()}
      </div>

      {/* Arranques de conversacion (como en cualquier chat): solo con el hilo vacio y la escena en reposo.
          Cada burbuja envia el texto tal cual, con lo que recorre los intents reales del desk. */}
      {messages.length === 0 && !split && !turn ? (
        <div className="starters" aria-label="Suggested questions">
          {STARTERS.map((t) => <button key={t} type="button" onClick={() => { touch(); run(t); }}>{t}</button>)}
        </div>
      ) : null}
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submitDraft();
        }}
      >
        <div className="ask-top">
        <span className="ask-left">
        <button type="button" className={`chat-peek${chatsOpen ? " on" : ""}`} onClick={() => setChatsOpen((o) => !o)} title="Your saved conversations"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 6h16M4 12h16M4 18h10" /></svg>Chats</button>
        {messages.length > 0 ? <button type="button" className="chat-peek" onClick={() => newChatRef.current()} title="Start a new conversation. This one stays saved in Chats.">New chat</button> : null}
        {historyLocked && wallet.canSign ? <button type="button" className="chat-peek pending" onClick={() => void unlockHistory()} title="One signature, once on this computer: it derives the key that encrypts your chat history on disk. It moves no funds.">Unlock history</button> : null}
        {!split && messages.length > 0 ? (() => {
          const pending = messages.filter((x) => x.role === "draft" && x.tx?.stage === "idle" && (x.draft || x.launch || x.auto)).length;
          return (
            <button type="button" className={`chat-peek${pending ? " pending" : ""}`} onClick={() => touch()} title="The conversation is still here. Open it to read the desk's turn or approve a draft.">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></svg>
              {pending ? `Show chat · ${pending} draft${pending > 1 ? "s" : ""} waiting` : `Show chat · ${messages.filter((x) => x.role !== "floor" || x.text).length}`}
            </button>
          );
        })() : null}
        </span>
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
          placeholder={"Ask Sparky. Try \"buy $3 of NVDAc\""}
          spellCheck={false}
          autoComplete="off"
          aria-label="Ask Sparky"
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
      {chatsOpen ? <ChatsDrawer bridge={{ activeId: threadId, locked: historyLocked, canUnlock: wallet.canSign, refreshKey: chatsKey, onOpen: (id: string) => void openChat(id), onNew: () => newChatRef.current(), onUnlock: () => void unlockHistory(), onDeleted: (id: string) => { if (id === threadRef.current) newChatRef.current(); } }} onClose={() => setChatsOpen(false)} /> : null}
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

/** Estado de runtime del agente en el vocabulario del avatar (Asset Kit, seccion 24).
 *  Hibernado = hibernating (dormido, identidad intacta), nunca offline. */
function avatarState(state: string, talking?: boolean, verdict?: "GO" | "BLOCK" | ""): AgentAvatarState {
  if (talking) return "working";
  if (verdict === "GO") return "success";
  if (verdict === "BLOCK") return "warning";
  if (state === "ready") return "idle";
  if (state === "provisioning" || state === "waking") return "thinking";
  if (state === "failed") return "error";
  if (state === "hibernated") return "hibernating";
  return "offline"; // planned / not created
}

function Orb({ className, label, on, state = "", rail, onRail, talking, verdict, refCb }: { className: string; label: string; on: boolean; state?: string; rail?: { linked: boolean; lockUsd: number }; onRail?: () => void; talking?: boolean; verdict?: "GO" | "BLOCK" | ""; refCb?: (el: HTMLDivElement | null) => void }) {
  const sub = talking ? "Thinking" : state === "ready" ? "Online" : state === "provisioning" ? "Provisioning" : state === "waking" ? "Waking" : state === "hibernated" ? "Hibernating" : state === "failed" ? "Failed" : state === "planned" ? "Not created" : "";
  const role = className.split(" ")[0];
  const desk = role === "scout" || role === "risk" || role === "trader" || role === "auditor";
  return (
    <div ref={refCb} className={`orb ${className}${on ? " on" : ""}${state ? ` st-${state}` : ""}${talking ? " talking" : ""}`} title={sub}>
      {/* Avatar de identidad persistente (kit v1); el estado solo cambia ojos, anillo y brillo. El Grok Bot invitado va como guest. */}
      <div className="ball avatar">
        <AgentAvatar agent={{ id: desk ? role : "grok-bot", role: desk ? role : "guest", name: label, custody: role === "trader" ? "1claw" : null }} state={desk ? avatarState(state, talking, verdict) : on ? "idle" : "offline"} size={80} label={label} />
      </div>
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
        const d = `M ${a.x} ${a.y} C ${a.x} ${(a.y + c.y) / 2}, ${c.x} ${(a.y + c.y) / 2}, ${c.x} ${c.y}`;
        return (
          <g key={`${b.from}-${b.to}-${i}`}>
            <path className={`beam-path${b.done ? " done" : ""}`} d={d} />
            {!b.done ? <circle className="beam-token" r="4"><animateMotion dur="0.9s" fill="freeze" path={d} /></circle> : null}
          </g>
        );
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
          <button type="button" className="pill" onClick={() => onSay(`analyze ${b.stock.ticker} again`)}>Refresh</button>
          <button type="button" className="pill buy" disabled={!tradeable} onClick={() => onSay(`buy $5 of ${b.stock.symbol}`)}>Buy $5</button>
          {b.holding ? <button type="button" className="pill" onClick={() => onSay(`sell half of my ${b.stock.symbol}`)}>Sell half</button> : null}
        </div>
      </div>
    </div>
  );
}

/** Carta del draft del Trader + orb Approve (se mantiene 2 s para firmar).
 *  Sin llaves aqui: Approve manda las tx a la wallet de la persona. */
function DraftCard({ draft, tx, onApprove, signHint, onPhone, onReconnect, linkLost }: {
  draft: { side: "buy" | "sell"; recipient?: string; stock: { symbol: string; ticker: string; name: string; issuer: string }; tokenIn: { symbol: string; decimals: number }; tokenOut: { symbol: string; decimals: number }; amountInHuman: string; amountInUsd: number; quoteOutHuman: string; minOut: string; slippageBps: number; impliedPriceUsd: number; pool: string; fee: number; poolUsdcDepth: number; deadline: number; needsApproval: boolean; balanceUsdc: string; balanceToken: string; txs: Array<{ label: string }>; bankr?: { impliedPriceUsd: number; outHuman: string; outSymbol: string; feeBps: number; priceImpactBps?: number } | null; venueLabel?: string; venues?: Array<{ label: string; priceUsd: number; outHuman: string; usdcDepth: number; fee: number }> };
  tx: { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; step?: string; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  onApprove: () => void;
  signHint?: string;
  onPhone?: boolean;
  onReconnect?: () => void;
  linkLost?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const armed = (tx.stage === "idle" || tx.stage === "failed") && !linkLost;
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
  // Minimalista: la decision en una linea (comprar, esperar, hecho); el proceso
  // ya esta explicado en el chat. Los detalles de la ruta se pliegan.
  const [open, setOpen] = useState(false);
  const decision = tx.stage === "blocked" ? "Wait" : tx.stage === "done" ? (buy ? "Bought" : "Sold") : tx.stage === "failed" ? "Not signed" : tx.stage === "signing" || tx.stage === "pending" ? "Signing" : buy ? "Buy" : "Sell";
  const what = buy ? `$${draft.amountInUsd.toFixed(2)} of ${draft.stock.symbol}` : `${draft.amountInHuman} ${draft.stock.symbol}`;
  return (
    <div className={`draft-card st-${tx.stage}${open ? " open" : ""}`}>
      <div className="draft-head">
        <b><span className={`decision ${tx.stage === "blocked" ? "wait" : tx.stage === "done" ? "done" : "go"}`}>{decision}</span> {what} <small>at ${draft.impliedPriceUsd.toFixed(2)}{draft.venueLabel ? ` via ${draft.venueLabel}` : ""}{draft.bankr ? ` · Bankr $${draft.bankr.impliedPriceUsd.toFixed(2)}` : ""}</small></b>
        <button type="button" className="draft-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Less" : "Details"}</button>
      </div>
      {open ? <dl className="draft-rows">
        <dt>Asset</dt><dd>{draft.stock.name} <small>({draft.stock.ticker} · {issuer})</small></dd>
        <dt>You pay</dt><dd>{buy ? `$${draft.amountInUsd.toFixed(2)} USDC` : `${draft.amountInHuman} ${draft.stock.symbol}`}</dd>
        <dt>You get</dt><dd>≈ {draft.quoteOutHuman} {draft.tokenOut.symbol} <small>(min {minOutHuman}, {draft.slippageBps / 100}% slippage)</small></dd>
        <dt>Price</dt><dd>${draft.impliedPriceUsd.toFixed(2)} / share</dd>
        <dt>Pays to</dt><dd>{draft.recipient ? `${draft.recipient.slice(0, 6)}…${draft.recipient.slice(-4)}` : "your wallet"} <small>(the wallet connected here)</small></dd>
        {draft.bankr ? <><dt>Second quote</dt><dd>Bankr ${draft.bankr.impliedPriceUsd.toFixed(2)} / share · {draft.bankr.outHuman} {draft.bankr.outSymbol || draft.tokenOut.symbol} · {(((draft.impliedPriceUsd / draft.bankr.impliedPriceUsd) - 1) * 100).toFixed(2)}% vs Uniswap · read-only, never executes</dd></> : null}
        <dt>Route</dt><dd>{draft.venueLabel ?? "Uniswap V3"} · {draft.tokenIn.symbol} → {draft.tokenOut.symbol} · pool {draft.pool.slice(0, 6)}…{draft.pool.slice(-4)} · {draft.fee / 10_000}% · ${draft.poolUsdcDepth.toFixed(0)} USDC deep</dd>
        {draft.venues && draft.venues.length > 1 ? <><dt>Venues</dt><dd>{draft.venues.map((v) => `${v.label} $${v.priceUsd.toFixed(2)} ($${Math.round(v.usdcDepth).toLocaleString("en-US")} deep)`).join(" · ")} · the desk took the best price</dd></> : null}
        <dt>Signatures</dt><dd>{draft.txs.map((t) => t.label).join(" + ")}{draft.needsApproval ? "" : ` (${draft.tokenIn.symbol} already approved)`}</dd>
      </dl> : null}
      {linkLost && (tx.stage === "idle" || tx.stage === "failed") ? <LinkLostNotice onReconnect={onReconnect} /> : null}
      {tx.stage === "signing" ? <SignNotice hint={signHint} onPhone={onPhone} onReconnect={onReconnect} /> : null}
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
        <small>{tx.stage === "done" ? "Receipt on Base. Your keys, your trade." : tx.stage === "blocked" ? "Risk said no. Nothing to sign." : tx.stage === "signing" && signHint ? signHint : "They draft. You sign in your wallet."}</small>
      </div>
    </div>
  );
}

// Launch card: el token emparejado en la mesa. Los checks de Bankr se ven
// siempre; Hold to launch solo cuando todos pasan y la simulacion paso.
function LaunchCard({ launch, tx, onLaunch, onFees }: {
  launch: { name: string; symbol: string; pair: { symbol: string; name: string; kind?: string }; recipient: { type: string; value: string }; recipientLabel: string; resolvedRecipient?: string; feeRecipient: string; ownRecipient: boolean; options: { vesting: "on" | "off"; feesIn: "both" | "quote"; degen: boolean; description?: string; websiteUrl?: string; tweetUrl?: string }; deployer: string | null; ownKey: boolean; checks: Array<{ label: string; ok: boolean; note: string }>; ready: boolean; sim: { tokenAddress: string; poolId: string } | null; simError?: string; receipt?: { tokenAddress: string; txHash: string; explorer: string; bankrUrl: string } };
  tx: { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  onLaunch: () => void;
  onFees?: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const armed = (tx.stage === "idle" || tx.stage === "failed") && launch.ready;
  const start = () => {
    if (!armed) return;
    setHolding(true);
    holdRef.current = window.setTimeout(() => { setHolding(false); onLaunch(); }, 2000);
  };
  const cancel = () => { window.clearTimeout(holdRef.current); setHolding(false); };
  const [open, setOpen] = useState(false);
  const decision = tx.stage === "blocked" ? "Wait" : tx.stage === "done" ? "Live" : tx.stage === "pending" ? "Deploying" : tx.stage === "failed" ? "Not deployed" : launch.ready ? "Launch" : "Fix";
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  return (
    <div className={`draft-card launch st-${tx.stage}${open ? " open" : ""}`}>
      <div className="draft-head">
        <b><span className={`decision ${tx.stage === "blocked" || !launch.ready ? "wait" : tx.stage === "done" ? "done" : "go"}`}>{decision}</span> {launch.name} ({launch.symbol}) <small>paired with {launch.pair.symbol} on Base · fees to {launch.ownRecipient ? "your wallet" : launch.recipientLabel}{launch.options.degen ? " · degen" : ""}</small></b>
        <span className="draft-btns">
          {tx.stage === "done" && launch.receipt ? <a className="draft-more share" href={shareLaunchUrl({ name: launch.name, symbol: launch.symbol, pair: launch.pair.symbol, tokenAddress: launch.receipt.tokenAddress })} target="_blank" rel="noreferrer" title="Opens X in your browser with a post about this launch. Nothing is posted until you press Post.">Share on X</a> : null}
          {tx.stage === "done" && onFees ? <button type="button" className="draft-more" onClick={onFees}>Fees</button> : null}
          <button type="button" className="draft-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Less" : "Details"}</button>
        </span>
      </div>
      <ul className="launch-checks">
        {launch.checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "bad"}><i aria-hidden>{c.ok ? "✓" : "✕"}</i><span>{c.label}</span><small>{c.note}</small></li>)}
        <li className={launch.sim ? "ok" : launch.simError ? "bad" : "skip"}><i aria-hidden>{launch.sim ? "✓" : launch.simError ? "✕" : "·"}</i><span>Bankr simulation</span><small>{launch.sim ? `token ${short(launch.sim.tokenAddress)}` : launch.simError ?? "skipped until every check passes"}</small></li>
      </ul>
      {open ? <dl className="draft-rows">
        <dt>Pair</dt><dd>{launch.pair.name} <small>({launch.pair.symbol}{launch.pair.kind === "stock" ? " · Coinbase B20 on Base" : launch.pair.kind === "major" ? " · the default quote" : ""})</small></dd>
        <dt>Pool</dt><dd>Uniswap V4 via Doppler, deployed by Bankr <small>(gas sponsored on Base{launch.options.degen ? " · degen mode, $2,500 starting cap" : ""})</small></dd>
        <dt>Fees pay to</dt><dd>{launch.ownRecipient ? `${short(launch.feeRecipient)}` : launch.recipientLabel}{launch.resolvedRecipient && !launch.ownRecipient ? <small> (Bankr resolved it to {short(launch.resolvedRecipient)})</small> : null} <small>{launch.ownRecipient ? "(the wallet connected here)" : "(someone else: say fees to @handle, name.eth or 0x… to change)"}</small></dd>
        <dt>Split</dt><dd>95% of the pool fee to the recipient · 5% to Bankr · fees in {launch.options.feesIn === "quote" ? "the quote token only" : "the token and the quote"}</dd>
        <dt>Vesting</dt><dd>{launch.options.vesting === "on" ? "15% of supply to the fee recipient over one year, 30 day cliff" : "off: 100% of supply goes to the pool"}</dd>
        <dt>Deployer</dt><dd>{launch.deployer ? short(launch.deployer) : "no Bankr wallet"} <small>{launch.ownKey ? "(your Bankr wallet)" : "(Bankr wallet on this install: it keeps nothing)"}</small></dd>
        {launch.options.description ? <><dt>About</dt><dd>{launch.options.description}</dd></> : null}
        {launch.receipt ? <><dt>Token</dt><dd><a href={`https://basescan.org/token/${launch.receipt.tokenAddress}`} target="_blank" rel="noreferrer">{short(launch.receipt.tokenAddress)}</a> · <a href={launch.receipt.bankrUrl} target="_blank" rel="noreferrer">Bankr ↗</a></dd></> : null}
      </dl> : null}
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
        <button type="button" className={`approve${holding ? " holding" : ""}${tx.stage === "done" ? " done" : ""}${tx.stage === "pending" ? " busy" : ""}`} disabled={!armed} onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} aria-label="Hold to launch">
          <span className="ring" />
          <span className="lbl">{tx.stage === "done" ? "Live" : tx.stage === "blocked" ? "Blocked" : tx.stage === "pending" ? "Deploying on Base…" : tx.stage === "failed" ? "Retry" : launch.ready ? "Hold to launch" : "Checks first"}</span>
        </button>
        <small>{tx.stage === "done" ? `Token live on Base. Fees pay to ${launch.ownRecipient ? "your wallet" : launch.recipientLabel}.` : tx.stage === "blocked" ? "Risk said no. Nothing deployed." : "They draft. You launch. Bankr deploys."}</small>
      </div>
    </div>
  );
}

// Sesion viva sin wallet enlazada: se dice antes de intentar nada, con el boton para reenlazar.
function LinkLostNotice({ onReconnect }: { onReconnect?: () => void }) {
  return (
    <div className="sign-notice lost" role="alert">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 17H7a5 5 0 0 1 0-10h2" /><path d="M15 7h2a5 5 0 0 1 4 8" /><path d="M3 3l18 18" /></svg>
      <div>
        <b>Your wallet is not linked to this window</b>
        <span>You are signed in, but the link to your wallet dropped, so nothing can be signed. Sign in again: More options, WalletConnect, scan the QR.</span>
        <span className="slow">{onReconnect ? <button type="button" onClick={onReconnect}>Sign in again</button> : null}</span>
      </div>
    </div>
  );
}

// Aviso de firma: dice DONDE hay que confirmar. Con login por QR (WalletConnect)
// la peticion llega a la app de la wallet en el celular y solo se ve con esa
// app abierta; si a los 20 s no paso nada, ofrece reconectar la wallet.
function SignNotice({ hint, onPhone, onReconnect }: { hint?: string; onPhone?: boolean; onReconnect?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSlow(true), 20_000); return () => window.clearTimeout(t); }, []);
  return (
    <div className={`sign-notice${onPhone ? " phone" : ""}`} role="status">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{onPhone ? <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></> : <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12.5h2" /></>}</svg>
      <div>
        <b>{onPhone ? "Open your wallet app on your phone" : "Waiting for your wallet"}</b>
        <span>{hint ?? "Confirm in your wallet."}</span>
        {slow ? <span className="slow">{onPhone ? "Nothing on your phone? Keep the wallet app open and unlocked on this request. If it never arrives, the link with your phone is stale: sign in again and scan the QR." : "Still waiting. Check the wallet window."}{onPhone && onReconnect ? <button type="button" onClick={onReconnect}>Sign in again</button> : null}</span> : null}
      </div>
    </div>
  );
}

// Fees card: lo que ganan los tokens lanzados (lectura publica de Bankr) y
// el claim, que firma la persona con su wallet. Hold to claim solo con saldo.
function FeesCard({ fees, tx, onClaim, onRefresh, signHint, onPhone, onReconnect, linkLost }: {
  fees: { address: string; tokens: Array<{ tokenAddress: string; name: string; symbol: string; share: string; token0Label: string; token1Label: string; claimable: { token0: string; token1: string }; claimed: { token0: string; token1: string; count: number } }>; totals: { claimableWeth: string; claimedWeth: string; claimCount: number }; lifetimeEarnedWeth: string; at: string };
  tx: { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; hashes: Array<{ label: string; hash: string; status: string; explorer: string }>; note?: string };
  onClaim: () => void;
  onRefresh: () => void;
  signHint?: string;
  onPhone?: boolean;
  onReconnect?: () => void;
  linkLost?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const num = (v: string) => Number(v) || 0;
  const fmt = (v: string) => { const n = num(v); return n === 0 ? "0" : n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); };
  const withFees = fees.tokens.filter((t) => num(t.claimable.token0) > 0 || num(t.claimable.token1) > 0);
  const armed = (tx.stage === "idle" || tx.stage === "failed") && withFees.length > 0 && !linkLost;
  const start = () => {
    if (!armed) return;
    setHolding(true);
    holdRef.current = window.setTimeout(() => { setHolding(false); onClaim(); }, 2000);
  };
  const cancel = () => { window.clearTimeout(holdRef.current); setHolding(false); };
  const decision = tx.stage === "done" ? "Claimed" : tx.stage === "signing" || tx.stage === "pending" ? "Claiming" : tx.stage === "failed" ? "Not claimed" : withFees.length ? "Claim" : "Fees";
  // Lo reclamable por quote token (NVDA, WETH...), no solo el total en WETH de Bankr.
  const byQuote = new Map<string, number>();
  for (const t of fees.tokens) byQuote.set(t.token0Label, (byQuote.get(t.token0Label) ?? 0) + num(t.claimable.token0));
  const quoteLine = [...byQuote.entries()].filter(([, v]) => v > 0).map(([k, v]) => `${fmt(String(v))} ${k}`).join(" + ");
  const claimedTimes = fees.tokens.reduce((n, t) => n + (t.claimed?.count ?? 0), 0);
  const head = fees.tokens.length === 0 ? "no launches paying this wallet yet" : `${fees.tokens.length} token${fees.tokens.length > 1 ? "s" : ""} · ${tx.stage === "done" ? "claimed just now" : quoteLine ? `${quoteLine} to claim` : "nothing to claim yet"} · claimed ${claimedTimes}×`;
  return (
    <div className={`draft-card fees st-${tx.stage}`}>
      <div className="draft-head">
        <b><span className={`decision ${tx.stage === "done" ? "done" : withFees.length ? "go" : "wait"}`}>{decision}</span> Creator fees <small>{head}</small></b>
        <button type="button" className="draft-more" onClick={onRefresh} title="Bankr refreshes this every 2 minutes">Refresh</button>
      </div>
      {fees.tokens.length ? (
        <ul className="fees-rows">
          {fees.tokens.map((t) => {
            const zero = num(t.claimable.token0) === 0 && num(t.claimable.token1) === 0;
            return (
              <li key={t.tokenAddress} className={zero ? "zero" : ""}>
                <b>{t.symbol}</b>
                <span>{zero ? (tx.stage === "done" ? "claimed, in your wallet" : "nothing to claim") : `${fmt(t.claimable.token0)} ${t.token0Label} + ${fmt(t.claimable.token1)} ${t.token1Label}`}</span>
                <small>{t.share} of the pool fee · claimed {t.claimed.count}×</small>
              </li>
            );
          })}
        </ul>
      ) : <p className="hint-line">Launch a token paired with a tokenized stock and 95% of its pool fee accrues here.</p>}
      {linkLost && (tx.stage === "idle" || tx.stage === "failed") ? <LinkLostNotice onReconnect={onReconnect} /> : null}
      {tx.stage === "signing" ? <SignNotice hint={signHint} onPhone={onPhone} onReconnect={onReconnect} /> : null}
      {tx.note && !(linkLost && /not linked to this window/.test(tx.note)) ? <p className="hint-line err">{tx.note}</p> : null}
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
        <button type="button" className={`approve${holding ? " holding" : ""}${tx.stage === "done" ? " done" : ""}${tx.stage === "signing" || tx.stage === "pending" ? " busy" : ""}`} disabled={!armed} onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} aria-label="Hold to claim">
          <span className="ring" />
          <span className="lbl">{tx.stage === "done" ? "Claimed" : tx.stage === "signing" ? "Sign in your wallet…" : tx.stage === "pending" ? "Claiming on Base…" : tx.stage === "failed" ? "Retry" : withFees.length ? "Hold to claim" : "Nothing to claim"}</span>
        </button>
        <small>{tx.stage === "done" ? "Fees in your wallet. Receipt on Base." : tx.stage === "signing" && signHint ? signHint : "Bankr builds it. You sign. You pay the gas on Base."}</small>
      </div>
    </div>
  );
}

// Automation card: la regla que correra en Bankr (DCA, stop, limit).
function AutomationCard({ auto, tx, onCreate, onOpen }: {
  auto: { kind: string; asset?: string; amountUsd?: number; interval?: string; price?: number; prompt: string; status: string; reply?: string };
  tx: { stage: "idle" | "signing" | "pending" | "done" | "failed" | "blocked"; note?: string };
  onCreate: () => void;
  onOpen: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(0);
  const armed = tx.stage === "idle" || tx.stage === "failed";
  const start = () => {
    if (!armed) return;
    setHolding(true);
    holdRef.current = window.setTimeout(() => { setHolding(false); onCreate(); }, 2000);
  };
  const cancel = () => { window.clearTimeout(holdRef.current); setHolding(false); };
  const kind = auto.kind === "dca" ? "DCA" : auto.kind === "stop" ? "Stop loss" : auto.kind === "limit" ? "Limit buy" : "Schedule";
  const what = auto.kind === "dca" ? `$${auto.amountUsd ?? 5} of ${auto.asset} ${auto.interval ?? "every week"}` : auto.kind === "stop" ? `${auto.asset} at $${auto.price ?? 0}` : auto.kind === "limit" ? `$${auto.amountUsd ?? 5} of ${auto.asset} at $${auto.price ?? 0}` : auto.prompt;
  const decision = tx.stage === "done" ? "Running" : tx.stage === "pending" ? "Creating" : tx.stage === "failed" ? "Not created" : kind;
  return (
    <div className={`draft-card automation st-${tx.stage}`}>
      <div className="draft-head">
        <b><span className={`decision ${tx.stage === "done" ? "done" : tx.stage === "failed" ? "wait" : "go"}`}>{decision}</span> {what} <small>runs in Bankr from your Bankr wallet</small></b>
        {tx.stage === "done" ? <button type="button" className="draft-more" onClick={onOpen}>Automations</button> : null}
      </div>
      <dl className="draft-rows">
        <dt>Asks Bankr</dt><dd>{auto.prompt}</dd>
        {auto.reply ? <><dt>Bankr said</dt><dd>{auto.reply.slice(0, 400)}</dd></> : null}
      </dl>
      {tx.note ? <p className="hint-line err">{tx.note}</p> : null}
      <div className="draft-actions">
        <button type="button" className={`approve${holding ? " holding" : ""}${tx.stage === "done" ? " done" : ""}${tx.stage === "pending" ? " busy" : ""}`} disabled={!armed} onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} aria-label="Hold to create">
          <span className="ring" />
          <span className="lbl">{tx.stage === "done" ? "Live" : tx.stage === "pending" ? "Asking Bankr…" : tx.stage === "failed" ? "Retry" : "Hold to create"}</span>
        </button>
        <small>{tx.stage === "done" ? "Bankr runs it. Pause or cancel from Automations." : "They draft. You create. Bankr runs it."}</small>
      </div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}
function RocketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 15l-2 6 6-2" /><path d="M14 4c3-1 6-1 7 0 1 1 1 4 0 7l-8 8-7-7 8-8z" /><circle cx="15" cy="9" r="1.6" />
    </svg>
  );
}
function LoopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
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
function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="19" cy="18" r="2.2" />
      <path d="M7 11l10-4M7 13l10 4" />
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

/** @Scout, @Risk, @Trader, @Auditor, @Sparky como chips de color en las burbujas.
 *  @Floor sigue reconocido por las decisiones guardadas antes del cambio de nombre. */
function mentions(text: string): React.ReactNode {
  const parts = text.split(/(@(?:Scout|Risk|Trader|Auditor|Sparky|Floor)\b)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => {
    const mm = p.match(/^@(Scout|Risk|Trader|Auditor|Sparky|Floor)$/);
    return mm ? <span key={i} className={`m ${mm[1] === "Floor" ? "sparky" : mm[1].toLowerCase()}`}>{p}</span> : <span key={i}>{p}</span>;
  });
}
function HistoryIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></svg>;
}
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Sonda de tamano (ronda responsive 2026-09-16): ancho x alto de la ventana
// abajo a la derecha, para calibrar breakpoints en vivo. Apagada por defecto;
// se activa descomentando <SizeProbe /> en la escena.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SizeProbe() {
  const [size, setSize] = useState("");
  useEffect(() => {
    const read = () => setSize(`${window.innerWidth} × ${window.innerHeight}`);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return <div className="size-probe" aria-hidden="true">{size}</div>;
}

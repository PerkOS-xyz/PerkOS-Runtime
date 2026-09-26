"use client";

import type { DeskStarter } from "@perkos/desk-contract";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";

import { ChatChips, ChatsDrawer } from "../chat/ChatsDrawer";
import { useChatActions, useChats } from "../chat/useChats";
import { useSparkyChat } from "../chat/useSparkyChat";
import type { DraftAnswer } from "../lib/launchDraft";
import { launchFactsOf, launchQuestion } from "../lib/launchTurn";
import type { TurnReceipt } from "../lib/turnRecord";
import { openMemory } from "../memory/open";
import { AppHeader } from "../shell/AppHeader";
import { useVault } from "../shell/useVault";
import { wakeAction } from "../team/look";
import { TeamRow } from "../team/TeamRow";
import { useTeam } from "../team/useTeam";
import { ChatLine, TypingLine } from "../turn/ChatLine";
import { focusLine } from "../turn/TurnCards";
import { routeFor } from "../turn/turnChat";
import { chatOfTurn, FOCUS_HOLD_MS } from "../turn/turnLook";
import { planOfView } from "../turn/turnPlan";
import { useDeskAssets, useTurnChat } from "../turn/useTurnChat";
import { WorkFold, WorkingList } from "../turn/WorkingList";
import { useTalk } from "../voice/useTalk";
import { useWallet } from "../wallet/context";
import { CHAIN_LABEL, chainOf } from "./chains";
import type { Desk } from "./DesksScreen";
import { Embers } from "./Embers";
import { IdentitySheet } from "./IdentitySheet";
import { HistorySheet } from "./HistorySheet";
import { LaunchCard } from "./LaunchCard";
import { draftKey, launchIntent, type LaunchSeed } from "./launchForm";
import { StartersRow } from "../chat/StartersRow";
import { MarketSheet } from "./MarketSheet";
import { PortfolioSheet } from "./PortfolioSheet";
import { subscribeTurnReceipts, turnReceipt } from "./turnReceipts";
import { WalletTraderSheet, type TraderPrefill } from "./WalletTraderSheet";
import { coreState, DEFAULT_STARTERS, isAnswering, whisper } from "./stage";
import { useDeskManifest } from "./useDeskManifest";

/** What the person says when they tap the launch action among the first questions. */
const LAUNCH_STARTER = "Launch a token paired with a stock";
/** Sparky's line over the launch card: what happens, and who signs what. */
const LAUNCH_LINE =
  "Here is a launch card for Robinhood Chain. Bankr deploys the token and its Uniswap v4 pool from your Bankr wallet, which pays the gas. You sign nothing on chain, and nothing launches until you hold.";

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
  const vault = useVault(useWallet());
  const chats = useChats({ scope: desk.id, chat, unlocked: vault.unlocked });
  const [identity, setIdentity] = useState(false);
  const closeIdentity = useCallback(() => setIdentity(false), []);
  const [market, setMarket] = useState(false);
  const closeMarket = useCallback(() => setMarket(false), []);
  const [trader, setTrader] = useState(false);
  const closeTrader = useCallback(() => setTrader(false), []);
  const [history, setHistory] = useState(false);
  const closeHistory = useCallback(() => setHistory(false), []);
  const [portfolio, setPortfolio] = useState(false);
  const closePortfolio = useCallback(() => setPortfolio(false), []);
  // From an empty Portfolio to the Trader, where the owner gives access and buys.
  const portfolioToTrader = useCallback(() => {
    setPortfolio(false);
    setTrader(true);
  }, []);
  // A token launch card in the conversation, under Sparky's line that opened it.
  const [launch, setLaunch] = useState<{ anchor: string; seed: LaunchSeed; n: number } | null>(null);
  // The launch the team last read: its verdict shows on the card while the draft stays the same.
  const [launchTurnKey, setLaunchTurnKey] = useState("");
  // Spoken questions go through the same router as typed ones, so a task said out loud reaches the team.
  const { voice, talk, talkReply, hold, release } = useTalk(chat, { route: (text) => dispatch(text), command: (text) => saved.command(text, true) });
  const manifest = useDeskManifest(desk.module);
  const team = useTeam(desk.id);
  const waking = wakeAction(team.team?.status, team.busy);
  const [draft, setDraft] = useState("");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const assets = useDeskAssets(desk.module, Boolean(manifest && Object.keys(manifest.turns).length));
  const turn = useTurnChat({ desk: desk.id, chat, voice: voiceReady ? { reply: talkReply, hold, release } : null });
  /** Each turn's facts, for the [Fn] tags in its answers. */
  const factsByTurn = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const m of chat.messages) if (m.role === "team" && m.kind === "principal" && m.turnId && m.facts) out.set(m.turnId, m.facts);
    return out;
  }, [chat.messages]);
  const typing = turn.view.order.filter((role) => turn.view.roles[role]?.status === "thinking");
  const convoRef = useRef<HTMLElement>(null);
  /** Until when the conversation stays on the line Focus brought into view. */
  const heldUntil = useRef(0);
  const inChat = useMemo(() => chatOfTurn(chat.messages, turn.view.turnId), [chat.messages, turn.view.turnId]);
  const focus = useCallback((role: string) => {
    if (convoRef.current && focusLine(convoRef.current, role)) heldUntil.current = Date.now() + FOCUS_HOLD_MS;
  }, []);
  /** The Trader's plan, once the turn is over, and the receipt of a buy that followed it. */
  const plan = useMemo(() => planOfView(turn.view, manifest?.maxOrder), [turn.view, manifest?.maxOrder]);
  const receipt = useTurnReceipt(turn.view.turnId);
  // What Buy in Trader filled the Trader with, while the sheet it opened is open.
  const [prefill, setPrefill] = useState<TraderPrefill | null>(null);
  const planUsed = useCallback(() => setPrefill(null), []);
  useEffect(() => {
    if (!trader) setPrefill(null);
  }, [trader]);
  /** Opens the Trader with the plan filled in. Nothing is quoted or signed until the person asks for a quote and holds. */
  const buyPlan = useCallback(() => {
    const turnId = turn.view.turnId;
    if (!plan || !turnId) return;
    setPrefill({ turnId, ticker: plan.ticker, amount: plan.amount, startedAt: turn.view.startedAt, key: Date.now() });
    setIdentity(false);
    setMarket(false);
    setHistory(false);
    setPortfolio(false);
    setTrader(true);
  }, [plan, turn.view.turnId, turn.view.startedAt]);
  // Offered on a desk that trades, until the person signed from the plan.
  const onBuy = plan && !receipt && desk.module && manifest?.screens.includes("trader") ? buyPlan : undefined;

  useEffect(() => {
    fetch("/api/voice")
      .then((res) => (res.ok ? (res.json() as Promise<{ stt: string }>) : { stt: "none" }))
      .then((cfg) => setVoiceReady(cfg.stt !== "none"))
      .catch(() => setVoiceReady(false));
  }, []);

  useEffect(() => {
    if (Date.now() < heldUntil.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages, typing.length, turn.view.steps.length]);

  const state = coreState(voice.status, chat.busy || turn.live, isAnswering(chat.busy, chat.messages));
  const split = chat.messages.length > 0;
  const working = chat.busy || voice.status === "speaking" || turn.live;
  const saved = useChatActions(chats, {
    working,
    stop,
    settle: () => {
      chat.abort();
      turn.stop();
    }
  });
  const starters = manifest?.starters.length ? manifest.starters : DEFAULT_STARTERS;

  /**
   * Opens the launch card with what the person said about the token. The card
   * sits under Sparky's line; a new chat or a saved one on screen closes it,
   * and a launch already sent keeps going above the card either way.
   */
  function openLaunch(seed: LaunchSeed, said?: string) {
    if (said) chat.post({ role: "user", content: said });
    const anchor = chat.post({ role: "assistant", content: LAUNCH_LINE });
    setLaunch((l) => ({ anchor, seed, n: (l?.n ?? 0) + 1 }));
  }

  /**
   * A drafted launch that passed Bankr's checks and simulation goes to the
   * team once, when the desk gives it a launch turn: Scout, Risk and the
   * specialists read it, the Auditor records it. Risk's verdict only warns;
   * the hold stays the person's.
   */
  function launchChecked(answer: DraftAnswer) {
    const key = draftKey(answer.draft);
    if (!answer.ready || !manifest?.turns.launch || turn.live || key === launchTurnKey) return;
    setLaunchTurnKey(key);
    const facts = launchFactsOf(answer);
    void turn.ask(launchQuestion(facts), "launch", { launch: facts, ...(answer.draft.pair.kind === "stock" ? { tickers: [answer.draft.pair.symbol] } : {}) });
  }

  /**
   * Where the person's words go, typed or spoken: a desk task to the team,
   * anything else to Sparky alone, and everything to Sparky while the team
   * works. Sparky answers out loud when voice works here, and in text either way.
   */
  function dispatch(text: string, starter?: DeskStarter) {
    const t = text.trim();
    if (!t) return;
    // Asking to launch a token opens the launch card instead of a turn or a reply.
    const seed = chain === "robinhood" && desk.module && !starter?.turn ? launchIntent(t) : null;
    if (seed) {
      openLaunch(seed, t);
      return;
    }
    const route = routeFor(t, { manifest, ...(assets ? { assets } : {}), starter: starter ?? null, live: turn.live });
    if (route.to === "team") {
      void turn.ask(t, route.kind);
      return;
    }
    const options = { ...(route.tone ? { tone: route.tone } : {}), ...(!turn.live && turn.lastTurn ? { about: turn.lastTurn } : {}) };
    if (voiceReady) talk(t, options);
    else void chat.send(t, {}, options);
  }

  function send(text: string, starter?: DeskStarter) {
    if (!text.trim()) return;
    setDraft("");
    if (saved.command(text.trim(), false) !== null) return;
    dispatch(text, starter);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  /** Stops Sparky and the wait for the team. PerkOS cannot cancel a task, so an agent already asked may still finish there. */
  function stop() {
    voice.stopAll();
    chat.abort();
    turn.stop();
  }

  return (
    <main className={`stage ${chain}${split ? " split" : ""}${market || trader || history || portfolio || identity ? " panel" : ""}`}>
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
              <button type="button" className="ah-out" aria-pressed={market} onClick={() => { setIdentity(false); setMarket((v) => !v); }}>
                Market
              </button>
            ) : null}
            {desk.module && manifest?.screens.includes("portfolio") ? (
              <button
                type="button"
                className="ah-out"
                aria-pressed={portfolio}
                onClick={() => {
                  setIdentity(false);
                  setMarket(false);
                  setTrader(false);
                  setHistory(false);
                  setPortfolio((v) => !v);
                }}
              >
                Portfolio
              </button>
            ) : null}
            {desk.module && manifest?.screens.includes("trader") ? (
              <button
                type="button"
                className="ah-out"
                aria-pressed={trader}
                onClick={() => {
                  setIdentity(false);
                  setMarket(false);
                  setHistory(false);
                  setPortfolio(false);
                  setTrader((v) => !v);
                }}
              >
                Trader
              </button>
            ) : null}
            {manifest?.screens.includes("history") ? (
              <button
                type="button"
                className="ah-out"
                aria-pressed={history}
                onClick={() => {
                  setIdentity(false);
                  setMarket(false);
                  setTrader(false);
                  setPortfolio(false);
                  setHistory((v) => !v);
                }}
              >
                History
              </button>
            ) : null}
            <button type="button" className="ah-out" aria-pressed={identity} onClick={() => { setMarket(false); setTrader(false); setHistory(false); setPortfolio(false); setIdentity((v) => !v); }}>
              Identity
            </button>
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

        <TeamRow
          team={team.team}
          turn={turn.live || inChat.held ? { view: turn.view, lines: inChat.lines, onFocus: focus, receipt, onBuy, buyTitle: plan ? `${plan.ticker} for ${plan.amount} USDG` : undefined } : null}
        />

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
          {!split ? (
            <p className="st-hello" aria-live="polite">
              {saved.caption || `You are in ${desk.name}. Ask me anything about it, or tap me to talk.`}
            </p>
          ) : null}
        </div>

        {split ? (
          <section ref={convoRef} className="st-convo" aria-label="Conversation with Sparky">
            {chat.messages.map((m) => (
              <ChatLine key={m.id} message={m} typing={chat.replying.includes(m.id)} facts={m.role === "team" && m.turnId ? factsByTurn.get(m.turnId) : undefined}>
                {m.role === "assistant" && m.work ? <WorkFold work={m.work} /> : null}
              </ChatLine>
            ))}
            {launch && desk.module && chat.messages.some((m) => m.id === launch.anchor) ? (
              <LaunchCard
                key={launch.n}
                module={desk.module}
                seed={launch.seed}
                onSettings={onSettings}
                onClose={() => setLaunch(null)}
                onChecked={launchChecked}
                team={turn.view.kind === "launch" && launchTurnKey ? { key: launchTurnKey, live: turn.live, verdict: turn.view.verdict ?? null } : null}
              />
            ) : null}
            {turn.live ? <WorkingList view={turn.view} /> : null}
            {typing.map((role) => (
              <TypingLine key={`typing-${role}`} role={role} />
            ))}
            {chat.error ? <p className="hint err">{chat.error}</p> : null}
            <div ref={endRef} />
          </section>
        ) : (
          <StartersRow>
            {starters.map((s, i) => (
              <button key={s.text} type="button" style={{ "--i": i } as CSSProperties} onClick={() => send(s.text, s)}>
                {s.text}
                <small>{s.tag}</small>
              </button>
            ))}
            {chain === "robinhood" && desk.module ? (
              <button type="button" className="st-launch" style={{ "--i": starters.length } as CSSProperties} onClick={() => openLaunch({}, LAUNCH_STARTER)}>
                {LAUNCH_STARTER}
                <small>Bankr deploys it. You hold to launch.</small>
              </button>
            ) : null}
          </StartersRow>
        )}

        <ChatChips chats={chats} hasMessages={split} onNew={() => saved.newChat()} />
        {chats.open ? <ChatsDrawer scope={desk.id} chats={chats} vault={vault} onNew={() => saved.newChat()} onOpen={saved.openSaved} /> : null}

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
            <button type="button" className="st-ask-btn send" aria-label="Stop" title={turn.live ? "Stop waiting for the team" : "Stop"} onClick={stop}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : null}
          {working && !draft.trim() ? null : (
            <button type="submit" className="st-ask-btn send" aria-label="Send" disabled={!draft.trim()}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {identity ? <IdentitySheet key={desk.id} desk={desk.id} title={desk.name} chain={chain} onClose={closeIdentity} /> : null}
      {market && desk.module ? <MarketSheet title={desk.name} module={desk.module} chain={chain} onAsk={send} onClose={closeMarket} /> : null}
      {trader && !market && desk.module ? (
        <WalletTraderSheet title={desk.name} module={desk.module} chain={chain} onClose={closeTrader} prefill={prefill} onPlanUsed={planUsed} />
      ) : null}
      {history && !market && !trader ? <HistorySheet desk={desk.id} title={desk.name} chain={chain} live={turn.live} vault={vault} onClose={closeHistory} /> : null}
      {portfolio && !market && !trader && !history && desk.module ? (
        <PortfolioSheet
          title={desk.name}
          module={desk.module}
          chain={chain}
          onTrader={manifest?.screens.includes("trader") ? portfolioToTrader : undefined}
          onClose={closePortfolio}
        />
      ) : null}
    </main>
  );
}

/** The receipt this window keeps for a turn, from a buy that followed its plan. */
function useTurnReceipt(turnId: string | null): TurnReceipt | null {
  const read = useCallback(() => turnReceipt(turnId), [turnId]);
  return useSyncExternalStore(subscribeTurnReceipts, read, () => null);
}

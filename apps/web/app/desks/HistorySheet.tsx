"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { TurnRecord, TurnRow } from "../lib/turnRecord";
import type { VaultState } from "../shell/useVault";
import { AgentPortrait } from "../team/AgentPortrait";
import { roleConfig, sphereAccent, type AgentAvatarState } from "../team/avatarIdentity";
import { Rich } from "../turn/ChatLine";
import { TurnCard } from "../turn/TurnCards";
import { cardLook } from "../turn/turnLook";
import type { Chain } from "./chains";
import { clockOf, dayOf, factParts, HISTORY_LIMIT, MEMORY_OFF_NOTE, partsOf, replayView, secondsOf, whyOf, type HistoryList, type PartTone } from "./history";

type ListStatus = "loading" | "ready" | "signed_out" | "error";
type TurnStatus = "loading" | "ready" | "missing" | "error";

const roleStyle = (role: string) => ({ "--role": sphereAccent(role) }) as CSSProperties;
/** A part's portrait reads the way its card does: answered, slept, failed, or stopped. */
const PART_STATE: Record<PartTone, AgentAvatarState> = { done: "success", warn: "warning", error: "error", dim: "idle" };

/**
 * The desk's History, opened from the right over the desk like Market and
 * Trader: every turn of this desk, newest first, and each one replayed with
 * why it went that way. Escape steps back: out of forgetting, out of the
 * turn, then closes.
 */
export function HistorySheet({
  desk,
  title,
  chain,
  live,
  vault,
  onClose
}: {
  desk: string;
  title: string;
  chain: Chain;
  /** A turn runs on this desk now: the list reads again once it is over. */
  live: boolean;
  vault: VaultState;
  onClose: () => void;
}) {
  const [list, setList] = useState<HistoryList | null>(null);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [turn, setTurn] = useState<TurnRecord | null>(null);
  const [turnStatus, setTurnStatus] = useState<TurnStatus>("loading");
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [note, setNote] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  // The turn last asked for, so a slow answer for another one is dropped.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/desks/turns?desk=${encodeURIComponent(desk)}&limit=${HISTORY_LIMIT}`).catch(() => null);
    if (res?.status === 401) return setStatus("signed_out");
    const body = res?.ok ? ((await res.json().catch(() => null)) as HistoryList | null) : null;
    if (!body?.turns) return setStatus("error");
    setList(body);
    setStatus("ready");
  }, [desk]);

  useEffect(() => {
    void load();
  }, [load, live, vault.unlocked]);

  const openTurn = useCallback(async (id: string) => {
    wanted.current = id;
    setOpenId(id);
    setTurn(null);
    setTurnStatus("loading");
    setConfirming(false);
    setNote("");
    const res = await fetch(`/api/desks/turns?id=${encodeURIComponent(id)}`).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as { turn?: TurnRecord } | null) : null;
    if (wanted.current !== id) return;
    if (res?.status === 404) return setTurnStatus("missing");
    if (!body?.turn) return setTurnStatus("error");
    setTurn(body.turn);
    setTurnStatus("ready");
  }, []);

  const back = useCallback(() => {
    wanted.current = null;
    setOpenId(null);
    setTurn(null);
    setConfirming(false);
    setNote("");
  }, []);

  async function forget() {
    if (!turn) return;
    setForgetting(true);
    const res = await fetch(`/api/desks/turns?id=${encodeURIComponent(turn.id)}`, { method: "DELETE" }).catch(() => null);
    setForgetting(false);
    // Already gone is as good as forgotten.
    if (!res?.ok && res?.status !== 404) return setNote("Could not forget this turn. Try again in a moment.");
    back();
    void load();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else if (openId) back();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, openId, back, onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [openId]);

  return (
    <aside className={`mk-sheet hs-sheet ${chain}`} aria-label={`${title} history`}>
      <div className="mk-sheet-bar">
        <span className="kicker">History</span>
        <button type="button" className="bubble-close" aria-label="Close History" onClick={onClose}>
          &times;
        </button>
      </div>
      <div ref={bodyRef} className="hs-body">
        {openId ? (
          <>
            <div className="hs-turn-bar">
              <button type="button" className="link-btn mem-back" onClick={back}>
                ← All turns
              </button>
              {turn && !confirming ? (
                <button type="button" className="link-btn danger" onClick={() => setConfirming(true)}>
                  Forget this turn
                </button>
              ) : null}
            </div>
            {confirming ? (
              <div className="mem-confirm hs-confirm" role="alertdialog" aria-label="Forget this turn">
                <p>
                  {list?.memory === "off"
                    ? "Forget this turn? It leaves this session's History. This cannot be undone."
                    : "Forget this turn? History, Memory and the desk's team will no longer have it. This cannot be undone."}
                </p>
                <div className="memory-actions">
                  <button type="button" className="chip-btn danger" disabled={forgetting} onClick={() => void forget()}>
                    {forgetting ? "Forgetting…" : "Forget"}
                  </button>
                  <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : null}
            {note ? (
              <p className="hint err" role="alert">
                {note}
              </p>
            ) : null}
            {turnStatus === "loading" ? <Skeleton rows={3} tall /> : null}
            {turnStatus === "missing" ? <p className="tr-note">This turn is no longer kept.</p> : null}
            {turnStatus === "error" ? (
              <p className="hint err" role="alert">
                Could not open this turn.{" "}
                <button type="button" className="link-btn" onClick={() => void openTurn(openId)}>
                  Try again
                </button>
              </p>
            ) : null}
            {turn ? <TurnReplay record={turn} /> : null}
          </>
        ) : (
          <TurnList list={list} status={status} vault={vault} onOpen={(id) => void openTurn(id)} onRetry={() => void load()} />
        )}
      </div>
    </aside>
  );
}

/** Every turn of the desk, newest first, on a spine lit in ember where the person signed. */
function TurnList({
  list,
  status,
  vault,
  onOpen,
  onRetry
}: {
  list: HistoryList | null;
  status: ListStatus;
  vault: VaultState;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  if (status === "signed_out") return <p className="tr-note">Sign in to PerkOS to see this desk&apos;s turns.</p>;
  if (status === "error" && !list) {
    return (
      <p className="hint err" role="alert">
        Could not read History.{" "}
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }
  const turns = list?.turns ?? [];
  return (
    <>
      <header className="hs-head">
        <div>
          <h2>Every turn</h2>
          <p>What the team was asked, what each agent said, and why it went that way. Newest first.</p>
        </div>
        {list ? (
          <span className="hs-count">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </span>
        ) : null}
      </header>
      {list?.memory === "off" ? <MemoryOff vault={vault} /> : null}
      {list?.live ? (
        <p className="hs-live">
          <i aria-hidden />
          The team is on a turn now. It lands here once it is over.
        </p>
      ) : null}
      {!list ? (
        <Skeleton rows={4} />
      ) : turns.length ? (
        <ol className="hs-list">
          {turns.map((t, i) => (
            <TurnRowLine key={t.id} turn={t} index={i} onOpen={onOpen} />
          ))}
        </ol>
      ) : (
        <div className="hs-empty">
          <span className="hs-empty-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <b>No turns yet</b>
          <p>Give the desk a task, and the turn lands here: what each agent said, how long it took, and why it went that way.</p>
        </div>
      )}
      {turns.length >= HISTORY_LIMIT ? <p className="tr-note">The last {HISTORY_LIMIT} turns. Older ones stay in Memory.</p> : null}
    </>
  );
}

function TurnRowLine({ turn: t, index, onOpen }: { turn: TurnRow; index: number; onOpen: (id: string) => void }) {
  const missed = !t.stopped && t.failed.length > 0;
  const names = t.failed.map((r) => roleConfig(r).label);
  return (
    <li style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <button type="button" className={`hs-row${t.signed ? " signed" : ""}${missed ? " missed" : ""}`} onClick={() => onOpen(t.id)}>
        <span className="hs-when">
          <b>{clockOf(t.startedAt)}</b>
          <small>{dayOf(t.startedAt)}</small>
        </span>
        <i className="hs-node" aria-hidden />
        <span className="hs-main">
          <span className="hs-q">{t.question}</span>
          <span className="hs-meta">
            <span className="hs-kind">{t.kind}</span>
            {t.riskLevel ? <span className={`hs-risk ${t.riskLevel}`}>{t.riskLevel} risk</span> : null}
            {t.verdict ? <span className={`hs-risk ${t.verdict === "GO" ? "low" : "high"}`}>{t.verdict}</span> : null}
            <span>{secondsOf(t.ms)}</span>
            <span className={`hs-sign${t.signed ? " on" : ""}`}>{t.signed ? "signed" : "unsigned"}</span>
            {t.stopped ? <span className="hs-miss dim">stopped waiting</span> : null}
            {missed ? <span className="hs-miss">{names.length > 2 ? "the team did not answer" : `no answer: ${names.join(", ")}`}</span> : null}
          </span>
        </span>
        <span className="hs-go" aria-hidden>
          ›
        </span>
      </button>
    </li>
  );
}

function MemoryOff({ vault }: { vault: VaultState }) {
  return (
    <div className="hs-memory" role="note">
      <p>{MEMORY_OFF_NOTE}</p>
      {vault.unlocked === false && !vault.conflict ? (
        <button type="button" className="chip-btn" disabled={vault.busy} onClick={() => void vault.unlock()}>
          {vault.busy ? "Waiting for the signature…" : "Turn on memory"}
        </button>
      ) : null}
      {vault.error ? <p className="hint err">{vault.error}</p> : null}
    </div>
  );
}

function Skeleton({ rows, tall = false }: { rows: number; tall?: boolean }) {
  return (
    <div className={`hs-skel${tall ? " tall" : ""}`} aria-label="Reading History" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

/**
 * One kept turn: the four cards as they ended, why it went that way, then
 * each agent's whole answer or the exact reason there is none, and folded
 * away, the facts and what the team was asked.
 */
export function TurnReplay({ record }: { record: TurnRecord }) {
  const view = replayView(record);
  const parts = partsOf(record);
  const why = whyOf(record);
  const signed = Boolean(record.receipt);
  const asked = [...view.order.filter((r) => r in record.prompts), ...Object.keys(record.prompts).filter((r) => !view.order.includes(r))];
  return (
    <article className="hs-turn" aria-label={`Turn: ${record.question}`}>
      <header className="hs-turn-head">
        <span className="hs-kicker">
          {record.kind} · {dayOf(record.startedAt)} {clockOf(record.startedAt)}
        </span>
        <h3>{record.question}</h3>
        <div className="hs-meta">
          {record.riskLevel ? <span className={`hs-risk ${record.riskLevel}`}>{record.riskLevel} risk</span> : null}
          {record.verdict ? <span className={`hs-risk ${record.verdict === "GO" ? "low" : "high"}`}>verdict {record.verdict}</span> : null}
          <span>{secondsOf(record.ms)} total</span>
          <span className={`hs-sign${signed ? " on" : ""}`}>{record.receipt ? `signed · ${record.receipt.ticker} ${record.receipt.amount}` : "unsigned"}</span>
        </div>
      </header>
      {record.error ? <p className="hs-ended">Ended early: {record.error.message}</p> : null}
      {record.stopped ? (
        <p className="hs-quiet">You stopped waiting for this turn. Agents already asked may still have finished on PerkOS; those answers are not kept.</p>
      ) : null}

      {view.order.length ? (
        <div className="hs-cards" aria-label="Each agent's card">
          {view.order.map((role, i) => {
            const look = cardLook(view, role, { index: i + 1, now: view.endedAt ?? 0, receipt: signed });
            return look ? <TurnCard key={role} look={look} replay /> : null;
          })}
        </div>
      ) : null}

      <section className="hs-sec hs-why" aria-label="Why">
        <h4>Why</h4>
        <ul>
          {why.map((w) => (
            <li key={w.who} className={`${w.who}${w.missing ? " missing" : ""}`} style={w.who === "sparky" ? undefined : roleStyle(w.who)}>
              {w.who === "sparky" ? <img className="hs-sparky" src="/sparky-samurai-head.png" alt="" /> : <AgentPortrait role={w.who} size={26} />}
              <b>
                {w.label}
                {w.level ? <span className={`hs-risk ${w.level}`}>{w.level}</span> : null}
                {w.verdict ? <span className={`hs-risk ${w.verdict === "GO" ? "low" : "high"}`}>{w.verdict}</span> : null}
              </b>
              <p>{w.missing ? w.text : <Rich text={w.text} facts={record.facts} />}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="hs-sec hs-said" aria-label="What each agent said">
        <h4>What each agent said</h4>
        {parts.length ? (
          parts.map((p) => (
            <div key={p.role} className={`hs-part ${p.tone}`} style={roleStyle(p.role)}>
              <header>
                <AgentPortrait role={p.role} state={PART_STATE[p.tone]} size={28} label={p.name} />
                <b>{p.name}</b>
                {p.agentName ? <small title={p.agentName}>{p.agentName}</small> : null}
                {p.time ? <span className="hs-part-time">{p.time}</span> : null}
              </header>
              {p.ok ? (
                <p>
                  <Rich text={p.text} facts={record.facts} />
                </p>
              ) : (
                <p className="hs-fail">{p.failure}</p>
              )}
            </div>
          ))
        ) : (
          <p className="tr-note">The team was not asked in this turn.</p>
        )}
      </section>

      <details className="hs-fold">
        <summary>
          Facts given<span>{record.facts.length}</span>
        </summary>
        <div className="hs-fold-body">
          {record.facts.length ? (
            <ol className="hs-facts">
              {record.facts.map((line) => {
                const f = factParts(line);
                return (
                  <li key={line}>
                    {f.n !== null ? <abbr className="st-fact">F{f.n}</abbr> : null}
                    <span>{f.text}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="tr-note">No facts were attached to this turn.</p>
          )}
          {record.memory ? (
            <p className="hs-memo">
              <b>From the desk&apos;s memory</b>
              {record.memory}
            </p>
          ) : null}
        </div>
      </details>

      <details className="hs-fold">
        <summary>What the team was asked</summary>
        <div className="hs-fold-body">
          <dl className="hs-asked">
            <dt>Sparky to the team</dt>
            <dd>
              <p>
                <Rich text={record.principal} />
              </p>
            </dd>
            {record.head ? (
              <>
                <dt>Every agent got</dt>
                <dd>
                  <pre>{record.head}</pre>
                </dd>
              </>
            ) : null}
            {asked.map((role) => (
              <Fragment key={role}>
                <dt style={roleStyle(role)}>Then {roleConfig(role).label} got</dt>
                <dd>
                  <pre>{record.prompts[role]}</pre>
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </details>
    </article>
  );
}

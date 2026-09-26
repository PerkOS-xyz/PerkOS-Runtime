"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { AgentPortrait } from "../team/AgentPortrait";
import { sphereAccent } from "../team/avatarIdentity";
import { cardsMode, FOLD_AFTER_MS, type CardLook, type CardsMode } from "./turnLook";
import type { TurnView } from "./turnState";

/** A desk turn as the team row draws it under the seats. */
export interface SeatTurn {
  view: TurnView;
  /** Roles with a line of this turn in the conversation. */
  lines: ReadonlySet<string>;
  /** Brings a role's last line of the conversation into view. */
  onFocus: (role: string) => void;
}

/** The moment the cards are drawn at: every second while the turn runs, then once more when they fold. */
export function useTurnClock(view: TurnView | null): { now: number; mode: CardsMode } {
  const [now, setNow] = useState(() => Date.now());
  const turnId = view?.turnId ?? null;
  const live = view?.live === true;
  const endedAt = view?.endedAt ?? null;
  useEffect(() => {
    if (!turnId) return;
    setNow(Date.now());
    if (live) {
      const timer = setInterval(() => setNow(Date.now()), 1_000);
      return () => clearInterval(timer);
    }
    const fold = setTimeout(() => setNow(Date.now()), Math.max(0, (endedAt ?? Date.now()) + FOLD_AFTER_MS - Date.now()) + 20);
    return () => clearTimeout(fold);
  }, [turnId, live, endedAt]);
  return { now, mode: view ? cardsMode(view, now) : "none" };
}

/** How long a line Focus brought into view stays lit. */
const FLASH_MS = 1_600;

/**
 * Brings a role's last line of the conversation into view and lights it for
 * a moment. False when the conversation has no line of that role.
 */
export function focusLine(convo: HTMLElement, role: string): boolean {
  const lines = convo.querySelectorAll<HTMLElement>(`.st-turn.team[data-who="${CSS.escape(role)}"]`);
  const line = lines[lines.length - 1];
  if (!line) return false;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  convo.scrollTo({ top: Math.max(0, line.offsetTop - (convo.clientHeight - line.offsetHeight) / 2), behavior: still ? "auto" : "smooth" });
  line.classList.remove("st-focus");
  // Read the layout once, so a second Focus on the same line lights it again.
  void line.offsetWidth;
  line.classList.add("st-focus");
  window.setTimeout(() => line.classList.remove("st-focus"), FLASH_MS);
  return true;
}

/**
 * One agent's part of the turn: a card with its head, its time, its result,
 * its three steps and Focus while the turn runs, and a chip with the result
 * once it folds. Focus, or the chip, shows the agent's last line in the
 * conversation.
 */
export function TurnCard({ look, onFocus }: { look: CardLook; onFocus?: (() => void) | undefined }) {
  const style = { "--role": sphereAccent(look.role) } as CSSProperties;
  const tip = look.detail ? `${look.summary}\n${look.detail}` : look.summary;
  return (
    <div className={`st-card ${look.tone}`} data-role={look.role} style={style} title={tip}>
      <div className="st-card-full">
        <div className="st-card-head">
          <AgentPortrait role={look.role} state={look.avatar ?? "idle"} size={18} label={look.name} />
          <span className="st-card-title">{look.title}</span>
          <span className="st-card-time">{look.time}</span>
        </div>
        <div className="st-card-screen">
          {look.metric ? (
            <>
              <span className={`st-card-value${look.metric.value.length > 6 ? " long" : ""}`}>{look.metric.value}</span>
              <span className="st-card-label">{look.metric.label}</span>
            </>
          ) : (
            <>
              <span className="st-card-skel" aria-hidden />
              {look.status === "thinking" ? <span className="st-card-label">thinking</span> : <span className="st-card-skel short" aria-hidden />}
            </>
          )}
          {look.receiptSlot ? <span className="st-card-slot">Receipt after your signature</span> : <span className="st-card-bar" aria-hidden />}
        </div>
        <ol className="st-card-steps">
          {look.steps.map((step) => (
            <li key={step.label} className={step.state}>
              <i aria-hidden />
              {step.label}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="st-card-focus"
          disabled={!onFocus}
          onClick={onFocus}
          title={onFocus ? `Show ${look.name}'s last line in the conversation` : `${look.name} has no line in the conversation yet`}
        >
          Focus
        </button>
      </div>
      {onFocus ? (
        <button type="button" className="st-card-chip" onClick={onFocus} aria-label={`${look.summary}. Show ${look.name}'s last line.`}>
          <i aria-hidden />
          <span>{look.chip}</span>
        </button>
      ) : (
        <span className="st-card-chip">
          <i aria-hidden />
          <span>{look.chip}</span>
        </span>
      )}
    </div>
  );
}

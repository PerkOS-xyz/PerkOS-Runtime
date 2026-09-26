"use client";

import type { DeskTeam, TeamAgent } from "@perkos/client";
import type { CSSProperties, ReactNode } from "react";

import { cardLook } from "../turn/turnLook";
import { TurnCard, useTurnClock, type SeatTurn } from "../turn/TurnCards";
import { AgentPortrait } from "./AgentPortrait";
import { markFor } from "./agentPortraits";
import { roleConfig, sphereAccent, type AgentAvatarState } from "./avatarIdentity";
import { memberLook, seating, specialistSeat } from "./look";

function Member({
  agent,
  className,
  size,
  style,
  note,
  seat,
  state,
  status,
  children
}: {
  agent: TeamAgent;
  className: string;
  size: number;
  style?: CSSProperties;
  note?: string;
  seat?: number;
  /** The portrait's state during a desk turn, over the one the team status gives. */
  state?: AgentAvatarState | null | undefined;
  /** The status line during a desk turn: "Thinking" while it works. */
  status?: string | undefined;
  children?: ReactNode;
}) {
  const look = memberLook(agent.state);
  const avatar = state ?? look.avatar;
  const name = roleConfig(agent.role).label;
  const mark = markFor(agent.role);
  return (
    <div
      className={`st-member ${className} ${avatar}`}
      style={{ ...style, "--role": sphereAccent(agent.role, seat) } as CSSProperties}
      title={`${name}${note ? ` · ${note}` : ""}: ${look.label}`}
    >
      <AgentPortrait role={agent.role} state={avatar} size={size} label={name} seat={seat} />
      <b>
        {name}
        {mark ? <img className="st-mark" src={mark.src} alt={mark.label} title={`${mark.label} specialist`} draggable={false} /> : null}
      </b>
      <small>{status ?? look.label}</small>
      {children}
    </div>
  );
}

/**
 * The desk's team around Sparky, as PerkOS reports it: the table beside him,
 * the specialists below. While a desk turn runs, each seat at the table shows
 * its part on a card under its head and its portrait follows the turn; a
 * moment after the turn the cards fold into chips.
 */
export function TeamRow({ team, turn = null }: { team: DeskTeam | null; turn?: SeatTurn | null }) {
  const clock = useTurnClock(turn?.view ?? null);
  if (!team) return null;
  const { table, specialists } = seating(team.agents);
  const cards = turn && clock.mode !== "none" ? turn : null;
  const open = clock.mode === "open";
  return (
    <div className={`st-team${cards ? ` turn${open ? " open" : ""}` : ""}`} aria-label="The desk's team">
      {table.map((agent, i) => {
        const look = cards ? cardLook(cards.view, agent.role, { index: i + 1, now: clock.now }) : null;
        const focusable = look !== null && (cards?.lines.has(agent.role) === true || look.status === "thinking");
        return (
          <Member
            key={agent.name}
            agent={agent}
            className={`seat-${i + 1}`}
            size={72}
            state={open ? look?.avatar : null}
            status={open && look?.status === "thinking" ? "Thinking" : undefined}
          >
            {look ? <TurnCard look={look} onFocus={focusable ? () => cards?.onFocus(agent.role) : undefined} /> : null}
          </Member>
        );
      })}
      {specialists.map((agent, i) => {
        const seat = specialistSeat(i, specialists.length);
        return (
          <Member
            key={agent.name}
            agent={agent}
            className="st-spec"
            size={48}
            note="analysis only"
            seat={i}
            style={{ "--x": `${seat.x}px`, "--row": `${seat.row}px`, "--i": i } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

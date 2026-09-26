"use client";

import type { DeskTeam, TeamAgent } from "@perkos/client";
import type { CSSProperties } from "react";

import { AgentPortrait } from "./AgentPortrait";
import { markFor } from "./agentPortraits";
import { roleConfig } from "./avatarIdentity";
import { memberLook, seating, specialistSeat } from "./look";

function Member({ agent, className, size, style, note, seat }: { agent: TeamAgent; className: string; size: number; style?: CSSProperties; note?: string; seat?: number }) {
  const look = memberLook(agent.state);
  const name = roleConfig(agent.role).label;
  const mark = markFor(agent.role);
  return (
    <div className={`st-member ${className} ${look.avatar}`} style={style} title={`${name}${note ? ` · ${note}` : ""}: ${look.label}`}>
      <AgentPortrait role={agent.role} state={look.avatar} size={size} label={name} seat={seat} />
      <b>
        {name}
        {mark ? <img className="st-mark" src={mark.src} alt={mark.label} title={`${mark.label} specialist`} draggable={false} /> : null}
      </b>
      <small>{look.label}</small>
    </div>
  );
}

/** The desk's team around Sparky, as PerkOS reports it: the table beside him, the specialists below. */
export function TeamRow({ team }: { team: DeskTeam | null }) {
  if (!team) return null;
  const { table, specialists } = seating(team.agents);
  return (
    <div className="st-team" aria-label="The desk's team">
      {table.map((agent, i) => (
        <Member key={agent.name} agent={agent} className={`seat-${i + 1}`} size={72} />
      ))}
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

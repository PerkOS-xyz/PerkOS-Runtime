"use client";

import type { CSSProperties, ReactNode } from "react";

import type { Message } from "../chat/messages";
import { roleConfig, sphereAccent } from "../team/avatarIdentity";
import { agentLabel, factFor, lineParts, missedLine } from "./mentions";

const roleStyle = (role: string) => ({ "--role": sphereAccent(role) }) as CSSProperties;

/** A team line as written, with @mentions as chips in each role's color and [Fn] tags pointing at the turn's facts. */
export function Rich({ text, facts }: { text: string; facts?: readonly string[] | undefined }) {
  return (
    <>
      {lineParts(text).map((part, i) => {
        if ("text" in part) return <span key={i}>{part.text}</span>;
        if ("mention" in part) {
          return part.role === "sparky" ? (
            <span key={i} className="st-at sparky">
              {part.mention}
            </span>
          ) : (
            <span key={i} className="st-at" style={roleStyle(part.role)}>
              {part.mention}
            </span>
          );
        }
        const fact = factFor(facts, part.fact);
        return (
          <abbr key={i} className="st-fact" title={fact ?? `Fact ${part.fact} of this turn`}>
            F{part.fact}
          </abbr>
        );
      })}
    </>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <span className="st-typing" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}

const SPARKY_WHO = { "to-you": "Sparky · to you", warm: "Sparky", summary: "Sparky" } as const;

/**
 * One line of a desk conversation: the person, Sparky, Sparky's line to his
 * team, an agent's answer in its role's color, or a short note. `children`
 * sits under Sparky's line, for the turn's folded checklist.
 */
export function ChatLine({ message: m, typing, facts, children }: { message: Message; typing?: boolean; facts?: readonly string[] | undefined; children?: ReactNode }) {
  if (m.role === "user") {
    return (
      <div className="st-turn user">
        <span className="st-who">You</span>
        <p>{m.content}</p>
      </div>
    );
  }
  if (m.role === "assistant") {
    return (
      <div className={`st-turn assistant${m.tone ? ` ${m.tone}` : ""}`}>
        <span className="st-who">{m.tone ? SPARKY_WHO[m.tone] : "Sparky"}</span>
        {m.content || typing ? <p>{m.content || <Typing label="Sparky is writing" />}</p> : null}
        {children}
      </div>
    );
  }
  if (m.kind === "note") return <p className="st-sysnote">{m.content}</p>;
  if (m.kind === "principal") {
    return (
      <div className="st-turn team principal" data-who="sparky">
        <span className="st-who">Sparky · principal</span>
        <p>
          <Rich text={m.content} />
        </p>
      </div>
    );
  }
  const name = roleConfig(m.who).label;
  if (m.failure) {
    return (
      <div className="st-turn team missed" data-who={m.who} style={roleStyle(m.who)} title={m.failure.detail}>
        <p>
          <i className="st-dot" aria-hidden />
          {missedLine(name, m.failure.label)}
          {m.failure.detail ? <small>{m.failure.detail}</small> : null}
        </p>
      </div>
    );
  }
  return (
    <div className={`st-turn team${m.kind === "guest" ? " guest" : ""}`} data-who={m.who} style={roleStyle(m.who)}>
      <span className="st-who" title={m.agentName}>
        <i className="st-dot" aria-hidden />
        {agentLabel(name)}
      </span>
      <p>
        <Rich text={m.content} facts={facts} />
      </p>
    </div>
  );
}

/** An agent at work on its part of the turn: its label and the typing dots, in its color. */
export function TypingLine({ role }: { role: string }) {
  const name = roleConfig(role).label;
  return (
    <div className="st-turn team typing" data-who={role} style={roleStyle(role)}>
      <span className="st-who">
        <i className="st-dot" aria-hidden />
        {agentLabel(name)}
      </span>
      <p>
        <Typing label={`${name} is writing`} />
      </p>
    </div>
  );
}

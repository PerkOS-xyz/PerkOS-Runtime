"use client";

import { Fragment, type CSSProperties } from "react";

import { KIND_NAMES, type Decision, type DecisionRow } from "../lib/decisions";
import { roleConfig } from "../team/avatarIdentity";

/** A desk turn in Memory's list. */
export interface DecisionItem {
  id: string;
  updatedAt: string;
  preview: string;
  decision?: DecisionRow;
}

/** How many decisions show before "Show all". */
export const DECISIONS_SHOWN = 6;

const pad = (n: number) => String(n).padStart(2, "0");

/** When a turn started, in local time. */
function when(at: string) {
  const d = new Date(at);
  return {
    date: String(d.getDate()),
    month: d.toLocaleDateString("en-US", { month: "short" }),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    long: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
  };
}

const roleStyle = (role: string, i?: number) => ({ "--role": roleConfig(role).accent, ...(i === undefined ? {} : { "--i": i }) }) as CSSProperties;

/** The kind, the risk, the verdict and how the team did, as small tags. */
function Tags({ d, time }: { d: DecisionRow; time?: string }) {
  const total = d.answered + d.missing;
  return (
    <span className="mem-dec-tags">
      <span className="mem-tag">{KIND_NAMES[d.kind]}</span>
      {d.riskLevel ? <span className={`mem-tag risk ${d.riskLevel}`}>Risk {d.riskLevel}</span> : null}
      {d.verdict ? <span className={`mem-tag verdict ${d.verdict.toLowerCase()}`}>{d.verdict}</span> : null}
      {total && !d.answered ? <span className="mem-tag warn">No answers</span> : d.missing ? <span className="mem-tag warn">{d.missing} no answer</span> : null}
      {d.stopped ? <span className="mem-tag quiet">Stopped</span> : null}
      {time ? <span className="mem-tag quiet">{time}</span> : null}
    </span>
  );
}

/** One diamond per agent, lit in its role's color when it answered. */
function Voices({ voices }: { voices: DecisionRow["voices"] }) {
  const said = voices.map((v) => `${roleConfig(v.role).label} ${v.ok ? "answered" : "gave no answer"}`).join(", ");
  return (
    <span className="mem-voices" role="img" aria-label={said} title={said}>
      {voices.map((v, i) => (
        <i key={i} className={v.ok ? "on" : "off"} style={roleStyle(v.role)} />
      ))}
    </span>
  );
}

/** A desk's turns, newest first: when, the question, its kind and risk, and what came of it. */
export function DecisionList({ rows, all, onAll, onOpen }: { rows: DecisionItem[]; all: boolean; onAll: () => void; onOpen: (id: string) => void }) {
  const shown = all ? rows : rows.slice(0, DECISIONS_SHOWN);
  return (
    <section className="mem-group" aria-label="Decisions">
      <h4 className="mem-group-head">
        <span>Decisions</span>
        <i>{rows.length}</i>
      </h4>
      <ul className="mem-rows">
        {shown.map((r, i) => {
          const d = r.decision;
          const at = when(d?.startedAt ?? r.updatedAt);
          return (
            <li key={r.id} style={{ "--i": i } as CSSProperties}>
              <button type="button" className="mem-row mem-dec" onClick={() => onOpen(r.id)}>
                <span className="mem-stamp">
                  <b>{at.date}</b>
                  <small>{at.month}</small>
                  <small className="mem-dec-time">{at.time}</small>
                </span>
                <span className="mem-text">
                  {d ? <Tags d={d} /> : <span className="mem-title">Decision</span>}
                  <span className="mem-dec-q">{d?.question ?? r.preview}</span>
                  {d ? <span className="mem-dec-out">{d.outcome}</span> : null}
                </span>
                {d?.voices.length ? <Voices voices={d.voices} /> : null}
                <span className="mem-go" aria-hidden>
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length ? (
        <button type="button" className="link-btn mem-more" onClick={onAll}>
          Show all {rows.length} decisions
        </button>
      ) : null}
    </section>
  );
}

/** "Decision · Sat, Sep 26 · 14:32", above the question. */
export function DecisionKicker({ d }: { d: Decision }) {
  const at = when(d.startedAt);
  return (
    <p className="mem-dec-kicker">
      Decision · {at.long} · {at.time}
    </p>
  );
}

/** The Trader's plan or the Auditor's record, whole, or why the turn has none. */
function Paper({ label, role, text, missing, i }: { label: string; role: string; text?: string; missing?: string; i: number }) {
  const who = roleConfig(role).label;
  return (
    <section className={`mem-dec-paper${text ? "" : " missed"}`} style={roleStyle(role, i)}>
      <span className="mem-dec-label">
        {label}
        <small>{who}</small>
      </span>
      <p>{text ?? `No ${label.toLowerCase()}: the ${who} did not answer, ${missing ?? "failed"}.`}</p>
    </section>
  );
}

/**
 * A turn read whole: each agent's line or why it gave none, as a relay from
 * the ones who read the facts to the ones who plan and record, then the plan,
 * the record and Sparky's summary.
 */
export function DecisionView({ d }: { d: Decision }) {
  let block = 0;
  const firstLater = d.agents.findIndex((a) => a.phase === 2);
  return (
    <div className="mem-decision">
      <div style={{ "--i": block++ } as CSSProperties}>
        <Tags d={d} time={d.time} />
      </div>
      {d.ended ? (
        <p className="mem-dec-ended" style={{ "--i": block++ } as CSSProperties}>
          Ended early: {d.ended}
        </p>
      ) : null}
      {d.agents.length ? (
        <section style={{ "--i": block++ } as CSSProperties}>
          <span className="mem-dec-label">The desk</span>
          <ol className="mem-dec-team">
            {d.agents.map((a, i) => (
              <Fragment key={i}>
                {i === firstLater && i > 0 ? (
                  <li className="mem-dec-hand" aria-hidden>
                    Handed on
                  </li>
                ) : null}
                <li className={a.ok ? undefined : "missed"} style={roleStyle(a.role)}>
                  <span className="mem-dec-who">
                    <b>{roleConfig(a.role).label}</b>
                    {a.time ? <small>{a.time}</small> : null}
                  </span>
                  {a.ok ? (
                    <p>{a.line}</p>
                  ) : (
                    <p>
                      No answer · {a.line}
                      {a.detail ? <small>{a.detail}</small> : null}
                    </p>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </section>
      ) : null}
      {d.plan || d.planMissing ? <Paper label="Plan" role="trader" text={d.plan} missing={d.planMissing} i={block++} /> : null}
      {d.record || d.recordMissing ? <Paper label="Record" role="auditor" text={d.record} missing={d.recordMissing} i={block++} /> : null}
      {d.signed ? (
        <p className="mem-dec-signed" style={{ "--i": block++ } as CSSProperties}>
          Signed {d.signed}
        </p>
      ) : null}
      {d.summary ? (
        <p className="mem-dec-sparky" style={{ "--i": block++ } as CSSProperties}>
          <span>Sparky</span>
          {d.summary}
        </p>
      ) : null}
      {d.checks.length ? (
        <div className="mem-dec-checks" style={{ "--i": block++ } as CSSProperties}>
          <span className="mem-dec-label">Checks</span>
          {d.checks.map((c, j) => (
            <code key={j}>{c}</code>
          ))}
        </div>
      ) : null}
    </div>
  );
}

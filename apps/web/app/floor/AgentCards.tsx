"use client";

import { useEffect, useState } from "react";

// Agent graph del turno de mesa: una card bajo cada esfera con la pantalla
// de esa etapa (metrica hero, barra, 3 micro-pasos) que avanza con los
// eventos SSE reales (start = pensando, reply = entregado). Nunca finge
// progreso: el ultimo paso solo cierra con la respuesta del agente. Al
// terminar el turno las cards se contraen a chips; la misma estructura se
// guarda como Decision y se rejuega en History.

export type Role = "scout" | "risk" | "trader" | "auditor";
export const ROLES: Role[] = ["scout", "risk", "trader", "auditor"];
export type StepState = "idle" | "active" | "done";
export type AgentState = "queued" | "thinking" | "delivered" | "blocked" | "skipped";
export type AgentRun = {
  role: Role;
  state: AgentState;
  startedAt?: number;
  ms?: number;
  metric?: string;
  metricLabel?: string;
  steps: [StepState, StepState, StepState];
  text?: string;
  verdict?: "GO" | "BLOCK";
};
export type TurnQuote = { side: string; symbol: string; name: string; amountIn: string; tokenIn: string; quoteOut: string; tokenOut: string; priceUsd: number; bankr?: { priceUsd: number } | null; venue?: string } | null;
export type TurnFacts = { premiumPct?: number; change24hPct?: number; swaps24h?: number; chainlinkUsd?: number } | null;
export type DeskTurn = {
  id: number;
  text: string;
  startedAt: number;
  endedAt?: number;
  live: boolean;
  collapsed: boolean;
  verdict?: "GO" | "BLOCK";
  quote: TurnQuote;
  facts: TurnFacts;
  agents: Record<Role, AgentRun>;
  receipt?: { hash?: string; explorer?: string; status?: string };
};

const STEPS: Record<Role, [string, string, string]> = {
  scout: ["facts read", "thinking", "handed to Trader"],
  risk: ["facts read", "thinking", "verdict"],
  trader: ["waiting for Scout + Risk", "drafting", "on the table"],
  auditor: ["waiting for the desk", "writing the record", "receipt"]
};
const BADGE: Record<Role, string> = { scout: "01", risk: "02", trader: "03", auditor: "04" };
export const cap = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

export function newTurn(id: number, text: string, roles: string[], quote: TurnQuote, facts: TurnFacts): DeskTurn {
  const agents = Object.fromEntries(
    ROLES.map((r) => [r, { role: r, state: roles.includes(r) ? "queued" : "skipped", steps: r === "trader" || r === "auditor" ? ["active", "idle", "idle"] : ["idle", "idle", "idle"] } as AgentRun])
  ) as Record<Role, AgentRun>;
  return { id, text, startedAt: Date.now(), live: true, collapsed: false, quote, facts, agents };
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

function metricFor(role: Role, t: DeskTurn, reply: string, verdict?: "GO" | "BLOCK"): { metric: string; metricLabel: string } {
  const q = t.quote;
  if (role === "scout") {
    if (t.facts?.premiumPct !== undefined) return { metric: pct(t.facts.premiumPct), metricLabel: "pool vs Chainlink" };
    if (t.facts?.change24hPct !== undefined) return { metric: pct(t.facts.change24hPct), metricLabel: "24h move" };
    if (t.facts?.swaps24h !== undefined) return { metric: String(t.facts.swaps24h), metricLabel: "swaps in 24h" };
    if (q) return { metric: `$${q.priceUsd.toFixed(2)}`, metricLabel: "Uniswap / share" };
    return { metric: "read", metricLabel: "market read" };
  }
  if (role === "risk") {
    if (q?.bankr?.priceUsd) return { metric: pct(((q.priceUsd / q.bankr.priceUsd) - 1) * 100), metricLabel: "Uniswap vs Bankr" };
    if (q && t.facts?.chainlinkUsd) return { metric: pct(((q.priceUsd / t.facts.chainlinkUsd) - 1) * 100), metricLabel: "Uniswap vs Chainlink" };
    return { metric: verdict ?? "band", metricLabel: "1.5% band" };
  }
  if (role === "trader") {
    if (verdict === "BLOCK" || t.verdict === "BLOCK") return { metric: "stand down", metricLabel: "Risk blocked" };
    if (q) return { metric: `${q.quoteOut} ${q.tokenOut}`, metricLabel: `for ${q.amountIn} ${q.tokenIn}${q.venue ? ` · ${q.venue}` : ""}` };
    return { metric: "no order", metricLabel: "nothing drafted" };
  }
  const m = reply.match(/(?:record|receipt)[^0-9a-f]{0,12}([0-9a-f]{8})/i);
  return { metric: m ? m[1] : "recorded", metricLabel: "decision record" };
}

export type TurnEvent = { step?: string; role?: string; ok?: boolean; reply?: string; ms?: number; verdict?: "GO" | "BLOCK" };

/** Reductor puro: un evento SSE del turno -> nuevo estado de las cards. */
export function applyTurnEvent(t: DeskTurn, ev: TurnEvent): DeskTurn {
  const role = ev.role as Role | undefined;
  if (ev.step === "start" && role && t.agents[role]) {
    const a = t.agents[role];
    return { ...t, agents: { ...t.agents, [role]: { ...a, state: "thinking", startedAt: Date.now(), steps: ["done", "active", "idle"] } } };
  }
  if (ev.step === "reply" && role && t.agents[role]) {
    const a = t.agents[role];
    if (!ev.ok || !ev.reply) return { ...t, agents: { ...t.agents, [role]: { ...a, state: "skipped", ms: ev.ms, metric: "no answer", metricLabel: "timed out", steps: ["done", "done", "idle"] } } };
    const verdict = ev.verdict ?? t.verdict;
    const m = metricFor(role, { ...t, verdict }, ev.reply, ev.verdict);
    const next: AgentRun = { ...a, state: role === "trader" && verdict === "BLOCK" ? "blocked" : "delivered", ms: ev.ms, text: ev.reply, verdict: ev.verdict, steps: ["done", "done", "done"], ...m };
    return { ...t, verdict: ev.verdict ?? t.verdict, agents: { ...t.agents, [role]: next } };
  }
  if (ev.step === "done") {
    const agents = { ...t.agents };
    for (const r of ROLES) if (agents[r].state === "queued" || agents[r].state === "thinking") agents[r] = { ...agents[r], state: "skipped", metric: agents[r].metric ?? "no answer", metricLabel: agents[r].metricLabel ?? "did not run", steps: ["done", "idle", "idle"] };
    return { ...t, live: false, endedAt: Date.now(), verdict: ev.verdict ?? t.verdict, agents };
  }
  return t;
}

function Screen({ a, turn, elapsed }: { a: AgentRun; turn: DeskTurn; elapsed: number }) {
  if (a.state === "queued") {
    return (
      <div className="ag-screen">
        <div className="ag-shimmer" style={{ width: "70%" }} />
        <div className="ag-shimmer" style={{ width: "42%", height: 8 }} />
      </div>
    );
  }
  if (a.role === "auditor" && a.state === "delivered" && !turn.receipt?.hash) {
    return (
      <div className="ag-screen">
        <div className="ag-metric">{a.metric}<small>{a.metricLabel}</small></div>
        <div className="ag-slot">Receipt after your signature</div>
      </div>
    );
  }
  return (
    <div className="ag-screen">
      {a.state === "thinking" ? (
        <div className="ag-metric dim">{Math.max(0, elapsed).toFixed(0)} s<small>thinking</small></div>
      ) : (
        <div className="ag-metric">{a.metric ?? "…"}<small>{a.metricLabel ?? ""}</small></div>
      )}
      <div className={`ag-bar${a.state === "thinking" ? " indet" : ""}`}><span style={a.state === "thinking" ? undefined : { width: a.state === "skipped" ? "35%" : "100%" }} /></div>
    </div>
  );
}

export default function AgentCards({ turn, mode, onFocus, onApprove, canApprove, onExpand }: {
  turn: DeskTurn;
  mode: "live" | "chips" | "replay";
  onFocus?: (role: Role) => void;
  onApprove?: () => void;
  canApprove?: boolean;
  onExpand?: () => void;
}) {
  const [, tick] = useState(0);
  const thinking = ROLES.some((r) => turn.agents[r].state === "thinking");
  useEffect(() => {
    if (!thinking) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [thinking]);

  if (mode === "chips") {
    return (
      <div className="ag-chips" role="list">
        {ROLES.map((r) => {
          const a = turn.agents[r];
          const tone = a.verdict === "BLOCK" || a.state === "blocked" ? "red" : a.state === "skipped" ? "dim" : a.verdict === "GO" ? "green" : "blue";
          return (
            <button type="button" key={r} className={`ag-chip ${tone}`} onClick={onExpand} title={`${cap(r)}: ${a.metricLabel ?? ""}`} role="listitem">
              <i /> {a.verdict ? `${a.verdict} · ` : ""}{a.metric ?? "—"}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`ag-cards${mode === "replay" ? " replay" : ""}`}>
      {ROLES.map((r) => {
        const a = turn.agents[r];
        const elapsed = a.startedAt ? (Date.now() - a.startedAt) / 1000 : 0;
        const tone = a.state === "thinking" ? "active" : a.state === "blocked" || a.verdict === "BLOCK" ? "block" : a.verdict === "GO" ? "go" : a.state === "delivered" ? "done" : "";
        return (
          <div key={r} className={`ag-card ${r} ${tone}`}>
            <div className="ag-lbl">
              <span>{BADGE[r]} · {r.toUpperCase()}</span>
              <span>{a.state === "thinking" ? `${Math.max(0, elapsed).toFixed(0)} s` : a.ms ? `${(a.ms / 1000).toFixed(1)} s` : a.state === "queued" ? "waiting" : ""}</span>
            </div>
            <Screen a={a} turn={turn} elapsed={elapsed} />
            <ul className="ag-steps">
              {STEPS[r].map((label, i) => (
                <li key={label} className={a.steps[i]}><i />{label}</li>
              ))}
            </ul>
            {mode === "live" ? (
              <div className="ag-pills">
                <button type="button" onClick={() => onFocus?.(r)}>Focus</button>
                {r === "trader" && canApprove ? <button type="button" className="cta" onClick={onApprove}>Approve</button> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

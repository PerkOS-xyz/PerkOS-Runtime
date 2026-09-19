"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Trader access: la persona delega al Trader una wallet suya de Dynamic. Floor
// nunca ve la parte delegada; solo pide el enlace (se abre en el navegador del
// sistema), muestra el estado y los limites, y revoca. Cada limite dice quien lo
// hace cumplir: el enclave de Dynamic, la politica de PerkOS, o el Hold.

type Access = {
  enabled: boolean;
  agentId: string | null;
  linked: boolean;
  delegated: boolean;
  walletAddress: string | null;
  limits: { maxUsdc: number; ruleId: string | null; verified: boolean; setAt: string } | null;
  chains: Array<{ chain: string; balances: Array<{ symbol: string; formatted: string }> }>;
  allowlist: Array<{ address: string; label: string }>;
  payWith: "me" | "trader";
  error?: string;
};

const EMPTY: Access = { enabled: false, agentId: null, linked: false, delegated: false, walletAddress: null, limits: null, chains: [], allowlist: [], payWith: "me" };
const WAIT_MS = 3 * 60_000;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function funds(a: Access): { usdc: number; eth: number } {
  const b = a.chains.find((c) => c.chain === "base");
  const of = (sym: string) => Number(b?.balances.find((x) => x.symbol === sym)?.formatted ?? 0);
  return { usdc: of("USDC"), eth: of("ETH") };
}

/** "USDC · Uniswap V3 · Aerodrome · NVIDIA and its 5 pools": the list the enclave allows, readable. */
function canTouch(a: Access): string {
  const labels = a.allowlist.map((x) => x.label);
  const pools = labels.filter((l) => /pool/i.test(l)).length;
  const named = labels.filter((l) => !/pool|implementation/i.test(l));
  return `${named.join(" · ")}${pools ? ` and ${pools} pools` : ""}`;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function TraderAccessCard({ connected }: { connected: boolean }) {
  const [a, setA] = useState<Access | null>(null);
  const [busy, setBusy] = useState<"" | "grant" | "edit" | "revoke">("");
  const [waiting, setWaiting] = useState<"" | "grant" | "edit">("");
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const setAtBefore = useRef<string | null>(null);

  const load = useCallback(async (): Promise<Access | null> => {
    try {
      const r = await fetch("/api/fleet/trader-access");
      const j = (await r.json().catch(() => ({}))) as Access & { error?: string };
      const next = r.ok ? { ...EMPTY, ...j } : { ...EMPTY, error: j.error ?? `HTTP ${r.status}` };
      setA(next);
      return next;
    } catch {
      setA({ ...EMPTY, error: "PerkOS is not reachable" });
      return null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Mientras la persona aprueba en el navegador, el desk pregunta cada 4 s. Con
  // tope: un enlace abandonado no deja un sondeo eterno (leccion del claim de 1Claw).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = window.setInterval(async () => {
      const next = await load();
      const done = waiting === "grant" ? next?.delegated : next?.limits?.setAt && next.limits.setAt !== setAtBefore.current;
      if (done) {
        setWaiting("");
        setNote("");
      } else if (Date.now() - started > WAIT_MS) {
        setWaiting("");
        setNote("Nothing came back from the browser yet. Finish there, then press Check.");
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  const openPage = async (mode: "grant" | "edit") => {
    setBusy(mode);
    setNote("");
    setAtBefore.current = a?.limits?.setAt ?? null;
    try {
      const r = await fetch("/api/fleet/trader-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) { setNote(j.error ?? "Could not open the delegation page."); return; }
      // El shell manda cualquier dominio que no sea de login de wallet al navegador del sistema.
      window.open(j.url, "_blank", "noopener");
      setWaiting(mode);
    } finally {
      setBusy("");
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    setNote("");
    try {
      const r = await fetch("/api/fleet/trader-access", { method: "DELETE" });
      if (!r.ok) setNote("Could not revoke from here. You can also revoke on the delegation page.");
      await load();
    } finally {
      setBusy("");
    }
  };

  const pickPayer = (payWith: "me" | "trader") => {
    setA((x) => (x ? { ...x, payWith } : x));
    void fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payWith }) });
  };

  const copy = async () => {
    if (!a?.walletAddress) return;
    try { await navigator.clipboard.writeText(a.walletAddress); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* the address is on screen */ }
  };

  const f = a ? funds(a) : { usdc: 0, eth: 0 };
  const state =
    a === null ? "loading"
    : !connected ? "no-session"
    : !a.enabled ? "off"
    : !a.agentId ? "no-desk"
    : waiting === "grant" ? "waiting"
    : a.delegated ? "active"
    : a.linked ? "revoked-or-pending"
    : "none";

  return (
    <div className="ta-card" aria-live="polite">
      <div className="ta-head">
        <b>Trader access</b>
        <em className={`ta-state st-${state}`}>{state === "active" ? "Delegated" : state === "waiting" ? "Waiting" : "Dynamic"}</em>
      </div>

      {state === "loading" ? <p className="hint-line">Reading access…</p> : null}
      {state === "no-session" ? <p className="hint-line">Connect your PerkOS account first.</p> : null}
      {state === "off" ? <p className="hint-line">Delegated access is not switched on for this PerkOS account yet.{a?.error ? ` (${a.error})` : ""}</p> : null}
      {state === "no-desk" ? <p className="hint-line">Start the desk first: access is delegated to its Trader.</p> : null}

      {state === "none" || state === "revoked-or-pending" ? (
        <>
          <p className="ta-lead">{state === "none" ? "Let the Trader buy from a Dynamic wallet you own. You hold Approve on every order and can revoke anytime." : "The Trader has no access right now. Delegate again to let it buy for you."}</p>
          <button type="button" className="gb-go" onClick={() => void openPage("grant")} disabled={busy !== ""}>{busy === "grant" ? "Opening…" : state === "none" ? "Delegate to Trader" : "Delegate again"}</button>
        </>
      ) : null}

      {state === "waiting" ? (
        <div className="ta-wait">
          <p className="ta-lead">Waiting for your approval in the browser…</p>
          <div className="ta-actions">
            <button type="button" onClick={() => void openPage("grant")} disabled={busy !== ""}>Open again</button>
            <button type="button" onClick={() => setWaiting("")}>Cancel</button>
          </div>
        </div>
      ) : null}

      {state === "active" && a?.walletAddress ? (
        <>
          <div className="ta-wallet">
            <span className="ta-addr">{short(a.walletAddress)}</span>
            <span className="ta-funds">{f.usdc.toFixed(2)} USDC · {f.eth.toFixed(4)} ETH on Base</span>
            <span className="ta-actions">
              <button type="button" onClick={() => void copy()} title="Send USDC on Base, plus a little ETH for gas">{copied ? "Copied" : "Copy address"}</button>
              <a className="pill" href={`https://basescan.org/address/${a.walletAddress}`} target="_blank" rel="noreferrer">Basescan ↗</a>
            </span>
          </div>
          {f.usdc === 0 ? <p className="hint-line">Fund it to trade: send USDC on Base to this address, plus a little ETH for gas.</p> : null}

          <dl className="ta-limits">
            <dt>Chain</dt><dd>Base<i className="by dyn">Dynamic</i></dd>
            <dt>Per order</dt>
            <dd>
              {a.limits ? `up to ${a.limits.maxUsdc} USDC` : "up to 25 USDC"}
              <i className={`by ${a.limits ? "dyn" : "perkos"}`}>{a.limits ? "Dynamic" : "PerkOS"}</i>
            </dd>
            <dt>Can touch</dt><dd>{canTouch(a)}<i className="by dyn">Dynamic</i></dd>
            <dt>Proceeds</dt><dd>always back to this wallet<i className="by perkos">PerkOS</i></dd>
            <dt>Key export</dt><dd>blocked<i className="by dyn">Dynamic</i></dd>
            <dt>Every order</dt><dd>your Hold<i className="by you">You</i></dd>
          </dl>
          <p className="hint-line ta-proof">
            {a.limits
              ? a.limits.verified
                ? `Read back from Dynamic · ${when(a.limits.setAt)}. Enforced in Dynamic's enclave before any signature.`
                : `As set on ${when(a.limits.setAt)}.`
              : "No limit rule in Dynamic yet: PerkOS still caps each order at 25 USDC. Set yours with Edit limits."}
          </p>

          <div className="srow tw-pay" role="radiogroup" aria-label="Who pays for an approved buy">
            <span>Pays for buys</span>
            <span className="v">
              <button type="button" role="radio" aria-checked={a.payWith === "me"} className={a.payWith === "me" ? "on" : ""} onClick={() => pickPayer("me")}>My wallet</button>
              <button type="button" role="radio" aria-checked={a.payWith === "trader"} className={a.payWith === "trader" ? "on" : ""} onClick={() => pickPayer("trader")}>Delegated wallet</button>
            </span>
          </div>

          <div className="ta-actions ta-foot">
            <button type="button" onClick={() => void openPage("edit")} disabled={busy !== "" || waiting === "edit"}>{waiting === "edit" ? "Waiting for the browser…" : "Edit limits ↗"}</button>
            <button type="button" className="ta-revoke" onClick={() => void revoke()} disabled={busy !== ""}>{busy === "revoke" ? "Revoking…" : "Revoke"}</button>
          </div>
        </>
      ) : null}

      {note ? <p className="hint-line err">{note} <button type="button" className="ta-link" onClick={() => void load()}>Check</button></p> : null}
      <p className="hint-line">Owned by you on Dynamic. The Trader signs with a delegated share you approved; it cannot export your key or change your limits.</p>
    </div>
  );
}

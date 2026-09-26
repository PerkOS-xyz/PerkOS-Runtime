"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { resolvePair, type LaunchPair } from "../lib/bankrLaunch";
import type { LaunchCheck } from "../lib/launchChecks";
import type { DraftAnswer } from "../lib/launchDraft";
import { useWallet } from "../wallet/context";
import { launchAddressUrl, launchTxUrl } from "./launch";
import { cleanSymbol, formKey, formReady, launchBody, pairChips, seedForm, sendLaunch, suggestSymbol, type LaunchForm, type LaunchSeed } from "./launchForm";
import { dismissLaunch, launchRun, startLaunch, subscribeLaunches, type LaunchRun } from "./launchStore";
import { HoldToApprove } from "./WalletTraderSheet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const KEY_POLL_MS = 4_000;

/** The launch the desk is sending, or its last outcome. Survives the card closing. */
function useLaunchRun(module: string): LaunchRun | null {
  const read = useCallback(() => launchRun(module), [module]);
  return useSyncExternalStore(subscribeLaunches, read, () => null);
}

/** A picked file as a 512 px square PNG, the shape a token logo is shown in. */
async function squareDataUrl(file: File, size = 512): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This window cannot read images.");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL("image/png");
}

type Tone = "draft" | "busy" | "ready" | "fix" | "live" | "failed";

/**
 * A token launch in the desk conversation: a new token paired with a
 * tokenized stock (or WETH) on Robinhood Chain, deployed with its Uniswap v4
 * pool by Bankr from the person's Bankr wallet. The card checks it against
 * Bankr's rules and has Bankr simulate it; only then does Hold to launch
 * wake up. The person signs nothing on chain: Bankr deploys, and the Bankr
 * wallet pays the gas.
 */
export function LaunchCard({ module, seed, onSettings, onClose }: { module: string; seed: LaunchSeed; onSettings: () => void; onClose: () => void }) {
  const wallet = useWallet();
  const run = useLaunchRun(module);
  const [form, setForm] = useState<LaunchForm>(() => seedForm(seed));
  const symbolTouched = useRef(Boolean(seed.symbol));
  const [pairs, setPairs] = useState<LaunchPair[] | null>(null);
  const [pairsError, setPairsError] = useState("");
  const [query, setQuery] = useState("");
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ key: string; answer: DraftAnswer } | null>(null);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPairs = useCallback(async () => {
    setPairsError("");
    try {
      const res = await fetch("/api/launch/quotes");
      const body = (await res.json().catch(() => ({}))) as { pairs?: LaunchPair[]; message?: string };
      if (!res.ok || !body.pairs) throw new Error(body.message ?? "Bankr's pairs did not load.");
      setPairs(body.pairs);
    } catch (err) {
      setPairsError((err as Error).message === "Failed to fetch" ? "Bankr's pairs did not load." : (err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  // Whether a Bankr key is saved, read again while it is missing, so the card wakes up once Settings has one.
  useEffect(() => {
    if (keySaved) return;
    let live = true;
    const read = () =>
      fetch("/api/bankr")
        .then((res) => (res.ok ? (res.json() as Promise<{ saved: boolean }>) : null))
        .then((body) => {
          if (live && body) setKeySaved(body.saved);
        })
        .catch(() => undefined);
    void read();
    const timer = window.setInterval(read, KEY_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [keySaved]);

  // The pair named in the chat becomes its chip once Bankr's list is here; a word that names none goes to the search.
  const seeded = useRef(false);
  useEffect(() => {
    if (!pairs || seeded.current) return;
    seeded.current = true;
    if (!form.pair) return;
    const hit = resolvePair(form.pair, pairs);
    if (hit) setForm((f) => ({ ...f, pair: hit.symbol }));
    else {
      setQuery(form.pair);
      setForm((f) => ({ ...f, pair: "" }));
    }
  }, [pairs, form.pair]);

  const pair = pairs ? resolvePair(form.pair, pairs) : null;
  const chips = useMemo(() => (pairs ? pairChips(pairs, query, form.pair) : []), [pairs, query, form.pair]);
  const stale = checked !== null && checked.key !== formKey(form);
  const answer = checked && !stale ? checked.answer : null;
  const inFlight = run !== null && run.outcome === null;

  const edit = (patch: Partial<LaunchForm>) => {
    setError("");
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.name !== undefined && !symbolTouched.current) next.symbol = suggestSymbol(patch.name);
      return next;
    });
  };

  async function check() {
    if (!formReady(form) || checking) return;
    setChecking(true);
    setError("");
    const key = formKey(form);
    try {
      const res = await fetch("/api/launch/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(launchBody(form)) });
      const body = (await res.json().catch(() => ({}))) as Partial<DraftAnswer> & { error?: string; message?: string };
      if (res.status === 412 && body.error === "bankr_key") setKeySaved(false);
      if (!res.ok || !body.checks || !body.draft) throw new Error(body.message ?? `The check did not finish (${res.status}).`);
      setChecked({ key, answer: body as DraftAnswer });
    } catch (err) {
      setChecked(null);
      setError((err as Error).message === "Failed to fetch" ? "Could not reach this app's server. Try again." : (err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  function launch() {
    if (!answer?.ready || stale || inFlight) return;
    const body = launchBody(form, answer.draft.pair.address);
    const started = startLaunch(module, { name: body.name, symbol: body.symbol, pairedSymbol: answer.draft.pair.symbol, deployer: answer.deployer }, () => sendLaunch(body));
    // A second launch needs a new check: the server has already forgotten this one's simulation.
    if (started) setChecked(null);
  }

  async function pickLogo(file: File) {
    setLogo({ busy: true, error: "" });
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Pick a PNG, JPG, WebP or GIF.");
      const data = await squareDataUrl(file);
      const res = await fetch("/api/launch/logo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !body.url) throw new Error(body.message ?? "The logo did not upload.");
      edit({ image: body.url });
      setLogo({ busy: false, error: "" });
    } catch (err) {
      setLogo({ busy: false, error: (err as Error).message });
    }
  }

  const tone: Tone = run
    ? run.outcome === null
      ? "busy"
      : run.outcome.kind === "live"
        ? "live"
        : "failed"
    : checking
      ? "busy"
      : answer
        ? answer.ready
          ? "ready"
          : "fix"
        : "draft";
  const state = run
    ? run.outcome === null
      ? "Launching"
      : run.outcome.kind === "live"
        ? "Live"
        : run.outcome.kind === "refused"
          ? "Not launched"
          : "Unconfirmed"
    : checking
      ? "Checking"
      : answer
        ? answer.ready
          ? "Ready"
          : "Fix first"
        : "Draft";
  const symbol = run?.summary.symbol ?? (cleanSymbol(form.symbol) || "TOKEN");
  const pairSymbol = run?.summary.pairedSymbol ?? pair?.symbol ?? "";
  const name = run?.summary.name ?? form.name.trim();

  return (
    <section className={`lc ${tone}`} aria-label="Token launch">
      <header className="lc-head">
        <span className="kicker">Token launch</span>
        <span className="chain-badge robinhood">Robinhood Chain</span>
        <span className={`lc-state ${tone}`}>{state}</span>
        <button type="button" className="bubble-close" aria-label="Close the launch card" onClick={onClose}>
          &times;
        </button>
      </header>

      <div className="lc-title">
        <span className="lc-coins" aria-hidden>
          <i className="lc-coin token">{form.image && !run ? <img src={form.image} alt="" /> : symbol.slice(0, 1)}</i>
          <i className="lc-coin pair">{pairSymbol ? pairSymbol.slice(0, 5) : "?"}</i>
        </span>
        <div>
          <b>${symbol}</b>
          <small>
            {name || "A new token"}
            {pairSymbol ? ` · paired with ${pairSymbol}` : " · pick what it pairs with"} · Uniswap v4 pool by Bankr
          </small>
        </div>
      </div>

      <i className="lc-perf" aria-hidden />

      {run ? (
        <LaunchOutcomeView run={run} />
      ) : (
        <>
          <div className="lc-form">
            <label className="lc-field">
              <span>Name</span>
              <input value={form.name} maxLength={100} placeholder="Night Owl" disabled={checking} onChange={(e) => edit({ name: e.target.value })} />
            </label>
            <label className="lc-field">
              <span>Symbol</span>
              <input
                value={form.symbol}
                maxLength={20}
                placeholder="OWL"
                disabled={checking}
                onChange={(e) => {
                  symbolTouched.current = true;
                  edit({ symbol: cleanSymbol(e.target.value) });
                }}
              />
            </label>

            <div className="lc-field wide">
              <span>Pairs with</span>
              <input
                className="lc-search"
                value={query}
                placeholder="Search a stock: NVDA, Tesla, SPY…"
                aria-label="Search a pair"
                disabled={checking}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="lc-chips" role="listbox" aria-label="Pair">
                {chips.map((p, i) => {
                  const on = pair?.address === p.address;
                  return (
                    <button
                      key={p.address}
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={`lc-chip${on ? " on" : ""}${p.illiquid ? " thin" : ""}${p.kind === "major" ? " major" : ""}`}
                      style={{ "--i": i } as CSSProperties}
                      title={p.illiquid ? `${p.name}: Bankr marks its pool as thin right now` : p.name}
                      disabled={checking || !p.ready}
                      onClick={() => {
                        edit({ pair: p.symbol });
                        setQuery("");
                      }}
                    >
                      <b>{p.symbol}</b>
                      <small>{p.kind === "major" ? "default" : p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name}</small>
                    </button>
                  );
                })}
                {pairs && !chips.length ? <span className="lc-none">Nothing among Bankr&apos;s pairs matches.</span> : null}
                {!pairs && !pairsError ? <span className="lc-none">Reading Bankr&apos;s pairs on Robinhood Chain…</span> : null}
                {pairsError ? (
                  <span className="lc-none">
                    {pairsError}{" "}
                    <button type="button" className="link-btn" onClick={() => void loadPairs()}>
                      Try again
                    </button>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="lc-field wide">
              <span>Fees pay to</span>
              <div className="lc-seg" role="radiogroup" aria-label="Fees pay to">
                <button type="button" role="radio" aria-checked={form.feesTo === "wallet"} disabled={checking} onClick={() => edit({ feesTo: "wallet" })}>
                  Your wallet{wallet.address ? <small>{short(wallet.address)}</small> : null}
                </button>
                <button type="button" role="radio" aria-checked={form.feesTo === "bankr"} disabled={checking} onClick={() => edit({ feesTo: "bankr" })}>
                  Your Bankr wallet{checked?.answer.deployer ? <small>{short(checked.answer.deployer)}</small> : null}
                </button>
              </div>
            </div>

            <label className="lc-field wide">
              <span>About · optional</span>
              <textarea rows={2} maxLength={500} value={form.description} placeholder="One or two lines on what the token is for" disabled={checking} onChange={(e) => edit({ description: e.target.value })} />
            </label>

            <div className="lc-field wide lc-extras">
              <button type="button" className="lc-logo" disabled={checking || logo.busy} onClick={() => fileRef.current?.click()}>
                {form.image ? <img src={form.image} alt="" /> : <span>{logo.busy ? "…" : "+"}</span>}
                <small>{logo.busy ? "Uploading…" : form.image ? "Change logo" : "Logo · optional"}</small>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickLogo(file);
                  e.target.value = "";
                }}
              />
              <button type="button" className={`lc-opt${form.vesting ? " on" : ""}`} aria-pressed={form.vesting} disabled={checking} onClick={() => edit({ vesting: !form.vesting })}>
                <i aria-hidden />
                <b>Vesting</b>
                <small>{form.vesting ? "15% of supply to the fee recipient over a year" : "off: all of the supply seeds the pool"}</small>
              </button>
              <button
                type="button"
                className={`lc-opt${form.quoteOnlyFees ? " on" : ""}`}
                aria-pressed={form.quoteOnlyFees}
                disabled={checking}
                onClick={() => edit({ quoteOnlyFees: !form.quoteOnlyFees })}
              >
                <i aria-hidden />
                <b>Fees in {pair?.symbol ?? "the pair"} only</b>
                <small>{form.quoteOnlyFees ? "every fee is paid in the pair token" : "fees come in both tokens"}</small>
              </button>
            </div>
            {logo.error ? <p className="hint err wide">{logo.error}</p> : null}
          </div>

          {keySaved === false ? (
            <p className="lc-key">
              Launches go out from your Bankr wallet, so this needs your Bankr API key, with Bankr&apos;s Token Launch API turned on and read-write access.{" "}
              <button type="button" className="chip-btn" onClick={onSettings}>
                Add it in Settings
              </button>
            </p>
          ) : null}

          {answer ? <Checks answer={answer} /> : stale ? <p className="lc-stale">Changed since the check. Check again before launching.</p> : null}
          {error ? <p className="hint err">{error}</p> : null}

          <Terms />

          <div className="lc-act">
            {answer?.ready ? (
              <HoldToApprove label="Hold to launch" disabled={stale || inFlight || checking} onApprove={launch} />
            ) : (
              <button type="button" className="pill small" disabled={!formReady(form) || checking || keySaved === false} onClick={() => void check()}>
                {checking ? "Checking with Bankr…" : answer ? "Check again" : stale ? "Check again" : "Check and simulate"}
              </button>
            )}
            {answer?.ready ? (
              <button type="button" className="link-btn" disabled={checking} onClick={() => void check()}>
                Check again
              </button>
            ) : null}
          </div>
          <p className="lc-honest">
            You sign nothing on chain. Bankr deploys the token and its pool from your Bankr wallet
            {answer ? ` ${short(answer.deployer)}` : ""}, which pays the gas on Robinhood Chain. Nothing launches until you hold.
          </p>
        </>
      )}
    </section>
  );
}

const MARK: Record<string, string> = { ok: "✓", warn: "!", bad: "✕" };

/** Bankr's rules as checks, then the simulation. */
function Checks({ answer }: { answer: DraftAnswer }) {
  const mark = (c: LaunchCheck) => (!c.ok ? "bad" : c.warn ? "warn" : "ok");
  const sim = answer.preview;
  return (
    <ul className="lc-checks" aria-label="Checks">
      {answer.checks.map((c, i) => (
        <li key={c.id} className={mark(c)} style={{ "--i": i } as CSSProperties}>
          <i aria-hidden>{MARK[mark(c)]}</i>
          <span>{c.label}</span>
          <small>{c.note}</small>
        </li>
      ))}
      <li className={sim ? "ok" : answer.simError ? "bad" : "skip"} style={{ "--i": answer.checks.length } as CSSProperties}>
        <i aria-hidden>{sim ? MARK.ok : answer.simError ? MARK.bad : "·"}</i>
        <span>Bankr&apos;s simulation</span>
        <small>
          {sim
            ? `token ${short(sim.tokenAddress)}${sim.poolId ? ` · pool ${short(sim.poolId)}` : ""} · nothing sent, no launch used`
            : (answer.simError ?? "runs once every check above passes")}
        </small>
      </li>
    </ul>
  );
}

/** What a launch means for the fees and the supply, folded until asked. */
function Terms() {
  return (
    <details className="lc-terms">
      <summary>Fees and supply</summary>
      <dl>
        <dt>Swap fee</dt>
        <dd>0.7% of every trade in the pool: 95% to the fee recipient, 5% to the protocol. Bankr&apos;s hook adds its own fees, 1.75% in all.</dd>
        <dt>Supply</dt>
        <dd>100 billion. With vesting, 15% goes to the fee recipient over a year after a 30-day cliff and 85% seeds the pool; without it, all of it does.</dd>
        <dt>First minutes</dt>
        <dd>For five minutes no wallet can hold more than 2% of the supply, and a fee that fades over about ten seconds slows snipers.</dd>
        <dt>Fixed at launch</dt>
        <dd>Name, symbol, pair, vesting and how fees are paid. Who receives the fees can move later, on Bankr.</dd>
      </dl>
    </details>
  );
}

/** A launch Bankr is deploying, or what came of it, until the person puts it away. */
function LaunchOutcomeView({ run }: { run: LaunchRun }) {
  const { outcome, summary } = run;
  if (!outcome) {
    return (
      <div className="lc-sending" aria-live="polite">
        <b>
          Bankr is deploying ${summary.symbol} and its pool with {summary.pairedSymbol}…
        </b>
        <p>It signs from your Bankr wallet and waits for Robinhood Chain, which can take a couple of minutes. You can close this card: the outcome waits here.</p>
        <i className="tr-wait" aria-hidden>
          <i />
        </i>
      </div>
    );
  }
  if (outcome.kind === "live") {
    const r = outcome.receipt;
    return (
      <div className="lc-live" aria-live="polite">
        <span className="lc-stamp" aria-hidden>
          Live
        </span>
        <b>
          ${r.symbol} is live on Robinhood Chain
        </b>
        <dl>
          <dt>Token</dt>
          <dd title={r.tokenAddress}>{r.tokenAddress}</dd>
          {r.poolId ? (
            <>
              <dt>Pool</dt>
              <dd title={r.poolId}>{r.poolId}</dd>
            </>
          ) : null}
          <dt>Pair</dt>
          <dd>{r.pairedSymbol} · Uniswap v4, deployed by Bankr</dd>
          <dt>Fees to</dt>
          <dd>{short(r.feeRecipient)}</dd>
        </dl>
        <nav className="lc-links" aria-label="Where to see it">
          <a href={r.links.uniswap} target="_blank" rel="noreferrer">
            Uniswap ↗
          </a>
          <a href={r.links.bankr} target="_blank" rel="noreferrer">
            Bankr ↗
          </a>
          <a href={r.links.explorer} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
          {r.txHash ? (
            <a href={launchTxUrl(r.txHash)} target="_blank" rel="noreferrer">
              Transaction ↗
            </a>
          ) : null}
        </nav>
        <small>A new pool shows up on screeners after its first trade.</small>
        <button type="button" className="link-btn" onClick={() => dismissLaunch(run.module)}>
          Done
        </button>
      </div>
    );
  }
  if (outcome.kind === "refused") {
    return (
      <div className="lc-refused" role="alert">
        <b>Nothing was launched</b>
        <p>{outcome.message}</p>
        <button type="button" className="link-btn" onClick={() => dismissLaunch(run.module)}>
          Back to the draft
        </button>
      </div>
    );
  }
  return (
    <div className="lc-unconfirmed" role="alert">
      <b>Not confirmed</b>
      <p>{outcome.message}</p>
      <a className="link-btn" href={launchAddressUrl(summary.deployer)} target="_blank" rel="noreferrer">
        See the Bankr wallet on the explorer ↗
      </a>
      <button type="button" className="link-btn" onClick={() => dismissLaunch(run.module)}>
        I checked the explorer
      </button>
    </div>
  );
}

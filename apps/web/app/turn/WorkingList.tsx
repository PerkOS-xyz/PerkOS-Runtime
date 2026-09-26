"use client";

import { useEffect, useState } from "react";

import { workingView, type TurnView, type TurnWork } from "./turnState";

/** The time, once a second while `live`, so the checklist's seconds move. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/**
 * "Sparky · working": what the turn is doing while the team works. The last
 * finished steps with a check, the step in progress with its seconds once it
 * takes a while, and the whole turn's time and step count.
 */
export function WorkingList({ view }: { view: TurnView }) {
  const now = useNow(view.live);
  const w = workingView(view, now);
  const earlier = w.count - w.done.length - (w.current ? 1 : 0);
  return (
    <div className="st-turn assistant working">
      <span className="st-who">Sparky · working</span>
      <div className="st-work">
        <i className="st-work-scan" aria-hidden />
        <ol aria-live="polite">
          {earlier > 0 ? <li className="earlier">{earlier === 1 ? "1 earlier step" : `${earlier} earlier steps`}</li> : null}
          {w.done.map((text, i) => (
            <li key={`${earlier + i}-${text}`} className="done">
              <b aria-hidden>✓</b>
              {text}
            </li>
          ))}
          {w.current ? (
            <li className="now">
              <b className="st-work-pulse" aria-hidden />
              {w.current.text}
              {w.current.seconds !== null ? <em> · {w.current.seconds} s</em> : null}
            </li>
          ) : null}
        </ol>
        <small>{w.line}</small>
      </div>
    </div>
  );
}

/** A finished turn's checklist, folded onto Sparky's summary: "Worked 71 s · 9 steps". */
export function WorkFold({ work }: { work: TurnWork }) {
  return (
    <details className="st-worked">
      <summary>{work.line}</summary>
      <ol>
        {work.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

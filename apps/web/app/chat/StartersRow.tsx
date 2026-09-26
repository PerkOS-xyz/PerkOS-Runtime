"use client";

import { useRef, type ReactNode } from "react";

/**
 * The suggestions as one row that scrolls sideways, with a chevron at each end
 * that moves it. The chevrons sit outside the scroller, so a suggestion never
 * passes under one: the row fades out before it reaches them.
 */
export function StartersRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);

  const nudge = (direction: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(220, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <>
      <button type="button" className="st-starters-nav prev" aria-label="Earlier suggestions" onClick={() => nudge(-1)} />
      <div className="st-starters" aria-label="Suggested questions" ref={row}>
        {children}
      </div>
      <button type="button" className="st-starters-nav next" aria-label="More suggestions" onClick={() => nudge(1)} />
    </>
  );
}

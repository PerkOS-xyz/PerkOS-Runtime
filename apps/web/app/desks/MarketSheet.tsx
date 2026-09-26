"use client";

import { useEffect } from "react";

import type { Chain } from "./chains";
import { MarketPanel } from "./MarketPanel";

/** The desk's market, opened from the right over the desk. Escape closes it. */
export function MarketSheet({ title, module, chain, onClose }: { title: string; module: string; chain: Chain; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className={`mk-sheet ${chain}`} aria-label={`${title} market`}>
      <div className="mk-sheet-bar">
        <span className="kicker">{title}</span>
        <button type="button" className="bubble-close" aria-label="Close the market" onClick={onClose}>
          &times;
        </button>
      </div>
      <MarketPanel module={module} chain={chain} />
    </aside>
  );
}

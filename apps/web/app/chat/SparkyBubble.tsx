"use client";

import { useEffect, useState } from "react";

import { SparkyChat } from "./SparkyChat";

/** Sparky in the corner: a bubble that opens a compact chat. The conversation stays while it is closed. */
export function SparkyBubble({ model }: { model: string | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`bubble${open ? " open" : ""}`}>
      <section className="bubble-panel" aria-label="Chat with Sparky" aria-hidden={!open}>
        <header>
          <img src="/sparky.png" alt="" width={34} height={34} />
          <div>
            <b>Sparky</b>
            {model ? <small>{model}</small> : null}
          </div>
          <button type="button" className="bubble-close" aria-label="Close" onClick={() => setOpen(false)}>
            &times;
          </button>
        </header>
        <SparkyChat compact />
      </section>
      <button
        type="button"
        className="bubble-button"
        aria-label={open ? "Close the chat with Sparky" : "Ask Sparky"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <img src="/sparky.png" alt="" width={46} height={46} />
        {!open ? <span className="bubble-tip">Ask Sparky</span> : null}
      </button>
    </div>
  );
}

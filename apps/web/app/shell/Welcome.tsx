const CHECKS = ["Your wallet signs, nobody else", "Your model: Grok or local", "They draft. You approve."];

export function Welcome({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  return (
    <main className="hero">
      <div className="hero-copy">
        <img className="hero-mark" src="/logo-name.png" alt="PerkOS" />
        <span className="kicker">PerkOS Runtime</span>
        <h1 className="hero-title">
          Hi, I&apos;m Sparky.
          <span>Let&apos;s find your desk.</span>
        </h1>
        <p className="hero-sub">
          I answer your questions and point you to the right desk. Each desk brings its own team, its own market and its
          own screens.
        </p>
        <div>
          <button type="button" className="pill" disabled={busy} onClick={onStart}>
            {busy ? "Loading…" : "Get started"} <span className="arrow" aria-hidden>&rarr;</span>
          </button>
        </div>
        <ul className="hero-checks">
          {CHECKS.map((c) => (
            <li key={c}>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {c}
            </li>
          ))}
        </ul>
      </div>
      <div className="hero-stage" aria-hidden>
        <div className="hero-glow" />
        <img className="hero-sparky" src="/sparky-full.png" alt="" width={900} height={1364} />
      </div>
    </main>
  );
}

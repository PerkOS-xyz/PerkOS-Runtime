import type { LoginState } from "./useLogin";

const CHECKS = ["Your wallet signs, nobody else", "Your model: Grok, Claude, ChatGPT or local", "They draft. You approve."];

/** Screen 1: welcome and login. The wallet window opens from here and the signature is asked here too. */
export function Welcome({ login, busy, walletError }: { login: LoginState; busy: boolean; walletError: string }) {
  const label =
    login.phase === "connecting"
      ? "Open the wallet window"
      : login.phase === "signing"
        ? "Waiting for your signature…"
        : login.phase === "error"
          ? "Try again"
          : "Get started";
  const onClick = login.phase === "error" ? login.retry : login.start;

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
        <div className="hero-cta">
          <button type="button" className="pill" disabled={busy || login.phase === "signing"} onClick={onClick}>
            {busy ? "Loading…" : label} <span className="arrow" aria-hidden>&rarr;</span>
          </button>
          <LoginStatus login={login} walletError={walletError} />
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
        <img className="hero-sparky" src="/sparky-samurai-full.png" alt="" width={900} height={1364} />
      </div>
    </main>
  );
}

function LoginStatus({ login, walletError }: { login: LoginState; walletError: string }) {
  if (login.phase === "connecting") {
    return (
      <p className="hero-status" role="status">
        {walletError || "Choose your wallet in the window that opened. Connecting does not spend anything."}
      </p>
    );
  }
  if (login.phase === "signing") {
    return (
      <div className="hero-status" role="status">
        <div className="wz-wait" aria-hidden>
          <i />
        </div>
        Approve the signature in your wallet. It proves the wallet is yours; nothing is spent.
      </div>
    );
  }
  if (login.phase === "error") {
    return (
      <p className="hero-status err" role="alert">
        {login.message}{" "}
        <button type="button" className="link-btn" onClick={() => void login.switchWallet()}>
          Use another wallet
        </button>
      </p>
    );
  }
  return null;
}

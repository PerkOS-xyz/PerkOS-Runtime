export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="welcome">
      <img className="sparky" src="/sparky-full.png" alt="Sparky" width={900} height={1364} />
      <h1>Hi, I&apos;m Sparky.</h1>
      <p className="sub">
        I answer your questions and help you pick the right desk. Each desk brings its own team, its own market and its
        own screens.
      </p>
      <button type="button" className="cta" onClick={onStart}>
        Get started
      </button>
    </main>
  );
}

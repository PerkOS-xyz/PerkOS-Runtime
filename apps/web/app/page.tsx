/**
 * Landing: connect a wallet, then choose a model.
 */

const STEPS = [
  { n: "1", title: "Connect your wallet", sub: "It is how PerkOS knows you. Nothing moves without your signature." },
  { n: "2", title: "Choose a model", sub: "Ollama or LM Studio on this machine, or a model you already pay for." }
];

export default function Landing() {
  return (
    <main className="landing">
      <header className="brand">
        <img src="/logo.png" alt="" width={36} height={36} />
        <span>PerkOS Runtime</span>
      </header>
      <section className="hero">
        <h1>Your desks, in one place.</h1>
        <p className="sub">
          Sparky answers what you ask and helps you pick the desk for the job. Each desk brings its own team, its own
          market and its own screens.
        </p>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="n">{s.n}</span>
              <div>
                <b>{s.title}</b>
                <small>{s.sub}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

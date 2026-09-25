const STEPS = [
  { n: "1", title: "Connect your wallet", sub: "It is how PerkOS knows you. Nothing moves without your signature." },
  { n: "2", title: "Choose a model", sub: "Ollama or LM Studio on this machine, or a model you already pay for." }
];

export function Setup({ onBack }: { onBack: () => void }) {
  return (
    <main className="setup">
      <header className="brand">
        <img src="/sparky.png" alt="" width={32} height={32} />
        <span>PerkOS Runtime</span>
      </header>
      <section>
        <h2>Two steps and we are ready.</h2>
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
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
      </section>
    </main>
  );
}

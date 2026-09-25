import type { ReactNode } from "react";

const STEPS = ["Sign in", "AI", "Desk"];

/** Card layout shared by the setup steps, with the progress rail on top. */
export function WizardFrame({ step, header, children }: { step: 1 | 2 | 3; header?: ReactNode; children: ReactNode }) {
  return (
    <main className="wizard">
      {header ? <div className="wz-top">{header}</div> : null}
      <ol className="wz-rail" aria-label="Setup progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "now" : "";
          return (
            <li key={label} className={state} aria-current={n === step ? "step" : undefined}>
              <span className="wz-dot">
                {n < step ? (
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  n
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <section className="wz-card">
        <img className="wz-sparky" src="/sparky.png" alt="" width={76} height={76} />
        {children}
      </section>
    </main>
  );
}

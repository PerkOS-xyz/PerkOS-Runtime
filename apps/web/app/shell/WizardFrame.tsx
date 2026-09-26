import type { ReactNode } from "react";

/** A single card over the background, with the header above it. */
export function WizardFrame({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <main className="wizard">
      {header ? <div className="wz-top">{header}</div> : null}
      <section className="wz-card">
        <img className="wz-sparky" src="/sparky-samurai-head.png" alt="" width={76} height={76} />
        {children}
      </section>
    </main>
  );
}

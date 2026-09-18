"use client";

// Cuando PerkOS responde 402, la persona merece una pantalla, no una pestana del
// navegador que se abre sola. El app se queda la explicacion y le entrega a la web
// solo la transaccion: que es lo que cuesta, que opciones hay y que pasa despues.
//
// Tres puertas, en el orden en que la gente las necesita: tengo un codigo (lo que
// usa el equipo y quien recibe una invitacion), anadir horas (el pago de verdad) y
// ahora no. Ninguna gasta nada por su cuenta: la de pagar abre pay.perkos.xyz y la
// persona aprueba alli.

export type PayWallProps = {
  /** Horas de reloj que quedan para ESTE desk, o null si no se sabe. */
  deskHours: number | null;
  /** Lo que cuesta una hora de este desk despierto. 0 si aun no se sabe. */
  rateUsdPerDeskHour: number;
  /** Por que no se puede correr: lo que dice la API. */
  reason: string;
  /** Esperando a que llegue el pago desde el navegador. */
  waiting: boolean;
  onPay: () => void;
  onClose: () => void;
};

const money = (n: number) => `$${n.toFixed(2)}`;

export default function PayWall({ deskHours, rateUsdPerDeskHour, reason, waiting, onPay, onClose }: PayWallProps) {
  const ranOut = reason === "credits-exhausted" || (deskHours !== null && deskHours <= 0);
  return (
    <div className="paywall">
      <div className="pw-card">
        <header className="pw-head">
          <div className="pw-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-name.png" alt="PerkOS" />
            <span className="k">YOUR DESK</span>
          </div>
          <button type="button" className="pw-back" onClick={onClose}>Back to the desk</button>
        </header>

        <div className="pw-intro">
          <b>{ranOut ? "Your desk is out of hours." : "Your desk needs hours to run."}</b>
          <p className="lead">
            The team runs on real machines, and that costs money for every hour they are awake
            {rateUsdPerDeskHour > 0 ? `, about ${money(rateUsdPerDeskHour)} an hour for this desk` : ""}.
            The meter stops the moment they sleep, and nothing you have made is lost.
          </p>
        </div>

        {waiting ? (
          <p className="pw-waiting">
            Waiting for your payment on pay.perkos.xyz. Finish in the browser and come back. You can
            close that tab or even quit the app: PerkOS picks it up the next time you return.
          </p>
        ) : (
          <div className="pw-doors">
            <button type="button" className="pw-door go" onClick={onPay}>
              <b>Add hours</b>
              <small>Card, or USDC on Base from the wallet you are signed in with. Opens pay.perkos.xyz.</small>
            </button>
            <button type="button" className="pw-door" onClick={onPay}>
              <b>I have a code</b>
              <small>Redeem it on the same page. The hours land on this wallet straight away.</small>
            </button>
            <button type="button" className="pw-door quiet" onClick={onClose}>
              <b>Not now</b>
              <small>The desk stays as it is, with its name, its keys and everything it remembers.</small>
            </button>
          </div>
        )}

        <p className="pw-foot">Nothing is charged from inside this app. You approve every payment yourself.</p>
      </div>
    </div>
  );
}

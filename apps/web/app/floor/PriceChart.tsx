"use client";

// Curva de precio de un token lanzado: area con degradado, min y max en el
// margen, rango de tiempo y un estado vacio cuando aun no hay velas. Es un
// grafico de lectura rapida (sin ejes ni tooltips): la decision se toma en
// el chat, aqui solo se ve la forma del dia.
export default function PriceChart({ points, h = 132, label = "24h", up }: { points?: number[]; h?: number; label?: string; up?: boolean }) {
  const w = 600; // viewBox; el SVG escala al ancho de la tarjeta
  const pad = { l: 8, r: 64, t: 10, b: 18 };
  if (!points || points.length < 3) {
    return (
      <div className="pc empty" style={{ height: h }}>
        <span>Not enough trades yet for a curve</span>
        <small>The pool needs a few 15 minute candles</small>
      </div>
    );
  }
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || max || 1;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${pad.l},${(pad.t + ih).toFixed(1)} Z`;
  const rising = up ?? points[points.length - 1] >= points[0];
  const fmt = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toPrecision(3)}`);
  const last = points[points.length - 1];
  const iMax = points.indexOf(max), iMin = points.indexOf(min);
  const gid = `pcg-${rising ? "up" : "down"}`;
  return (
    <div className={`pc ${rising ? "up" : "down"}`} style={{ height: h }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(max)} y2={y(max)} />
        <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(min)} y2={y(min)} />
        <path className="area" d={area} fill={`url(#${gid})`} />
        <path className="line" d={line} fill="none" vectorEffect="non-scaling-stroke" />
        <circle className="dot" cx={x(points.length - 1)} cy={y(last)} r="3" />
      </svg>
      <span className="lbl max" style={{ top: y(max) - 7 }}>{fmt(max)}</span>
      <span className="lbl min" style={{ top: y(min) - 7 }}>{fmt(min)}</span>
      <span className="lbl range">{label}</span>
      <span className="lbl hi" style={{ left: `${(x(iMax) / w) * 100}%` }} aria-hidden>high</span>
      <span className="lbl lo" style={{ left: `${(x(iMin) / w) * 100}%` }} aria-hidden>low</span>
    </div>
  );
}

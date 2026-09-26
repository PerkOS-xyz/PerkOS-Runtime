/**
 * A price series as SVG paths in a fixed box, for a sparkline. Pure, so the
 * shape can be tested without a browser.
 */

export interface Spark {
  /** The line through the points. */
  line: string;
  /** The same line closed down to the bottom, for the fill under it. */
  area: string;
  /** Where the last point sits, in percent of the box. */
  last: { x: number; y: number };
  low: number;
  high: number;
}

/** Null with fewer than two points. A flat series sits in the middle of the box. */
export function sparkline(points: { at: string; value: number }[], width = 600, height = 140, pad = 8): Spark | null {
  const pts = points.map((p) => ({ t: Date.parse(p.at), v: p.value })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < 2) return null;
  pts.sort((a, b) => a.t - b.t);
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const low = Math.min(...pts.map((p) => p.v));
  const high = Math.max(...pts.map((p) => p.v));
  const x = (t: number) => (t1 === t0 ? width / 2 : ((t - t0) / (t1 - t0)) * width);
  const y = (v: number) => (high === low ? height / 2 : pad + (1 - (v - low) / (high - low)) * (height - pad * 2));
  const coords = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  const line = `M${coords.join(" L")}`;
  const area = `${line} L${x(t1).toFixed(1)},${height} L${x(t0).toFixed(1)},${height} Z`;
  const end = pts[pts.length - 1]!;
  return { line, area, last: { x: (x(end.t) / width) * 100, y: (y(end.v) / height) * 100 }, low, high };
}

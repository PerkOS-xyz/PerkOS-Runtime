import { listNotes, readNoteBody, replaceNote } from "./kb";
import { marketScan } from "./scan";

// Revision automatica de los "Market outlook": al mes (o a pedido) la mesa
// compara los precios del scan de aquel dia con los de hoy, mide los picks
// contra el promedio del mercado y deja la revision en la misma nota.
// Deterministico (sin LLM): un registro de precios, no una opinion.

export type Outlook = {
  id: string; title: string; askedAt: string; dueAt: string; due: boolean; reviewed: boolean;
  picks: string[]; avoid?: string;
  result?: ReviewResult;
};
export type ReviewResult = {
  reviewedAt: string; daysLater: number;
  rows: Array<{ symbol: string; then: number; now: number; changePct: number; pick: boolean; avoid: boolean }>;
  marketAvgPct: number; picksAvgPct?: number; avoidPct?: number; beatBy?: number; verdict: string;
};

const DAYS = 30;
const stampOf = (title: string) => { const m = title.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/); return m ? `${m[1]}T${m[2]}:00.000Z` : ""; };
const pct = (a: number, b: number) => ((a / b) - 1) * 100;
const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

function parseOutlook(body: string): { then: Map<string, number>; picks: string[]; avoid?: string; reviewed: boolean } {
  const then = new Map<string, number>();
  for (const m of body.matchAll(/^- ([A-Z]{2,6}c) \([^)]*\): \$([\d.]+)/gm)) then.set(m[1], Number(m[2]));
  const desk = body.split(/^## Desk/m)[1] ?? "";
  const scout = desk.match(/\*\*Scout\*\*:\s*([^\n]+)/)?.[1] ?? desk;
  const seen: string[] = [];
  for (const m of scout.matchAll(/\b([A-Z]{2,6}c)\b/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  const avoid = scout.match(/avoid[^.]{0,80}?\b([A-Z]{2,6}c)\b/i)?.[1];
  const picks = seen.filter((s) => s !== avoid).slice(0, 2);
  return { then, picks, avoid, reviewed: /^## Review · /m.test(body) };
}

export async function listOutlooks(desk: string): Promise<Outlook[]> {
  const notes = (await listNotes({ desk, kind: "analysis", limit: 200 })).filter((n) => n.ticker === "MARKET" && /Market outlook/i.test(n.title));
  const out: Outlook[] = [];
  for (const n of notes) {
    const full = await readNoteBody(n.id).catch(() => null);
    if (!full) continue;
    const p = parseOutlook(full.body);
    const askedAt = stampOf(n.title) || n.updatedAt;
    const dueAt = new Date(Date.parse(askedAt) + DAYS * 86_400_000).toISOString();
    const rm = full.body.match(/```json review\n([\s\S]*?)\n```/);
    let result: ReviewResult | undefined;
    try { result = rm ? (JSON.parse(rm[1]) as ReviewResult) : undefined; } catch { result = undefined; }
    out.push({ id: n.id, title: n.title, askedAt, dueAt, due: !p.reviewed && Date.now() >= Date.parse(dueAt), reviewed: p.reviewed, picks: p.picks, avoid: p.avoid, result });
  }
  return out;
}

/** Revisa un outlook: precios de entonces vs hoy, picks vs promedio. Escribe la seccion en la nota. */
export async function reviewOutlook(id: string, force = false): Promise<{ ok: true; result: ReviewResult } | { ok: false; error: string }> {
  const full = await readNoteBody(id).catch(() => null);
  if (!full) return { ok: false, error: "not_found" };
  const p = parseOutlook(full.body);
  if (p.reviewed) return { ok: false, error: "already_reviewed" };
  const askedAt = stampOf(full.title) || full.updatedAt;
  const daysLater = (Date.now() - Date.parse(askedAt)) / 86_400_000;
  if (!force && daysLater < DAYS) return { ok: false, error: "not_due" };
  if (!p.then.size) return { ok: false, error: "no_prices_in_note" };
  const scan = await marketScan();
  const now = new Map(scan.rows.map((r) => [r.symbol, r.priceUsd ?? 0]));
  const rows = [...p.then.entries()].filter(([s, v]) => v > 0 && (now.get(s) ?? 0) > 0).map(([symbol, then]) => {
    const cur = now.get(symbol)!;
    return { symbol, then, now: cur, changePct: pct(cur, then), pick: p.picks.includes(symbol), avoid: p.avoid === symbol };
  });
  if (!rows.length) return { ok: false, error: "no_overlap" };
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const marketAvgPct = avg(rows.map((r) => r.changePct));
  const pk = rows.filter((r) => r.pick);
  const picksAvgPct = pk.length ? avg(pk.map((r) => r.changePct)) : undefined;
  const av = rows.find((r) => r.avoid);
  const beatBy = picksAvgPct !== undefined ? picksAvgPct - marketAvgPct : undefined;
  const verdict = picksAvgPct === undefined
    ? "No picks could be matched to the scan; market change recorded."
    : `The picks (${pk.map((r) => r.symbol).join(", ")}) moved ${fmt(picksAvgPct)} against a market average of ${fmt(marketAvgPct)}: ${beatBy! >= 0 ? "they beat the market" : "they lagged the market"} by ${Math.abs(beatBy!).toFixed(2)} points${av ? `; the one to avoid (${av.symbol}) moved ${fmt(av.changePct)}` : ""}.`;
  const result: ReviewResult = { reviewedAt: new Date().toISOString(), daysLater: Math.round(daysLater * 10) / 10, rows, marketAvgPct, picksAvgPct, avoidPct: av?.changePct, beatBy, verdict };
  const when = result.reviewedAt.slice(0, 10);
  const table = rows.sort((a, b) => b.changePct - a.changePct).map((r) => `| ${r.symbol}${r.pick ? " (pick)" : r.avoid ? " (avoid)" : ""} | $${r.then.toFixed(2)} | $${r.now.toFixed(2)} | ${fmt(r.changePct)} |`).join("\n");
  const section = `\n\n## Review · ${when} (${result.daysLater} days later${force && daysLater < DAYS ? ", requested early" : ""})\n\n| Stock | Then | Now | Change |\n|---|---|---|---|\n${table}\n\n${verdict}\n\n_Price check by the desk against the scan of ${askedAt.slice(0, 10)}. Reference prices from the venues at review time._\n\n\`\`\`json review\n${JSON.stringify(result)}\n\`\`\`\n`;
  const body = full.body.replace(/_Review in one month\._/, `_Reviewed on ${when}._`) + section;
  const ok = await replaceNote(id, body);
  if (!ok) return { ok: false, error: "write_failed" };
  return { ok: true, result };
}

/** Revisa todo lo vencido. Devuelve cuantos se revisaron. */
export async function reviewDue(desk: string): Promise<{ due: number; reviewed: number; ids: string[] }> {
  const due = (await listOutlooks(desk)).filter((o) => o.due);
  const ids: string[] = [];
  for (const o of due) { const r = await reviewOutlook(o.id); if (r.ok) ids.push(o.id); }
  return { due: due.length, reviewed: ids.length, ids };
}

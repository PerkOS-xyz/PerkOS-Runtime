import { loadSettings } from "../../../lib/settingsStore";
import { listNotes, readNoteBody } from "../../../lib/kb";

// GET /api/kb/graph?focus=NVDA -> knowledge graph curado del desk (~30-60
// nodos): activos, agentes, fuentes de precio, decisiones y notas del vault
// local, con aristas de "menciona", "participo", "uso". Sin LLM: las aristas
// salen del frontmatter (ticker, kind) y del run JSON de cada decision.
type NodeType = "asset" | "agent" | "source" | "decision" | "note";
type GNode = { id: string; type: NodeType; label: string; sub?: string; at: number; verdict?: "GO" | "BLOCK"; noteId?: string; ticker?: string; focus?: boolean; degree: number };
type GLink = { source: string; target: string; kind: string };

const AGENTS = ["scout", "risk", "trader", "auditor"] as const;
const SOURCES: Array<[string, string]> = [["uniswap", "Uniswap V3"], ["bankr", "Bankr"], ["chainlink", "Chainlink"], ["news", "News"]];

export async function GET(req: Request) {
  const u = new URL(req.url);
  const focus = (u.searchParams.get("focus") ?? "").trim().toUpperCase().replace(/C$/, "").slice(0, 12);
  const s = await loadSettings();
  const desk = s.fleetTemplateId;
  const notes = await listNotes({ desk, limit: 200 });
  const nodes = new Map<string, GNode>();
  const links: GLink[] = [];
  const now = Date.now();
  const add = (n: Omit<GNode, "degree">) => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 }); return nodes.get(n.id)!; };
  const link = (a: string, b: string, kind: string) => {
    if (!nodes.has(a) || !nodes.has(b) || a === b) return;
    if (links.some((l) => l.source === a && l.target === b)) return;
    links.push({ source: a, target: b, kind });
    nodes.get(a)!.degree += 1;
    nodes.get(b)!.degree += 1;
  };
  const tickerId = (t: string) => `asset:${t.toUpperCase().replace(/C$/, "")}`;

  for (const r of AGENTS) add({ id: `agent:${r}`, type: "agent", label: r.charAt(0).toUpperCase() + r.slice(1), sub: "on PerkOS", at: 0 });
  for (const [id, label] of SOURCES) add({ id: `source:${id}`, type: "source", label, sub: "price source", at: 0 });
  if (focus) add({ id: tickerId(focus), type: "asset", label: `${focus}c`, sub: "in focus", at: now, ticker: focus, focus: true });

  // Decisiones (ultimas 14): quien participo, con que fuentes, sobre que activo.
  const decisions = notes.filter((n) => n.kind === "decision").slice(0, 14);
  for (const d of decisions) {
    const full = await readNoteBody(d.id).catch(() => null);
    const m = full?.body.match(/```json\n([\s\S]*?)\n```/);
    let run: { verdict?: "GO" | "BLOCK"; endedAt?: number; startedAt?: number; quote?: { symbol?: string; side?: string; amountIn?: string; tokenIn?: string; bankr?: unknown } | null; facts?: { chainlinkUsd?: number } | null; agents?: Record<string, { state?: string }> } | null = null;
    try { run = m ? JSON.parse(m[1]) : null; } catch { run = null; }
    const at = run?.endedAt ?? Date.parse(d.updatedAt) ?? now;
    const q = run?.quote;
    const label = q?.side && q.amountIn ? `${q.side === "buy" ? "Buy" : "Sell"} ${q.amountIn} ${q.tokenIn ?? ""} ${q.symbol ?? d.ticker ?? ""}`.trim() : d.title.replace(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2} /, "");
    const id = `decision:${d.id}`;
    add({ id, type: "decision", label, sub: new Date(at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }), at, verdict: run?.verdict, noteId: d.id, ticker: d.ticker });
    const t = d.ticker ?? q?.symbol?.replace(/c$/i, "");
    if (t) { add({ id: tickerId(t), type: "asset", label: `${t.toUpperCase()}c`, sub: "tokenized stock", at, ticker: t.toUpperCase() }); link(id, tickerId(t), "about"); }
    for (const r of AGENTS) {
      const st = run?.agents?.[r]?.state;
      if (!run || st === "delivered" || st === "blocked") { link(`agent:${r}`, id, "spoke"); const a = nodes.get(`agent:${r}`)!; a.at = Math.max(a.at, at); }
    }
    link(id, "source:uniswap", "quoted");
    if (q?.bankr) link(id, "source:bankr", "quoted");
    if (run?.facts?.chainlinkUsd) link(id, "source:chainlink", "referenced");
    for (const src of ["uniswap", "bankr", "chainlink"]) { const n = nodes.get(`source:${src}`)!; if (links.some((l) => l.source === id && l.target === n.id)) n.at = Math.max(n.at, at); }
  }

  // Notas (analysis, journal, memory): las ultimas 12, ligadas a su activo y sus fuentes.
  const others = notes.filter((n) => n.kind === "analysis" || n.kind === "journal" || n.kind === "memory").slice(0, 12);
  for (const n of others) {
    const at = Date.parse(n.updatedAt) || now;
    const id = `note:${n.id}`;
    add({ id, type: "note", label: n.kind === "journal" ? `Journal ${n.title.slice(-10)}` : n.kind === "memory" ? "Desk memory" : `${n.ticker ?? "Analysis"} analysis`, sub: n.kind, at, noteId: n.id, ticker: n.ticker });
    if (n.ticker) { add({ id: tickerId(n.ticker), type: "asset", label: `${n.ticker.toUpperCase()}c`, sub: "tokenized stock", at, ticker: n.ticker.toUpperCase() }); link(id, tickerId(n.ticker), "about"); }
    if (n.kind === "analysis") { link(id, "source:uniswap", "used"); link(id, "source:chainlink", "used"); link(id, "source:news", "used"); const nn = nodes.get("source:news")!; nn.at = Math.max(nn.at, at); }
    if (n.kind === "journal") for (const d of decisions) if (d.updatedAt.slice(0, 10) === n.updatedAt.slice(0, 10)) link(id, `decision:${d.id}`, "same day");
  }
  // Los agentes se conocen entre si por el orden del proceso.
  link("agent:scout", "agent:trader", "hands off"); link("agent:risk", "agent:trader", "hands off"); link("agent:scout", "agent:auditor", "hands off"); link("agent:risk", "agent:auditor", "hands off");

  // Podar fuentes sin uso y limitar el tamano (el research avisa del hairball).
  for (const [id] of [...nodes]) { const n = nodes.get(id)!; if (n.type === "source" && n.degree === 0) nodes.delete(id); }
  const out = [...nodes.values()].sort((a, b) => b.at - a.at).slice(0, 60);
  const keep = new Set(out.map((n) => n.id));
  return Response.json({ desk, focus: focus || null, at: new Date().toISOString(), nodes: out, links: links.filter((l) => keep.has(l.source) && keep.has(l.target)) });
}

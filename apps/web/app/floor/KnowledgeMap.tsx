"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Map del desk como knowledge graph (tipo Obsidian, curado): activos,
// agentes, fuentes de precio, decisiones y notas del vault local. Color por
// tipo, tamano por enlaces, brillo por recencia; hover ilumina el vecindario;
// click abre la nota, la decision o corre Analyze. Force layout en canvas
// (react-force-graph-2d sobre d3-force); se congela al asentarse.

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type NodeType = "asset" | "agent" | "source" | "decision" | "note";
export type GraphNode = { id: string; type: NodeType; label: string; sub?: string; at: number; verdict?: "GO" | "BLOCK"; noteId?: string; ticker?: string; focus?: boolean; degree: number; x?: number; y?: number };
type GraphLink = { source: string | GraphNode; target: string | GraphNode; kind: string };
type Graph = { nodes: GraphNode[]; links: GraphLink[] };

const COLOR: Record<NodeType, string> = { asset: "#3d7eff", agent: "#ec1b69", source: "#8a94ad", decision: "#3dc878", note: "#e9dcc3" };
const AGENT_COLOR: Record<string, string> = { scout: "#3d7eff", risk: "#ffb347", trader: "#a855f7", auditor: "#2dd4bf" };

function colorOf(n: GraphNode): string {
  if (n.type === "agent") return AGENT_COLOR[n.id.replace("agent:", "")] ?? COLOR.agent;
  if (n.type === "decision") return n.verdict === "BLOCK" ? "#ff5a6a" : COLOR.decision;
  return COLOR[n.type];
}
function recency(n: GraphNode, now: number): number {
  if (!n.at) return 0.55;
  const h = (now - n.at) / 3_600_000;
  return h < 24 ? 1 : h < 24 * 7 ? 0.75 : 0.45;
}
const idOf = (v: string | GraphNode) => (typeof v === "string" ? v : v.id);

export default function KnowledgeMap({ focus, onPick }: { focus?: string; onPick: (n: GraphNode) => void }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [size, setSize] = useState({ w: 480, h: 360 });
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<{ zoomToFit: (ms?: number, px?: number) => void; d3Force: (name: string, force?: unknown) => { strength?: (v: number) => unknown; distance?: (v: number | ((l: GraphLink) => number)) => unknown } | undefined; d3ReheatSimulation: () => void } | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/kb/graph${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`).then((r) => r.json()).then((j: Graph) => { if (alive && Array.isArray(j.nodes)) setGraph({ nodes: j.nodes, links: j.links }); }).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [focus]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(240, el.clientWidth), h: Math.max(220, el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.max(240, el.clientWidth), h: Math.max(220, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!graph) return m;
    for (const l of graph.links) {
      const a = idOf(l.source), b = idOf(l.target);
      if (!m.has(a)) m.set(a, new Set()); if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b); m.get(b)!.add(a);
    }
    return m;
  }, [graph]);

  // Fuerzas: mas repulsion y enlaces mas largos que el default, para que un
  // grafo de 20-60 nodos se lea (no un grumo), y ajuste al encuadre al asentarse.
  useEffect(() => {
    if (!graph) return;
    const t = window.setTimeout(() => {
      const fg = fgRef.current;
      if (!fg) return;
      fg.d3Force("charge")?.strength?.(-220);
      fg.d3Force("link")?.distance?.((l: GraphLink) => { const a = typeof l.source === "string" ? l.source : l.source.id; return a.startsWith("agent:") || l.kind === "hands off" ? 70 : 52; });
      fg.d3ReheatSimulation();
      window.setTimeout(() => fg.zoomToFit(500, 36), 1800);
    }, 60);
    return () => window.clearTimeout(t);
  }, [graph]);

  const now = Date.now();
  const lit = (id: string) => !hover || hover.id === id || neighbors.get(hover.id)?.has(id);

  const drawNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = Math.min(11, 3.2 + Math.sqrt(node.degree) * 1.6) * (node.focus ? 1.35 : 1);
    const c = colorOf(node);
    const on = lit(node.id);
    const alpha = (on ? 1 : 0.18) * recency(node, now);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (on && (node.focus || hover?.id === node.id || recency(node, now) === 1)) { ctx.shadowColor = c; ctx.shadowBlur = node.focus || hover?.id === node.id ? 22 : 10; }
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.shadowBlur = 0;
    const showLabel = node.type !== "note" || hover?.id === node.id || scale > 2.2;
    if (showLabel) {
      const fs = Math.max(2.6, 10 / scale);
      ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = on ? "#e6ecff" : "#6f7d99";
      ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + r + 2 / scale);
    }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, neighbors, now]);

  return (
    <div className="kmap" ref={boxRef}>
      {graph ? (
        <ForceGraph2D
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={fgRef as any}
          width={size.w}
          height={size.h}
          graphData={graph}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={(n, ctx, scale) => drawNode(n as GraphNode, ctx, scale)}
          nodePointerAreaPaint={(n, color, ctx) => { const node = n as GraphNode; const r = Math.min(11, 3.2 + Math.sqrt(node.degree) * 1.6) + 3; ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }}
          linkColor={(l) => { const a = idOf((l as GraphLink).source), b = idOf((l as GraphLink).target); const on = !hover || hover.id === a || hover.id === b; return on ? "rgba(150,170,210,0.35)" : "rgba(150,170,210,0.08)"; }}
          linkWidth={(l) => { const a = idOf((l as GraphLink).source), b = idOf((l as GraphLink).target); return hover && (hover.id === a || hover.id === b) ? 1.6 : 0.8; }}
          onNodeHover={(n) => setHover((n as GraphNode | null) ?? null)}
          onNodeClick={(n) => onPick(n as GraphNode)}
          cooldownTicks={reduced ? 0 : 160}
          onEngineStop={() => fgRef.current?.zoomToFit(400, 36)}
          enableNodeDrag={false}
          d3VelocityDecay={0.35}
        />
      ) : (
        <p className="hint">Reading the vault…</p>
      )}
      <div className="kmap-legend">
        <span><i style={{ background: COLOR.asset }} />asset</span>
        <span><i style={{ background: COLOR.agent }} />agent</span>
        <span><i style={{ background: COLOR.decision }} />decision GO</span>
        <span><i style={{ background: "#ff5a6a" }} />BLOCK</span>
        <span><i style={{ background: COLOR.note }} />note</span>
        <span><i style={{ background: COLOR.source }} />source</span>
        <em>size = links · brightness = last 24h</em>
      </div>
      {hover ? (
        <div className="kmap-tip">
          <b>{hover.label}</b>
          {hover.sub ? <span>{hover.sub}</span> : null}
          <small>{hover.type === "asset" ? "click: analyze" : hover.type === "decision" ? "click: open in History" : hover.type === "note" ? "click: open in Notes" : hover.type === "agent" ? "click: focus in the chat" : ""}</small>
        </div>
      ) : null}
    </div>
  );
}

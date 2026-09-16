"use client";

import { useMemo } from "react";
import { ReactFlow, Background, type Node, type Edge, MarkerType, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Mapa del desk: el equipo como grafo, no como anillo decorativo. Nodos =
// la persona, el Floor (Grok), los agentes, invitados, el activo en foco y
// las ordenes en la mesa. Aristas = quien le entrega a quien; se animan
// durante el turno. Es la vista "knowledge graph" del desk: al tocar un
// nodo la escena responde (analyze / market / orden).

export type MapAgent = { role: string; label: string; state: string; talking: boolean; rail?: { linked: boolean; lockUsd: number }; last?: string; verdict?: "GO" | "BLOCK" | "" };
export type MapOrder = { id: number; label: string; stage: string; symbol: string };
export type DeskMapProps = {
  deskName: string;
  agents: MapAgent[];
  guest: { on: boolean; label: string };
  beams: Array<{ from: string; to: string; done: boolean }>;
  focus?: { symbol: string; name: string; priceUsd?: number; change24hPct?: number } | null;
  orders: MapOrder[];
  /** Segunda cotizacion (Bankr) de la ultima orden: fuente de precio, sin gasto. */
  bankr?: { priceUsd: number; deltaPct: number } | null;
  turnLive: boolean;
  onPick: (kind: "agent" | "asset" | "order" | "floor" | "you", id: string) => void;
};

const W = 150, H = 44;
const nodeStyle = (accent: string, on = true, glow = false): React.CSSProperties => ({
  width: W, height: H, borderRadius: 12, padding: "6px 10px",
  background: "linear-gradient(180deg, rgba(20,24,40,0.96), rgba(12,14,26,0.96))",
  border: `1px solid ${accent}`, color: "#e6ecff", fontSize: 11, letterSpacing: 0.3,
  boxShadow: glow ? `0 0 18px ${accent}` : "0 6px 20px rgba(0,0,0,0.35)",
  opacity: on ? 1 : 0.45, cursor: "pointer"
});
const L = (title: string, sub?: string) => (
  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
    <b style={{ fontWeight: 600 }}>{title}</b>
    {sub ? <small style={{ color: "#9aabc8", fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</small> : null}
  </div>
);
const CORAL = "rgba(236,27,105,0.7)", BLUE = "rgba(127,176,255,0.55)", GREEN = "rgba(61,200,120,0.7)", RED = "rgba(255,90,106,0.7)", AMBER = "rgba(255,179,71,0.7)", GREY = "rgba(150,160,190,0.35)";

export default function DeskMap(p: DeskMapProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const roles = ["scout", "risk", "trader", "auditor"];
    // Vertical (el panel es alto y angosto): You -> Floor -> equipo (2x2) -> mundo.
    const row = { you: 0, floor: 90, agents: 190, guest: 350, world: 430 };
    const cx = 250; // centro del grafo
    nodes.push({ id: "you", position: { x: cx - W / 2, y: row.you }, data: { label: L("You", "signs every trade") }, style: nodeStyle(CORAL), sourcePosition: Position.Bottom, targetPosition: Position.Top });
    nodes.push({ id: "floor", position: { x: cx - W / 2, y: row.floor }, data: { label: L("Floor", p.deskName) }, style: nodeStyle(CORAL, true, p.turnLive), sourcePosition: Position.Bottom, targetPosition: Position.Top });
    edges.push({ id: "you-floor", source: "you", target: "floor", animated: p.turnLive, style: { stroke: CORAL } });
    const slots: Array<{ x: number; y: number }> = [
      { x: cx - W - 20, y: row.agents }, { x: cx + 20, y: row.agents },
      { x: cx - W - 20, y: row.agents + 70 }, { x: cx + 20, y: row.agents + 70 }
    ];
    roles.forEach((r, i) => {
      const a = p.agents.find((x) => x.role === r);
      const on = a ? a.state === "ready" || a.state === "hibernated" || a.state === "waking" : false;
      const accent = a?.talking ? AMBER : a?.verdict === "BLOCK" ? RED : a?.verdict === "GO" ? GREEN : a?.rail?.linked ? CORAL : BLUE;
      const sub = a ? (a.talking ? "thinking…" : a.state === "ready" ? (a.role === "trader" && a.rail ? (a.rail.linked ? "1Claw rail linked" : "rail not linked") : "on PerkOS") : a.state === "hibernated" ? "asleep" : a.state) : "not deployed";
      nodes.push({ id: `agent:${r}`, position: slots[i], data: { label: L(a?.label ?? r, sub) }, style: nodeStyle(accent, on, Boolean(a?.talking)), sourcePosition: Position.Bottom, targetPosition: Position.Top });
      edges.push({ id: `floor-${r}`, source: "floor", target: `agent:${r}`, animated: Boolean(a?.talking), style: { stroke: a?.talking ? AMBER : GREY } });
    });
    if (p.guest.on) {
      nodes.push({ id: "agent:guest", position: { x: cx - W / 2, y: row.guest }, data: { label: L(p.guest.label, "guest · no spend") }, style: nodeStyle(GREY), sourcePosition: Position.Bottom, targetPosition: Position.Top });
      edges.push({ id: "floor-guest", source: "floor", target: "agent:guest", style: { stroke: GREY } });
    }
    // Handoffs del turno: Scout/Risk -> Trader/Auditor.
    p.beams.forEach((b, i) => edges.push({ id: `beam-${i}`, source: `agent:${b.from}`, target: `agent:${b.to}`, animated: !b.done, style: { stroke: b.done ? BLUE : AMBER, strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: b.done ? "#7fb0ff" : "#ffb347" }, type: "smoothstep" }));
    if (p.focus) {
      nodes.push({ id: `asset:${p.focus.symbol}`, position: { x: cx - W - 20, y: row.world }, data: { label: L(`${p.focus.name}`, `${p.focus.symbol}${p.focus.priceUsd ? ` · $${p.focus.priceUsd.toFixed(2)}` : ""}${p.focus.change24hPct !== undefined ? ` · ${p.focus.change24hPct > 0 ? "+" : ""}${p.focus.change24hPct.toFixed(2)}%` : ""}`) }, style: nodeStyle(BLUE), targetPosition: Position.Top, sourcePosition: Position.Bottom });
      edges.push({ id: "scout-asset", source: "agent:scout", target: `asset:${p.focus.symbol}`, style: { stroke: BLUE }, type: "smoothstep" });
      edges.push({ id: "risk-asset", source: "agent:risk", target: `asset:${p.focus.symbol}`, style: { stroke: BLUE }, type: "smoothstep" });
    }
    if (p.bankr) {
      nodes.push({ id: "source:bankr", position: { x: cx - W / 2, y: row.world + 130 }, data: { label: L("Bankr", `second quote · $${p.bankr.priceUsd.toFixed(2)} · ${p.bankr.deltaPct > 0 ? "+" : ""}${p.bankr.deltaPct.toFixed(2)}% vs uniswap`) }, style: nodeStyle(GREY), sourcePosition: Position.Top, targetPosition: Position.Bottom });
      edges.push({ id: "bankr-risk", source: "source:bankr", target: "agent:risk", style: { stroke: GREY }, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#9aabc8" } });
    }
    p.orders.slice(0, 3).forEach((o, i) => {
      const accent = o.stage === "done" ? GREEN : o.stage === "blocked" ? RED : o.stage === "failed" ? GREY : AMBER;
      nodes.push({ id: `order:${o.id}`, position: { x: cx + 20, y: row.world + i * 60 }, data: { label: L(o.label, o.stage === "idle" ? "waiting for your approval" : o.stage) }, style: nodeStyle(accent), targetPosition: Position.Top, sourcePosition: Position.Bottom });
      edges.push({ id: `trader-order-${o.id}`, source: "agent:trader", target: `order:${o.id}`, style: { stroke: accent }, type: "smoothstep" });
      if (o.stage === "done") edges.push({ id: `order-auditor-${o.id}`, source: `order:${o.id}`, target: "agent:auditor", style: { stroke: GREEN }, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#7fe0a8" } });
    });
    return { nodes, edges };
  }, [p]);

  return (
    <div className="desk-map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_e, n) => {
          const [kind, id] = n.id.includes(":") ? (n.id.split(":") as [string, string]) : [n.id, n.id];
          if (kind === "source") return;
          p.onPick(kind === "agent" ? "agent" : kind === "asset" ? "asset" : kind === "order" ? "order" : kind === "floor" ? "floor" : "you", id);
        }}
        colorMode="dark"
      >
        <Background color="rgba(120,160,255,0.12)" gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}

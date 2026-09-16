import { Handle, Position, type NodeProps } from "@xyflow/react";

function Bar({ pct }: { pct: number }) {
  return (
    <div className="bar">
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SlotNode({ data }: NodeProps) {
  return (
    <div className={`slot${data.kind === "guest" ? " guest" : ""}`}>
      <div className="badge">{String(data.badge)}</div>
      <div className="title">{String(data.label)}</div>
      <p className="line">{String(data.line)}</p>
    </div>
  );
}

export function DeskNode({ data }: NodeProps) {
  return (
    <div className={`desk${data.blocked ? " blocked" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="badge">{String(data.badge)}</div>
      <div className="title">{String(data.label)}</div>
      <Bar pct={Number(data.pct ?? 0)} />
      <p className="line">{String(data.line)}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function DocsNode({ data }: NodeProps) {
  const open = Boolean(data.open);
  return (
    <div className={open ? "docs" : "slot"}>
      <div className="badge">PROJECT</div>
      <div className="title">Docs</div>
      <p className="line">
        {open
          ? "PerkOS. They draft. You approve. Base only."
          : "Hibernated"}
      </p>
    </div>
  );
}

export function MarketNode({ data }: NodeProps) {
  return (
    <div className="market">
      <div className="badge">B20</div>
      <div className="title">{String(data.ticker)}</div>
      <p className="line">{String(data.address)}</p>
      <p className="line">5.00 USDC → tokens, not shares</p>
    </div>
  );
}

export const nodeTypes = {
  slot: SlotNode,
  desk: DeskNode,
  docs: DocsNode,
  market: MarketNode
};

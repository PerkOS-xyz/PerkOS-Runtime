"use client";

import { CHAINS, type ChainId } from "./deskManifest";
export { CHAINS, chainOf, deskManifest } from "./deskManifest";

// Marca de la cadena del desk.
// Base (brand.base.org): en tamano grande, el logotipo en bloques ("base":
// cuatro bloques, el primero con el asta de la b), en Base Blue #0000ff; en
// tamanos chicos, "The Square" (cuadrado, radio 5 %). Geometria propia, sin
// assets externos, respetando la regla de tres colores.
function BaseBlocks({ className }: { className?: string }) {
  // Proporciones tomadas del logotipo: bloques de 90 con radio 9, separacion
  // 12; el primer bloque lleva un asta de 35 x 40 sobre su lado izquierdo.
  const r = 9;
  const b = `M${r} 0 H${35 - r} a${r} ${r} 0 0 1 ${r} ${r} V40 H${90 - r} a${r} ${r} 0 0 1 ${r} ${r} V${130 - r} a${r} ${r} 0 0 1 -${r} ${r} H${r} a${r} ${r} 0 0 1 -${r} -${r} V${r} a${r} ${r} 0 0 1 ${r} -${r} Z`;
  return (
    <svg className={className} viewBox="0 0 396 130" role="img" aria-label="Built on Base" xmlns="http://www.w3.org/2000/svg">
      <title>Built on Base</title>
      <path d={b} fill={CHAINS.base.color} />
      <rect x="102" y="40" width="90" height="90" rx={r} fill={CHAINS.base.color} />
      <rect x="204" y="40" width="90" height="90" rx={r} fill={CHAINS.base.color} />
      <rect x="306" y="40" width="90" height="90" rx={r} fill={CHAINS.base.color} />
    </svg>
  );
}

export function ChainMark({ chain, small, big }: { chain: ChainId; small?: boolean; big?: boolean }) {
  const c = CHAINS[chain];
  if (big && chain === "base") return <BaseBlocks className="chain-logo base" />;
  return <i className={`chain-mark ${chain}${small ? " sm" : ""}${big ? " big" : ""}`} style={{ background: c.color }} title={c.builtOn} aria-label={c.builtOn} role="img" />;
}

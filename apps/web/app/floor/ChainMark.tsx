"use client";

import { CHAINS, type ChainId } from "./deskManifest";
export { CHAINS, chainOf, deskManifest } from "./deskManifest";

// Marca de la cadena del desk. Base: "The Square" (cuadrado, radio 5 %, Base
// Blue #0000ff, brand.base.org), dibujado en CSS para respetar la regla de
// tres colores sin traer assets. Tamanos: sm (menu), normal (pill), big
// (lockup junto al wordmark de PerkOS: shell + desk).
export function ChainMark({ chain, small, big }: { chain: ChainId; small?: boolean; big?: boolean }) {
  const c = CHAINS[chain];
  return <i className={`chain-mark ${chain}${small ? " sm" : ""}${big ? " big" : ""}`} style={{ background: c.color }} title={c.builtOn} aria-label={c.builtOn} role="img" />;
}

"use client";

import { CHAINS, type ChainId } from "./deskManifest";
export { CHAINS, chainOf, deskManifest } from "./deskManifest";

// Marca de la cadena del desk, con los activos oficiales del brand kit de
// Base (brand.base.org/base-brand.zip, 2026-09-16): el Basemark en blanco en
// el lockup grande junto al wordmark de PerkOS y "The Square" en Base Blue
// en el pill y el menu del desk. Sin brillos: el brillo es de la esfera coral.
// Otra cadena sin marca acordada: anillo neutro (nunca una marca inventada).
export function ChainMark({ chain, small, big }: { chain: ChainId; small?: boolean; big?: boolean }) {
  const c = CHAINS[chain];
  if (chain === "base") {
    if (big) return <img src="/base/basemark-white.svg" className="chain-logo base" alt="Base" title={c.builtOn} draggable={false} />;
    return <img src="/base/square-blue.svg" className={`chain-mark base${small ? " sm" : ""}`} alt="" title={c.builtOn} draggable={false} />;
  }
  return <i className={`chain-mark ring${small ? " sm" : ""}${big ? " big" : ""}`} title={c.builtOn} aria-label={c.builtOn} role="img" />;
}

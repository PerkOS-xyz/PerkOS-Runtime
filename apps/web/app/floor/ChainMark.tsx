"use client";

// Cadena de cada desk: el desk es el producto y la cadena es parte de su
// identidad (Floor desk = acciones tokenizadas en Base; despues de la
// hackathon, EQLTY desk en Robinhood Chain). La marca de Base sigue sus
// identificadores (brand.base.org): "The Square", radio 5 %, solo en Base
// Blue #0000ff, blanco o negro; espacio libre igual al cuadrado.
export type ChainId = "base" | "robinhood";
export const CHAINS: Record<ChainId, { name: string; color: string; tagline: string; builtOn: string }> = {
  base: { name: "Base", color: "#0000ff", tagline: "Tokenized stocks on Base", builtOn: "Built on Base" },
  robinhood: { name: "Robinhood Chain", color: "#00c805", tagline: "Tokenized stocks on Robinhood Chain", builtOn: "On Robinhood Chain" }
};

export function chainOf(desk?: { id?: string; chain?: string } | null): ChainId {
  if (desk?.chain === "robinhood" || /eqlty|robinhood/i.test(desk?.id ?? "")) return "robinhood";
  return "base";
}

export function ChainMark({ chain, small }: { chain: ChainId; small?: boolean }) {
  const c = CHAINS[chain];
  return <i className={`chain-mark ${chain}${small ? " sm" : ""}`} style={{ background: c.color }} title={c.builtOn} aria-label={c.builtOn} role="img" />;
}

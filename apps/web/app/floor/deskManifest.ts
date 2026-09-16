// Manifiesto del desk. Floor es el shell (Electron): cuenta, settings, la
// esfera y la voz, el compositor, Notes, Map e History son universales. Un
// desk es como un app que corre dentro del shell: trae su cadena, su slogan,
// sus pantallas (Market, Portfolio), sus agentes y sus flujos. Lo que aqui se
// declara es lo que cambia al cambiar de desk; lo demas no se toca.
export type ChainId = "base" | "robinhood";
export const CHAINS: Record<ChainId, { name: string; color: string; builtOn: string }> = {
  // Base: "The Square", radio 5 %, solo Base Blue #0000ff, blanco o negro (brand.base.org).
  base: { name: "Base", color: "#0000ff", builtOn: "Built on Base" },
  robinhood: { name: "Robinhood Chain", color: "#00c805", builtOn: "On Robinhood Chain" }
};

export type DeskScreenId = "market" | "portfolio";
export type AppScreenId = "notes" | "map" | "history";
/** Pantallas del shell, iguales en todo desk. */
export const APP_SCREENS: AppScreenId[] = ["notes", "map", "history"];

export type DeskLike = { id?: string; chain?: string; tagline?: string } | null | undefined;

export function chainOf(desk: DeskLike): ChainId {
  if (desk?.chain === "robinhood" || /eqlty|robinhood/i.test(desk?.id ?? "")) return "robinhood";
  return "base";
}

export function deskManifest(desk: DeskLike): { chain: ChainId; tagline: string; screens: DeskScreenId[] } {
  const chain = chainOf(desk);
  if (chain === "robinhood") return { chain, tagline: desk?.tagline ?? "Tokenized stocks on Robinhood Chain", screens: ["market", "portfolio"] };
  return { chain, tagline: desk?.tagline ?? "Tokenized stocks on Base", screens: ["market", "portfolio"] };
}

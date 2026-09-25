export type Chain = "robinhood" | "base" | "neutral";

export const CHAIN_LABEL: Record<Chain, string> = { robinhood: "Robinhood Chain", base: "Base", neutral: "" };

/** The chain a desk trades on, from its module id (for example `stocks-robinhood`). */
export function chainOf(module?: string): Chain {
  if (!module) return "neutral";
  if (module.endsWith("-robinhood")) return "robinhood";
  if (module.endsWith("-base")) return "base";
  return "neutral";
}

// Manifiesto del desk. Floor es el shell (Electron): cuenta, settings, la
// esfera y la voz, el compositor, Notes, Map e History son universales. Un
// desk es como un app que corre dentro del shell: trae su cadena, su slogan,
// sus pantallas (Market, Portfolio), sus agentes y sus flujos. Lo que aqui se
// declara es lo que cambia al cambiar de desk; lo demas no se toca.
//
// Un desk es un project template de PerkOS (`fleetTemplateId`), igual que un
// proyecto en la app. La definicion es hibrida:
//   - la plantilla manda: si trae cadena, slogan, venues o pantallas, gana;
//   - el modulo pone el resto: como opera ese tipo de desk, que es codigo de
//     esta app (Launches lleva Bankr y Uniswap V4 dentro, eso no se describe
//     con datos).
// Un desk nuevo de una familia que ya existe no necesita empaquetar version:
// basta publicarlo en PerkOS diciendo su modulo. Uno con mecanica distinta si.
export type ChainId = "base" | "robinhood";
export const CHAINS: Record<ChainId, { name: string; color: string; builtOn: string }> = {
  // Base: "The Square", radio 5 %, solo Base Blue #0000ff, blanco o negro (brand.base.org).
  base: { name: "Base", color: "#0000ff", builtOn: "Built on Base" },
  robinhood: { name: "Robinhood Chain", color: "#00c805", builtOn: "On Robinhood Chain" }
};

export type DeskScreenId = "market" | "portfolio" | "launches" | "automations";
export type AppScreenId = "notes" | "map" | "history";
/** Pantallas del shell, iguales en todo desk. */
export const APP_SCREENS: AppScreenId[] = ["notes", "map", "history"];
const DESK_SCREENS: DeskScreenId[] = ["market", "portfolio", "launches", "automations"];

/** Los tipos de desk que esta version del app sabe operar. */
export type DeskModuleId = "stocks-base" | "stocks-robinhood" | "desk";

/** Cuantos desks de esta familia tienen sentido bajo una misma wallet.
 *  Floor lee la wallet conectada: cartera, lanzamientos, fees y firma salen de ella.
 *  Dos desks Floor con la misma wallet mostrarian el mismo libro con el doble de
 *  agentes, asi que el desk es uno por wallet y un segundo Floor se abre entrando
 *  con otra wallet. Un desk cuyo trabajo no sale de la wallet (investigacion,
 *  contenido, una empresa) si admite varios a la vez. */
export type DeskInstances = "one-per-wallet" | "many";
export type DeskModule = { label: string; chain: ChainId; tagline: string; venues: string; screens: DeskScreenId[]; instances: DeskInstances };

export const DESK_MODULES: Record<DeskModuleId, DeskModule> = {
  // Floor: acciones tokenizadas en Base, con lanzamientos y automatizaciones de Bankr.
  "stocks-base": {
    label: "Tokenized stocks on Base",
    chain: "base",
    tagline: "Tokenized stocks on Base",
    venues: "Uniswap V3 and Aerodrome on Base · Bankr second quote, launches and automations",
    screens: ["market", "portfolio", "launches", "automations"],
    instances: "one-per-wallet"
  },
  // EQLTY: acciones tokenizadas en Robinhood Chain. Sin lanzamientos ni automatizaciones todavia.
  "stocks-robinhood": {
    label: "Tokenized stocks on Robinhood Chain",
    chain: "robinhood",
    tagline: "Tokenized stocks on Robinhood Chain",
    venues: "Robinhood Chain",
    screens: ["market", "portfolio"],
    instances: "one-per-wallet"
  },
  // Un desk que esta version no conoce: se muestra con lo que diga su plantilla y sin
  // pantallas que dependan de una mecanica concreta. Mejor corto que equivocado.
  desk: {
    label: "Desk",
    chain: "base",
    tagline: "",
    venues: "",
    screens: [],
    instances: "many"
  }
};

export type DeskLike =
  | {
      id?: string;
      name?: string;
      /** Lo que la plantilla de PerkOS puede declarar; todo opcional. */
      module?: string;
      chain?: string;
      tagline?: string;
      venues?: string;
      screens?: string[];
      instances?: string;
    }
  | null
  | undefined;

/** El desk por defecto del app, el mismo `DEFAULT_FLEET_TEMPLATE` (floor-desk) de los settings:
    es el que vale mientras las plantillas no han llegado, para que el dock no arranque vacio. */
export const DEFAULT_DESK_MODULE: DeskModuleId = "stocks-base";

/** El modulo con el que se opera este desk: lo que diga la plantilla, si no por su id. */
export function moduleOf(desk: DeskLike): DeskModuleId {
  const declared = desk?.module;
  if (declared && declared in DESK_MODULES) return declared as DeskModuleId;
  const id = desk?.id ?? "";
  // Todavia sin desk (arranque): el del app. Un desk con id desconocido si cae en el generico.
  if (!id) return desk ? "desk" : DEFAULT_DESK_MODULE;
  if (/eqlty|robinhood/i.test(id)) return "stocks-robinhood";
  if (/floor/i.test(id)) return "stocks-base";
  // Una plantilla nueva sin modulo: se respeta su cadena, pero no se le presta la mecanica de Floor.
  return "desk";
}

export function chainOf(desk: DeskLike): ChainId {
  if (desk?.chain === "robinhood" || desk?.chain === "base") return desk.chain;
  return DESK_MODULES[moduleOf(desk)].chain;
}

/** Cuantos desks admite esta plantilla por wallet: lo que diga la plantilla, si no su modulo. */
export function instancesOf(desk: DeskLike): DeskInstances {
  const declared = desk?.instances;
  if (declared === "one-per-wallet" || declared === "many") return declared;
  return DESK_MODULES[moduleOf(desk)].instances;
}

/** Razon por la que no se puede montar otro desk de esta plantilla con esta wallet,
 *  o "" si si se puede. La frase es la que se le ensena a la persona. */
export function deskLimit(desk: DeskLike, alreadyMine: boolean): string {
  if (!alreadyMine || instancesOf(desk) === "many") return "";
  return `One ${desk?.name ?? "desk"} per wallet. It follows the positions of the wallet you sign in with, so a second one would show the same book. Sign in with another wallet to run another.`;
}

export function deskManifest(desk: DeskLike): { module: DeskModuleId; chain: ChainId; tagline: string; venues: string; screens: DeskScreenId[]; instances: DeskInstances } {
  const id = moduleOf(desk);
  const mod = DESK_MODULES[id];
  // Solo pantallas que este app sabe pintar, y solo las que el modulo puede operar.
  const asked = desk?.screens?.filter((s): s is DeskScreenId => (DESK_SCREENS as string[]).includes(s));
  const screens = asked?.length ? asked.filter((s) => mod.screens.includes(s)) : mod.screens;
  return {
    module: id,
    chain: chainOf(desk),
    tagline: desk?.tagline || mod.tagline || desk?.name || "",
    venues: desk?.venues || mod.venues,
    screens,
    instances: instancesOf(desk)
  };
}
